import fs from 'fs'
import path from 'path'
import type { AgentResult } from '../utils/schema.js'
import type { Logger } from '../utils/logger.js'

// Deployment-only filenames — never overwrite source code
const ALLOWED_FILENAMES = new Set([
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.env', '.env.example', '.env.production', '.env.local',
  'nginx.conf', '.dockerignore',
  '.github/workflows/deploy.yml',
])

export interface ApplyFilesInput  { projectDir: string; result: AgentResult }
export interface ApplyFilesOutput { written: string[]; skipped: string[] }

export function applyFiles(input: ApplyFilesInput, log: Logger): ApplyFilesOutput {
  const { projectDir, result } = input
  const written: string[] = []
  const skipped: string[] = []

  for (const file of result.deployFiles) {
    if (!file.filename || !file.content) { skipped.push(file.filename ?? '?'); continue }

    // Path traversal guard
    const normalized = path.normalize(file.filename).replace(/^(\.\.(\/|\\|$))+/, '')

    // Only write deployment-related files
    const base = path.basename(normalized)
    const isAllowed = ALLOWED_FILENAMES.has(normalized) || ALLOWED_FILENAMES.has(base)
    if (!isAllowed) {
      log.warn(`Skipping non-deployment file: ${normalized}`)
      skipped.push(normalized)
      continue
    }

    const dest = path.join(projectDir, normalized)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, file.content, 'utf-8')
    log.info(`Written → ${normalized}`)
    written.push(normalized)
  }

  return { written, skipped }
}
