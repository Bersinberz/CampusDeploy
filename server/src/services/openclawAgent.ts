import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'

// ── LLM Provider Registry ──────────────────────────────────────────────────

interface LLMProvider {
  name:        string
  baseURL:     string
  apiKey:      string
  model:       string
  temperature: number
  top_p:       number
  max_tokens:  number
  thinking?:   boolean // enables reasoning_content (DeepSeek R1 style)
}

const PROVIDERS: LLMProvider[] = [
  {
    name:        'DeepSeek V3.2 (NVIDIA NIM)',
    baseURL:     'https://integrate.api.nvidia.com/v1',
    apiKey:      process.env.DEEPSEEK_API_KEY ?? '',
    model:       'deepseek-ai/deepseek-v3.2',
    temperature: 1,
    top_p:       0.95,
    max_tokens:  8192,
    thinking:    true,
  },
  {
    name:        'Kimi K2 (NVIDIA NIM)',
    baseURL:     'https://integrate.api.nvidia.com/v1',
    apiKey:      process.env.KIMI_API_KEY ?? '',
    model:       'moonshotai/kimi-k2-instruct',
    temperature: 0.6,
    top_p:       0.9,
    max_tokens:  4096,
    thinking:    false,
  },
]

function getActiveProviders(): LLMProvider[] {
  return PROVIDERS.filter(p => p.apiKey.trim() !== '')
}

function buildClient(provider: LLMProvider): OpenAI {
  return new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL })
}

// ── File Collection ────────────────────────────────────────────────────────

const SKIP_DIRS     = new Set(['node_modules', '.git', '.next', '__pycache__', 'dist', 'build', '.venv', 'venv'])
const TEXT_EXTS     = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb', '.php',
  '.json', '.yaml', '.yml', '.toml', '.env', '.md', '.txt', '.sh', '.dockerfile',
  '.html', '.css', '.scss', '.prisma', '.graphql', '.sql',
])
const MAX_FILE_SIZE = 1_500
const MAX_TOTAL     = 8_000
const PRIORITY_FILES = ['package.json', 'requirements.txt', 'go.mod', 'pom.xml', 'Cargo.toml', 'README.md']

function readFileSafe(filePath: string): string | null {
  try { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null }
  catch { return null }
}

function collectFiles(dir: string, base: string = dir): { rel: string; content: string }[] {
  const results: { rel: string; content: string }[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    const relPath  = path.relative(base, fullPath).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, base))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (!TEXT_EXTS.has(ext)) continue
      const raw = readFileSafe(fullPath)
      if (!raw) continue
      results.push({ rel: relPath, content: raw.slice(0, MAX_FILE_SIZE) })
    }
  }
  return results
}

function buildProjectContext(projectPath: string): string {
  console.log(`[NemoClaw] Walking project tree at: ${projectPath}`)
  const allFiles = collectFiles(projectPath)
  console.log(`[NemoClaw] Collected ${allFiles.length} source file(s)`)

  allFiles.sort((a, b) => {
    const aP = PRIORITY_FILES.includes(path.basename(a.rel)) ? 0 : 1
    const bP = PRIORITY_FILES.includes(path.basename(b.rel)) ? 0 : 1
    return aP - bP
  })

  const lines: string[] = [`=== Project Tree ===`, allFiles.map(f => f.rel).join('\n')]
  let total = lines.join('\n').length

  for (const file of allFiles) {
    const block = `\n=== ${file.rel} ===\n${file.content}`
    if (total + block.length > MAX_TOTAL) {
      console.log(`[NemoClaw] Context limit reached at ${total} chars`)
      break
    }
    lines.push(block)
    total += block.length
  }

  console.log(`[NemoClaw] Final context size: ${total} chars`)
  return lines.join('\n')
}

// ── Parse / Repair ─────────────────────────────────────────────────────────

interface DeployFile { filename: string; content: string }
interface AgentResult { projectType: string; deployFiles: DeployFile[]; notes: string }

function repairJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/)
  let s = (fenceMatch ? fenceMatch[1] : raw).trim()

  let braces = 0, brackets = 0, inString = false, escape = false
  for (const ch of s) {
    if (escape)          { escape = false; continue }
    if (ch === '\\')     { escape = true;  continue }
    if (ch === '"')      { inString = !inString; continue }
    if (inString)        continue
    if (ch === '{')      braces++
    else if (ch === '}') braces--
    else if (ch === '[') brackets++
    else if (ch === ']') brackets--
  }

  if (inString) s += '"'
  s += ']'.repeat(Math.max(0, brackets))
  s += '}'.repeat(Math.max(0, braces))
  return s
}

function parseAgentResponse(raw: string): AgentResult | null {
  try {
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    return JSON.parse((fenceMatch ? fenceMatch[1] : raw).trim())
  } catch { /* fall through */ }

  try {
    const result = JSON.parse(repairJson(raw)) as AgentResult
    console.log('[NemoClaw] JSON repair succeeded')
    return result
  } catch {
    return null
  }
}

// ── Call a single provider ─────────────────────────────────────────────────

