import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'

// NVIDIA NIM — OpenAI-compatible, free tier
// Get your API key at: https://build.nvidia.com
const client = new OpenAI({
  apiKey:  process.env.NVIDIA_NIM_API_KEY ?? '',
  baseURL: 'https://integrate.api.nvidia.com/v1',
})

const MODEL = process.env.NVIDIA_NIM_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b'

// ── Helpers ────────────────────────────────────────────────────────────────

function readFileSafe(filePath: string): string | null {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null
  } catch {
    return null
  }
}

function buildProjectContext(projectPath: string): string {
  const files   = fs.readdirSync(projectPath)
  const pkgJson = readFileSafe(path.join(projectPath, 'package.json'))
  const reqsTxt = readFileSafe(path.join(projectPath, 'requirements.txt'))
  const readme  = readFileSafe(path.join(projectPath, 'README.md'))

  const lines: string[] = [
    '=== Root Files ===',
    files.join(', '),
  ]

  if (pkgJson) lines.push('\n=== package.json ===\n' + pkgJson)
  if (reqsTxt)  lines.push('\n=== requirements.txt ===\n' + reqsTxt)
  if (readme)   lines.push('\n=== README.md (first 1000 chars) ===\n' + readme.slice(0, 1000))

  return lines.join('\n')
}

// ── Parse agent response ───────────────────────────────────────────────────

interface AgentResult {
  projectType:  string
  dockerfile:   string
  fileChanges:  { filename: string; content: string }[]
  notes:        string
}

function parseAgentResponse(raw: string): AgentResult | null {
  try {
    const match   = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    const jsonStr = match ? match[1] : raw
    return JSON.parse(jsonStr.trim())
  } catch {
    console.error('[NemoClaw] Failed to parse agent response:', raw.slice(0, 300))
    return null
  }
}

// ── Apply modifications ────────────────────────────────────────────────────

function applyModifications(projectPath: string, result: AgentResult): void {
  if (result.dockerfile?.trim()) {
    const dest = path.join(projectPath, 'Dockerfile')
    fs.writeFileSync(dest, result.dockerfile, 'utf-8')
    console.log(`[NemoClaw] Dockerfile written → ${dest}`)
  }

  for (const change of result.fileChanges ?? []) {
    if (!change.filename || !change.content) continue
    const safeName = path.basename(change.filename) // prevent path traversal
    const dest     = path.join(projectPath, safeName)
    fs.writeFileSync(dest, change.content, 'utf-8')
    console.log(`[NemoClaw] File written → ${dest}`)
  }
}

// ── Main export ────────────────────────────────────────────────────────────

export async function analyzeAndModifyProject(projectPath: string): Promise<void> {
  console.log(`[NemoClaw] Analyzing project at: ${projectPath}`)

  try {
    const context = buildProjectContext(projectPath)

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a DevOps AI assistant. Analyze projects and generate deployment files. Always respond with valid JSON only.',
        },
        {
          role: 'user',
          content: `Analyze this project and generate deployment files.\n\n${context}\n\nRespond ONLY with a valid JSON object in this exact shape:\n{\n  "projectType": "string",\n  "dockerfile": "string (full Dockerfile content)",\n  "fileChanges": [\n    { "filename": "string", "content": "string" }\n  ],\n  "notes": "string"\n}`,
        },
      ],
      temperature: 0.2,
      max_tokens:  2048,
    })

    const rawReply = completion.choices[0]?.message?.content ?? ''
    console.log('[NemoClaw] Raw response:\n', rawReply.slice(0, 500))

    const result = parseAgentResponse(rawReply)
    if (!result) {
      console.error('[NemoClaw] Could not parse response — skipping modifications')
      return
    }

    console.log(`[NemoClaw] Detected project type: ${result.projectType}`)
    if (result.notes) console.log(`[NemoClaw] Notes: ${result.notes}`)

    applyModifications(projectPath, result)

    console.log('[NemoClaw] modified your code')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[NemoClaw] Error: ${message}`)
    // Never crash the server
  }
}
