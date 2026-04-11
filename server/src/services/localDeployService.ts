import { spawn } from 'child_process'
import { networkInterfaces } from 'os'
import path from 'path'
import fs from 'fs'

export interface DeployResult {
  success: boolean
  logs:    string
  url?:    string
}

// ── Get local LAN IP ───────────────────────────────────────────────────────

const SKIP_PREFIXES    = ['172.', '10.0.', '192.168.56.']
const SKIP_IFACE_NAMES = ['docker', 'veth', 'br-', 'vmnet', 'vbox', 'wsl', 'hyper-v', 'hyperv', 'loopback']

function getLocalIP(): string {
  const nets = networkInterfaces()
  const candidates: string[] = []

  for (const [name, iface] of Object.entries(nets)) {
    if (!iface) continue
    const nameLower = name.toLowerCase()
    if (SKIP_IFACE_NAMES.some(s => nameLower.includes(s))) continue
    for (const net of iface) {
      if (net.family !== 'IPv4' || net.internal) continue
      if (SKIP_PREFIXES.some(p => net.address.startsWith(p))) continue
      candidates.push(net.address)
    }
  }

  return candidates.find(ip => ip.startsWith('192.168.')) ?? candidates[0] ?? '127.0.0.1'
}

function detectPort(projectDir: string): string {
  try {
    const composePath = path.join(projectDir, 'docker-compose.yml')
    if (!fs.existsSync(composePath)) return '80'
    const content = fs.readFileSync(composePath, 'utf-8')
    const matches = [...content.matchAll(/["']?(\d{2,5}):(\d{2,5})["']?/g)]
    if (!matches.length) return '80'
    const port80 = matches.find(m => m[1] === '80')
    if (port80) return '80'
    return matches[0][1]
  } catch { return '80' }
}

// ── Run a shell command and stream output ──────────────────────────────────

function runCommand(
  cmd:     string,
  args:    string[],
  cwd:     string,
  onLog:   (line: string) => void,
): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, shell: true })

    const handle = (chunk: Buffer) => {
      chunk.toString().split('\n').forEach(line => {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('sha256:')) onLog(trimmed)
      })
    }

    proc.stdout.on('data', handle)
    proc.stderr.on('data', handle)
    proc.on('close', (code) => resolve(code ?? 0))
  })
}

// ── Main export ────────────────────────────────────────────────────────────

export async function deployLocally(
  projectDir: string,
  onLog:      (line: string) => void,
): Promise<DeployResult> {
  const logs: string[] = []
  const log = (line: string) => { logs.push(line); onLog(line) }

  log('Starting local Docker deployment...')

  // Stop any previous containers for this project (non-fatal)
  log('Stopping any existing containers...')
  await runCommand('docker', ['compose', 'down', '--remove-orphans'], projectDir, (l) => console.log(`[LocalDeploy] ${l}`))

  log('Building Docker image...')
  const buildCode = await runCommand('docker', ['compose', 'build', '--no-cache'], projectDir, log)
  if (buildCode !== 0) {
    log('Docker build failed.')
    return { success: false, logs: logs.join('\n') }
  }

  log('Starting containers...')
  const upCode = await runCommand('docker', ['compose', 'up', '-d'], projectDir, log)
  if (upCode !== 0) {
    log('Failed to start containers.')
    return { success: false, logs: logs.join('\n') }
  }

  // Brief wait then grab live container logs
  await new Promise(r => setTimeout(r, 3000))
  log('Fetching container logs...')
  await runCommand('docker', ['compose', 'logs', '--tail=30'], projectDir, log)

  const port = detectPort(projectDir)
  const ip   = getLocalIP()
  const url  = `http://${ip}:${port}`

  console.log(`[LocalDeploy] Deployed → ${url}`)
  return { success: true, logs: logs.join('\n'), url }
}
