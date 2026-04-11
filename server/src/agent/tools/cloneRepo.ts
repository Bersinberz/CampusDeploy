import fs from 'fs'
import path from 'path'
import simpleGit from 'simple-git'
import type { Logger } from '../utils/logger.js'

export interface CloneRepoInput  { repoUrl: string; targetDir: string }
export interface CloneRepoOutput { success: boolean; cloneDir: string; error?: string }

export async function cloneRepo(input: CloneRepoInput, log: Logger): Promise<CloneRepoOutput> {
  const { repoUrl, targetDir } = input
  log.info(`Cloning ${repoUrl} → ${targetDir}`)

  try {
    const projectsDir = path.dirname(targetDir)
    if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true })
    if (fs.existsSync(targetDir))    fs.rmSync(targetDir, { recursive: true, force: true })

    log.raw(`Cloning repository: ${repoUrl}`)
    const git = simpleGit()
    await git.clone(repoUrl, targetDir, ['--depth', '1'])
    log.raw('Repository cloned.')
    return { success: true, cloneDir: targetDir }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.error(`Clone failed: ${error}`)
    return { success: false, cloneDir: targetDir, error }
  }
}
