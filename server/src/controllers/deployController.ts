import type { Request, Response } from 'express'
import path from 'path'
import fs from 'fs'
import simpleGit from 'simple-git'
import { Deployment } from '../models/Deployment.js'
import { analyzeAndModifyProject, reanalyzeWithErrors } from '../services/openclawAgent.js'
import { deployToServer } from '../services/remoteDeployService.js'

const PROJECTS_DIR = path.resolve('projects')
const MAX_RETRIES  = 3

// POST /api/deploy
export const createDeployment = async (req: Request, res: Response) => {
  const { name, email, repoUrl } = req.body
  console.log(`[Deploy] Creating deployment for ${email} → ${repoUrl}`)
  try {
    const deployment = await Deployment.create({ name, email, repoUrl, status: 'queued' })
    console.log(`[Deploy] Deployment created with id: ${deployment._id}`)
    res.status(201).json({ message: 'Deployment queued', deployment })
  } catch (err) {
    console.error('[Deploy] Failed to create deployment:', err)
    res.status(500).json({ error: 'Server error' })
  }
}

// GET /api/deploy/:id/clone  — SSE stream
export const cloneDeployment = async (req: Request, res: Response) => {
  const { id } = req.params
  console.log(`[Clone] Starting clone for deployment id: ${id}`)

  const deployment = await Deployment.findById(id)
  if (!deployment) {
    console.warn(`[Clone] Deployment not found: ${id}`)
    res.status(404).json({ error: 'Deployment not found' })
    return
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // disable nginx buffering if behind proxy
  res.flushHeaders()

  // Disable socket timeout for this long-running SSE connection
  req.socket.setTimeout(0)
  req.socket.setNoDelay(true)
  req.socket.setKeepAlive(true)

  const send = (msg: string) => {
    console.log(`[SSE] ${msg}`)
    res.write(`data: ${msg}\n\n`)
    // Force flush — required if any compression middleware is active
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush()
    }
  }

  // Heartbeat every 5s — sends a real (but ignorable) ping so the browser
  // knows the connection is alive during long LLM/SSH operations
  const heartbeat = setInterval(() => {
    res.write('data: __PING__\n\n')
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush()
    }
  }, 5_000)
  req.on('close', () => clearInterval(heartbeat))

  const count      = await Deployment.countDocuments()
  const folderName = `Proj-${String(count).padStart(2, '0')}`
  const cloneDir   = path.join(PROJECTS_DIR, folderName)
  console.log(`[Clone] Target folder: ${cloneDir}`)

  try {
    await Deployment.findByIdAndUpdate(id, { status: 'building', projectFolder: folderName })
    console.log(`[Clone] Deployment ${id} status → building`)

    // ── 1. Clone ──────────────────────────────────────────────────────────
    send('Initializing workspace...')
    if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true })
    if (fs.existsSync(cloneDir))      fs.rmSync(cloneDir, { recursive: true, force: true })

    send(`Cloning repository: ${deployment.repoUrl}`)
    const git = simpleGit()
    await git.clone(deployment.repoUrl, cloneDir, ['--depth', '1'], (_err, data) => {
      if (data) send(data.trim())
    })
    send('Repository cloned successfully.')
    console.log(`[Clone] Repo cloned to ${cloneDir}`)

    // ── 2. Initial LLM analysis ───────────────────────────────────────────
    send('Scanning project structure...')
    send('Analyzing codebase and detecting stack...')
    await analyzeAndModifyProject(cloneDir)
    send('Deployment files generated: Dockerfile, docker-compose.yml, nginx.conf')
    send('Analysis complete.')

    // ── 3. Deploy + retry loop ────────────────────────────────────────────
    let deployed    = false
    let deployUrl   = ''
    let lastLogs    = ''
    let retryCount  = 0

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (attempt === 1) {
        send('Starting deployment to remote server...')
      } else {
        send(`Retrying deployment — attempt ${attempt} of ${MAX_RETRIES}...`)
      }
      console.log(`[Deploy] Attempt ${attempt}/${MAX_RETRIES}`)

      send('Establishing SSH connection...')
      const result = await deployToServer(cloneDir, folderName, (line) => {
        if (line && line.trim() && !line.startsWith('sha256:')) send(`  ${line}`)
      })
      lastLogs = result.logs

      await Deployment.findByIdAndUpdate(id, { deployLogs: lastLogs, retryCount })

      if (result.success) {
        deployed  = true
        deployUrl = result.url ?? ''
        send('Deployment successful.')
        send(`Live URL: ${deployUrl}`)
        console.log(`[Deploy] Success on attempt ${attempt} → ${deployUrl}`)
        break
      }

      send(`Deployment failed on attempt ${attempt}.`)
      console.warn(`[Deploy] Attempt ${attempt} failed, re-analyzing...`)

      if (attempt < MAX_RETRIES) {
        send('Sending error logs to AI agent for re-analysis...')
        send('AI is diagnosing the failure and regenerating deployment files...')
        const fixed = await reanalyzeWithErrors(cloneDir, lastLogs)
        if (!fixed) {
          send('ERROR: AI agent could not generate a fix. Aborting.')
          break
        }
        send('Deployment files updated. Retrying...')
        retryCount++
      }
    }

    if (deployed) {
      await Deployment.findByIdAndUpdate(id, { status: 'live', deployUrl, serverIp: process.env.SERVER_IP })
      console.log(`[Deploy] Deployment ${id} status → live`)
    } else {
      await Deployment.findByIdAndUpdate(id, { status: 'failed' })
      console.error(`[Deploy] All ${MAX_RETRIES} attempts failed for deployment ${id}`)
      send(`ERROR: Deployment failed after ${MAX_RETRIES} attempts.`)
    }

    send('__DONE__')
    clearInterval(heartbeat)
    res.end()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Clone failed'
    console.error(`[Clone] Error: ${message}`)
    send(`ERROR: ${message}`)
    await Deployment.findByIdAndUpdate(id, { status: 'failed' })
    send('__DONE__')
    clearInterval(heartbeat)
    res.end()
  }
}

// GET /api/deploy
export const getDeployments = async (_req: Request, res: Response) => {
  console.log('[Deploy] Fetching all deployments')
  try {
    const deployments = await Deployment.find().sort({ createdAt: -1 })
    console.log(`[Deploy] Found ${deployments.length} deployment(s)`)
    res.json(deployments)
  } catch (err) {
    console.error('[Deploy] Failed to fetch deployments:', err)
    res.status(500).json({ error: 'Server error' })
  }
}
