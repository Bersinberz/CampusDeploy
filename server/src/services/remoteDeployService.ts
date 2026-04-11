import { NodeSSH } from 'node-ssh'
import path from 'path'
import fs from 'fs'
import { deployLocally } from './localDeployService.js'

export interface DeployResult {
  success:  boolean
  logs:     string
  url?:     string
}

const SSH_HOST     = process.env.SERVER_IP       ?? ''
const SSH_USER     = process.env.SERVER_USER     ?? 'root'
const SSH_KEY_PATH = process.env.SERVER_SSH_KEY_PATH ?? ''
const SSH_PASSWORD = process.env.SERVER_PASSWORD ?? ''
const REMOTE_BASE  = process.env.REMOTE_PROJECTS_DIR ?? '/opt/campusdeploy/projects'

// ── SSH connect ────────────────────────────────────────────────────────────

async function connect(): Promise<NodeSSH> {
  const ssh = new NodeSSH()
  const connectOpts: Parameters<NodeSSH['connect']>[0] = {
    host:     SSH_HOST,
    username: SSH_USER,
    ...(SSH_KEY_PATH
      ? { privateKeyPath: SSH_KEY_PATH }
      : { password: SSH_PASSWORD }),
  }
  console.log(`[RemoteDeploy] Connecting to ${SSH_USER}@${SSH_HOST}`)
  await ssh.connect(connectOpts)
  console.log(`[RemoteDeploy] SSH connected`)
  return ssh
}

// ── Upload project folder via SCP ──────────────────────────────────────────

async function uploadProject(ssh: NodeSSH, localDir: string, remoteDir: string, onLog: (l: string) => void): Promise<void> {
  console.log(`[RemoteDeploy] Uploading ${localDir} → ${remoteDir}`)
  onLog(`Uploading project files to ${SSH_HOST}...`)
  await ssh.execCommand(`mkdir -p ${remoteDir}`)
  let uploaded = 0
  await ssh.putDirectory(localDir, remoteDir, {
    recursive:   true,
    concurrency: 5,
    validate:    (itemPath) => !itemPath.includes('node_modules') && !itemPath.includes('.git'),
    tick: (local, _remote, err) => {
      if (err) console.error(`[RemoteDeploy] Upload error: ${local}`, err)
      else {
        uploaded++
        if (uploaded % 10 === 0) onLog(`  Uploaded ${uploaded} files...`)
        console.log(`[RemoteDeploy] Uploaded: ${path.basename(local)}`)
      }
    },
  })
  onLog(`Upload complete. ${uploaded} files transferred.`)
  console.log(`[RemoteDeploy] Upload complete`)
}

// ── Run docker compose ─────────────────────────────────────────────────────

async function runDockerCompose(
  ssh:       NodeSSH,
  remoteDir: string,
  onLog:     (line: string) => void,
): Promise<{ exitCode: number; logs: string }> {
  console.log(`[RemoteDeploy] Running docker compose in ${remoteDir}`)

  const logs: string[] = []

  // Pull images first (non-fatal)
  await ssh.execCommand('docker compose pull', {
    cwd: remoteDir,
    onStdout: (chunk) => { const l = chunk.toString().trim(); onLog(l); logs.push(l) },
    onStderr:  (chunk) => { const l = chunk.toString().trim(); onLog(l); logs.push(l) },
  })

  const result = await ssh.execCommand('docker compose up -d --build 2>&1', {
    cwd: remoteDir,
    onStdout: (chunk) => { const l = chunk.toString().trim(); onLog(l); logs.push(l) },
    onStderr:  (chunk) => { const l = chunk.toString().trim(); onLog(l); logs.push(l) },
  })

  // Give containers a moment then grab live logs
  await ssh.execCommand('sleep 3')
  const liveLogs = await ssh.execCommand('docker compose logs --tail=50 2>&1', { cwd: remoteDir })
  if (liveLogs.stdout) {
    liveLogs.stdout.split('\n').forEach(l => { onLog(l); logs.push(l) })
  }

  return { exitCode: result.code ?? 0, logs: logs.join('\n') }
}

// ── Detect exposed port from docker-compose.yml ────────────────────────────

function detectPort(localDir: string): string {
  try {
    const composePath = path.join(localDir, 'docker-compose.yml')
    if (!fs.existsSync(composePath)) return '80'
    const content = fs.readFileSync(composePath, 'utf-8')
    const match   = content.match(/["']?(\d{2,5}):(\d{2,5})["']?/)
    return match ? match[2] : '80'
  } catch {
    return '80'
  }
}

// ── Main export ────────────────────────────────────────────────────────────

export async function deployToServer(
  localDir:   string,
  folderName: string,
  onLog:      (line: string) => void,
): Promise<DeployResult> {
  // No remote server configured — deploy locally instead
  if (!SSH_HOST || process.env.LOCAL_DEPLOY === 'true') {
    console.log('[Deploy] No SERVER_IP set or LOCAL_DEPLOY=true — deploying locally')
    return deployLocally(localDir, onLog)
  }

  const remoteDir = `${REMOTE_BASE}/${folderName}`
  const ssh       = await connect()

  try {
    onLog(`Uploading project to ${SSH_HOST}...`)
    await uploadProject(ssh, localDir, remoteDir, onLog)

    onLog('Running docker compose build and up...')
    const { exitCode, logs } = await runDockerCompose(ssh, remoteDir, onLog)

    if (exitCode !== 0) {
      console.error(`[RemoteDeploy] docker compose exited with code ${exitCode}`)
      return { success: false, logs }
    }

    const port = detectPort(localDir)
    const url  = `http://${SSH_HOST}:${port}`
    console.log(`[RemoteDeploy] Deployed successfully → ${url}`)
    onLog(`Deployed → ${url}`)
    return { success: true, logs, url }
  } finally {
    ssh.dispose()
    console.log(`[RemoteDeploy] SSH connection closed`)
  }
}
