import type { Request, Response } from 'express'
import path from 'path'
import { Deployment } from '../models/Deployment.js'
import { runAgent }   from '../agent/agentRunner.js'

const PROJECTS_DIR = path.resolve('projects')

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
  console.log(`[Deploy] Starting agent for deployment id: ${id}`)

  const deployment = await Deployment.findById(id)
  if (!deployment) {
    res.status(404).json({ error: 'Deployment not found' })
    return
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  req.socket.setTimeout(0)
  req.socket.setNoDelay(true)
  req.socket.setKeepAlive(true)

  const send = (msg: string) => {
    console.log(`[SSE] ${msg}`)
    res.write(`data: ${msg}\n\n`)
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush()
    }
  }

  const heartbeat = setInterval(() => {
    res.write('data: __PING__\n\n')
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush()
    }
  }, 5_000)
  req.on('close', () => clearInterval(heartbeat))

  const count      = await Deployment.countDocuments()
  const folderName = `Proj-${String(count).padStart(2, '0')}`

  try {
    await Deployment.findByIdAndUpdate(id, { status: 'building', projectFolder: folderName })

    const result = await runAgent({
      repoUrl:    deployment.repoUrl,
      folderName,
      onLog:      send,
    })

    if (result.success) {
      await Deployment.findByIdAndUpdate(id, { status: 'live', deployUrl: result.deployUrl })
    } else {
      await Deployment.findByIdAndUpdate(id, { status: 'failed' })
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Agent error'
    console.error(`[Deploy] Agent error: ${message}`)
    send(`ERROR: ${message}`)
    await Deployment.findByIdAndUpdate(id, { status: 'failed' })
  }

  send('__DONE__')
  clearInterval(heartbeat)
  res.end()
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
