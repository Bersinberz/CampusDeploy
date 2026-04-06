import fs from 'fs'
import path from 'path'
import WebSocket from 'ws'

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? 'ws://127.0.0.1:18789'
const TIMEOUT_MS  = 60_000

// ── Helpers ────────────────────────────────────────────────────────────────

function readFileSafe(filePath: string): string | null {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null
  } catch {
    return null
  }
}

function buildProjectContext(projectPath: string): string {
  const files      = fs.readdirSync(projectPath)
  const pkgJson    = readFileSafe(path.join(projectPath, 'package.json'))
  const reqsTxt    = readFileSafe(path.join(projectPath, 'requirements.txt'))
  const readme     = readFileSafe(path.join(projectPath, 'README.md'))

  const lines: string[] = [
    '=== Project Root Files ===',
    files.join(', '),
  ]

  if (pkgJson)  lines.push('\n=== package.json ===\n' + pkgJson)
  if (reqsTxt)  lines.push('\n=== requirements.txt ===\n' + reqsTxt)
  if (readme)   lines.push('\n=== README.md (truncated to 1000 chars) ===\n' + readme.slice(0, 1000))

  return lines.join('\n')
}

function buildPrompt(context: string): string {
  return `
You are a DevOps AI assistant. Analyze the following project and generate deployment files.

${context}

Tasks:
1. Identify the project type (Node.js, Python, Go, etc.)
2. Generate a production-ready Dockerfile suitable for this project
3. If any config changes are needed for deployment, list them

Respond ONLY with a valid JSON object in this exact shape:
{
  "projectType": "string",
  "dockerfile": "string (full Dockerfile content)",
  "fileChanges": [
    { "filename": "string", "content": "string" }
  ],
  "notes": "string"
}
`.trim()
}

// ── OpenClaw gateway call ──────────────────────────────────────────────────

function sendToOpenClaw(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(GATEWAY_URL)
    let response = ''
    const timer = setTimeout(() => {
      ws.close()
      reject(new Error('OpenClaw gateway timed out'))
    }, TIMEOUT_MS)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'agent.task', payload: { message: prompt } }))
    })

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const event = JSON.parse(data.toString())
        if (event.type === 'agent.message' && event.payload?.content) {
          response += event.payload.content
        }
        if (event.type === 'agent.done') {
          clearTimeout(timer)
          ws.close()
          resolve(response || event.payload?.summary || '')
        }
      } catch {
        // partial chunk — keep accumulating
      }
    })

    ws.on('error', (err: Error) => {
      clearTimeout(timer)
      reject(new Error(`OpenClaw gateway error: ${err.message}`))
    })
  })
}

// ── Parse agent response ───────────────────────────────────────────────────

interface AgentResult {
  projectType: string
  dockerfile:  string
  fileChanges: { filename: string; content: string }[]
  notes:       string
}

function parseAgentResponse(raw: string): AgentResult | null {
  try {
    // Extract JSON block if wrapped in markdown code fences
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) 
    const jsonStr = match ? match[1] : raw
    return JSON.parse(jsonStr.trim())
  } catch {
    console.error('[OpenClaw] Failed to parse agent response:', raw.slice(0, 300))
    return null
  }
}

// ── Apply modifications ────────────────────────────────────────────────────

function applyModifications(projectPath: string, result: AgentResult): void {
  // Write Dockerfile
  if (result.dockerfile?.trim()) {
    const dockerfilePath = path.join(projectPath, 'Dockerfile')
    fs.writeFileSync(dockerfilePath, result.dockerfile, 'utf-8')
    console.log(`[OpenClaw] Dockerfile written → ${dockerfilePath}`)
  }

  // Apply additional file changes
  for (const change of result.fileChanges ?? []) {
    if (!change.filename || !change.content) continue
    // Safety: prevent path traversal
    const safeName = path.basename(change.filename)
    const filePath = path.join(projectPath, safeName)
    fs.writeFileSync(filePath, change.content, 'utf-8')
    console.log(`[OpenClaw] File written → ${filePath}`)
  }
}

// ── Main export ────────────────────────────────────────────────────────────

export async function analyzeAndModifyProject(projectPath: string): Promise<void> {
  console.log(`[OpenClaw] Analyzing project at: ${projectPath}`)

  try {
    const context  = buildProjectContext(projectPath)
    const prompt   = buildPrompt(context)
    const rawReply = await sendToOpenClaw(prompt)

    console.log('[OpenClaw] Raw agent response:\n', rawReply.slice(0, 500))

    const result = parseAgentResponse(rawReply)
    if (!result) {
      console.error('[OpenClaw] Could not parse agent response — skipping modifications')
      return
    }

    console.log(`[OpenClaw] Detected project type: ${result.projectType}`)
    if (result.notes) console.log(`[OpenClaw] Notes: ${result.notes}`)

    applyModifications(projectPath, result)

    console.log('[OpenClaw] modified your code')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[OpenClaw] Error during analysis: ${message}`)
    // Do not rethrow — server must not crash
  }
}
