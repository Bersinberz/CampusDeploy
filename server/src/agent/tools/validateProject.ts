import { spawn } from 'child_process'
import type { Logger } from '../utils/logger.js'

export interface ValidateProjectInput  { projectDir: string }
export interface ValidateProjectOutput { success: boolean; logs: string; url?: string }

function runCommand(cmd: string, args: string[], cwd: string, onLine: (l: string) => void): Promise<number> {
  return new Promise(resolve => {
    const proc = spawn(cmd, args, { cwd, shell: true })
    const handle = (chunk: Buffer) =>
      chunk.toString().split('\n').forEach(l => { const t = l.trim(); if (t && !t.startsWith('sha256:')) onLine(t) })
    proc.stdout.on('data', handle)
    proc.stderr.on('data', handle)
    proc.on('close', code => resolve(code ?? 1))
  })
}

import { networkInterfaces } from 'os'
import fs from 'fs'
import path from 'path'

// Docker/WSL virtual interface prefixes to skip
const SKIP_PREFIXES = ['172.', '10.0.', '192.168.56.']
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
      // Skip Docker bridge ranges
      if (SKIP_PREFIXES.some(p => net.address.startsWith(p))) continue
      candidates.push(net.address)
    }
  }

  // Prefer 192.168.x.x (LAN) then anything else
  return candidates.find(ip => ip.startsWith('192.168.')) ?? candidates[0] ?? '127.0.0.1'
}

function detectPort(projectDir: string): string {
  try {
    const composePath = path.join(projectDir, 'docker-compose.yml')
    if (!fs.existsSync(composePath)) return '80'
    const content = fs.readFileSync(composePath, 'utf-8')
    // Find all "hostPort:containerPort" mappings under ports:
    const matches = [...content.matchAll(/["']?(\d{2,5}):(\d{2,5})["']?/g)]
    if (!matches.length) return '80'
    // Prefer port 80 if present (nginx public entry)
    const port80 = matches.find(m => m[1] === '80')
    if (port80) return '80'
    // Otherwise return the first host port
    return matches[0][1]
  } catch { return '80' }
}

export async function validateProject(input: ValidateProjectInput, log: Logger): Promise<ValidateProjectOutput> {
  const { projectDir } = input
  const logs: string[] = []
  const line = (l: string) => { logs.push(l); log.raw(`  ${l}`) }

  log.info('Stopping existing containers...')
  await runCommand('docker', ['compose', 'down', '--remove-orphans'], projectDir, () => {})

  log.info('Building Docker image...')
  const buildCode = await runCommand('docker', ['compose', 'build', '--no-cache'], projectDir, line)
  if (buildCode !== 0) {
    log.warn('Docker build failed')
    return { success: false, logs: logs.join('\n') }
  }

  log.info('Starting containers...')
  const upCode = await runCommand('docker', ['compose', 'up', '-d'], projectDir, line)
  if (upCode !== 0) {
    log.warn('Containers failed to start')
    return { success: false, logs: logs.join('\n') }
  }

  // Wait for containers to stabilise
  await new Promise(r => setTimeout(r, 3_000))

  log.info('Fetching container logs...')
  await runCommand('docker', ['compose', 'logs', '--tail=40'], projectDir, line)

  const port = detectPort(projectDir)
  const ip   = getLocalIP()
  const url  = `http://${ip}:${port}`

  log.info(`Validation passed → ${url}`)
  return { success: true, logs: logs.join('\n'), url }
}
