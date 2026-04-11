import fs from 'fs'
import path from 'path'
import type { Logger } from '../utils/logger.js'

const SKIP_DIRS      = new Set(['node_modules', '.git', '.next', '__pycache__', 'dist', 'build', '.venv', 'venv'])
const TEXT_EXTS      = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.rb', '.php',
  '.json', '.yaml', '.yml', '.toml', '.env', '.md', '.txt', '.sh', '.dockerfile',
  '.html', '.css', '.scss', '.prisma', '.graphql', '.sql',
])
const MAX_FILE_SIZE  = 3_000
const MAX_TOTAL      = 60_000
const PRIORITY_FILES = ['package.json', 'requirements.txt', 'go.mod', 'pom.xml', 'Cargo.toml', 'README.md']

export interface AnalyzeProjectInput  { projectDir: string }
export interface AnalyzeProjectOutput { context: string; fileList: string[] }

function readFileSafe(p: string): string | null {
  try { return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null } catch { return null }
}

function collectFiles(dir: string, base: string = dir): { rel: string; content: string }[] {
  const results: { rel: string; content: string }[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    const rel  = path.relative(base, full).replace(/\\/g, '/')
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, base))
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (!TEXT_EXTS.has(ext)) continue
      const raw = readFileSafe(full)
      if (!raw) continue
      results.push({ rel, content: raw.slice(0, MAX_FILE_SIZE) })
    }
  }
  return results
}

export function analyzeProject(input: AnalyzeProjectInput, log: Logger): AnalyzeProjectOutput {
  const { projectDir } = input
  log.info(`Walking project tree: ${projectDir}`)

  const allFiles = collectFiles(projectDir)
  log.info(`Found ${allFiles.length} source file(s)`)

  allFiles.sort((a, b) => {
    const aP = PRIORITY_FILES.includes(path.basename(a.rel)) ? 0 : 1
    const bP = PRIORITY_FILES.includes(path.basename(b.rel)) ? 0 : 1
    return aP - bP
  })

  const lines: string[] = [`=== Project Tree ===`, allFiles.map(f => f.rel).join('\n')]
  let total = lines.join('\n').length
  const included: string[] = []

  for (const file of allFiles) {
    const block = `\n=== ${file.rel} ===\n${file.content}`
    if (total + block.length > MAX_TOTAL) { log.info(`Context limit reached at ${total} chars`); break }
    included.push(file.rel)
    lines.push(block)
    total += block.length
  }

  // Stagger SSE file-read messages 300ms apart
  included.forEach((rel, i) => setTimeout(() => log.raw(`Analyzing file: ${rel}`), i * 300))

  log.info(`Context size: ${total} chars, files included: ${included.length}`)
  return { context: lines.join('\n'), fileList: included }
}