async function callProvider(
  provider:   LLMProvider,
  context:    string,
  errorLogs?: string,
): Promise<AgentResult | null> {
  console.log(`[NemoClaw] Trying provider: ${provider.name} (${provider.model})`)
  const client    = buildClient(provider)
  const extraBody = provider.thinking ? { chat_template_kwargs: { thinking: true } } : undefined

  const userContent = errorLogs
    ? `Project files:\n${context}\n\n` +
      `Previous deployment FAILED with these errors:\n${errorLogs}\n\n` +
      `Fix the deployment files to resolve these errors. ` +
      `Output this JSON with corrected file contents:\n` +
      `{"projectType":"...","deployFiles":[` +
      `{"filename":"Dockerfile","content":"..."},` +
      `{"filename":"docker-compose.yml","content":"..."},` +
      `{"filename":".env.example","content":"..."},` +
      `{"filename":"nginx.conf","content":"..."},` +
      `{"filename":".github/workflows/deploy.yml","content":"..."}` +
      `],"notes":"..."}`
    : `Project files:\n${context}\n\n` +
      `Output this JSON (fill in real content for each file):\n` +
      `{"projectType":"...","deployFiles":[` +
      `{"filename":"Dockerfile","content":"..."},` +
      `{"filename":"docker-compose.yml","content":"..."},` +
      `{"filename":".env.example","content":"..."},` +
      `{"filename":"nginx.conf","content":"..."},` +
      `{"filename":".github/workflows/deploy.yml","content":"..."}` +
      `],"notes":"..."}`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = (await client.chat.completions.create({
    model:       provider.model,
    stream:      true,
    temperature: provider.temperature,
    top_p:       provider.top_p,
    max_tokens:  provider.max_tokens,
    ...(extraBody ? { extra_body: extraBody } : {}),
    messages: [
      {
        role:    'system',
        content: 'You are a JSON API. Output only raw JSON. No thinking text. No explanation. No markdown. Start your response with { and end with }.',
      },
      { role: 'user', content: userContent },
    ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as unknown as AsyncIterable<any>

  let rawReply = '', finishReason = ''
  for await (const chunk of stream) {
    if (!chunk.choices?.length) continue
    const delta = chunk.choices[0].delta as Record<string, unknown>

    // Skip reasoning/thinking tokens — only collect actual content
    if (delta.reasoning_content) {
      process.stdout.write(`[NemoClaw:${provider.name}:thinking] ${delta.reasoning_content}`)
    }
    if (typeof delta.content === 'string' && delta.content) {
      rawReply += delta.content
    }
    finishReason = chunk.choices[0]?.finish_reason ?? finishReason
  }

  console.log(`\n[NemoClaw:${provider.name}] finish_reason: ${finishReason}, chars: ${rawReply.length}`)
  if (finishReason === 'length') console.warn(`[NemoClaw:${provider.name}] Cut off — attempting repair`)
  console.log(`[NemoClaw:${provider.name}] Preview: ${rawReply.slice(0, 300)}`)

  return parseAgentResponse(rawReply)
}

// ── Apply files ────────────────────────────────────────────────────────────

function applyModifications(projectPath: string, result: AgentResult): void {
  const files = result.deployFiles ?? []
  console.log(`[NemoClaw] Writing ${files.length} deployment file(s)`)

  for (const file of files) {
    if (!file.filename || !file.content) continue
    const normalized = path.normalize(file.filename).replace(/^(\.\.(\/|\\|$))+/, '')
    const dest       = path.join(projectPath, normalized)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, file.content, 'utf-8')
    console.log(`[NemoClaw] Written → ${normalized}`)
  }
}

// ── Main export ────────────────────────────────────────────────────────────

async function runAnalysis(projectPath: string, errorLogs?: string): Promise<boolean> {
  const context   = buildProjectContext(projectPath)
  const providers = getActiveProviders()

  if (providers.length === 0) {
    console.error('[NemoClaw] No LLM providers configured — set at least one API key in .env')
    return false
  }

  console.log(`[NemoClaw] Active providers: ${providers.map(p => p.name).join(', ')}`)
  if (errorLogs) console.log('[NemoClaw] Re-analyzing with error context...')

  let result: AgentResult | null = null

  for (const provider of providers) {
    try {
      result = await callProvider(provider, context, errorLogs)
      if (result && result.deployFiles?.length > 0) {
        console.log(`[NemoClaw] Success with provider: ${provider.name}`)
        break
      }
      console.warn(`[NemoClaw:${provider.name}] Returned no usable files, trying next provider...`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[NemoClaw:${provider.name}] Failed: ${msg} — trying next provider...`)
    }
  }

  if (!result) {
    console.error('[NemoClaw] All providers failed — skipping modifications')
    return false
  }

  console.log(`[NemoClaw] Project type: ${result.projectType}`)
  if (result.notes) console.log(`[NemoClaw] Notes: ${result.notes}`)

  applyModifications(projectPath, result)
  console.log('[NemoClaw] All deployment files written successfully')
  return true
}

export async function analyzeAndModifyProject(projectPath: string): Promise<void> {
  console.log(`[NemoClaw] Analyzing project at: ${projectPath}`)
  try {
    await runAnalysis(projectPath)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[NemoClaw] Error: ${message}`)
  }
}

/** Re-run analysis feeding back the docker error logs so the LLM can fix the files */
export async function reanalyzeWithErrors(projectPath: string, errorLogs: string): Promise<boolean> {
  console.log(`[NemoClaw] Re-analyzing project due to deploy failure`)
  try {
    return await runAnalysis(projectPath, errorLogs)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[NemoClaw] Re-analysis error: ${message}`)
    return false
  }
}
