import type { Request, Response } from 'express'
import path from 'path'
import fs from 'fs'
import simpleGit from 'simple-git'
import { Deployment } from '../models/Deployment.js'

const PROJECTS_DIR = path.resolve('projects')

// POST /api/deploy
export const createDeployment = async (req: Request, res: Response) => {
  const { name, email, repoUrl } = req.body

  if (!name || !email || !repoUrl) {
    res.status(400).json({ error: 'name, email and repoUrl are required' })
    return
  }

  try {
    const deployment = await Deployment.create({ name, email, repoUrl, status: 'queued' })
    res.status(201).json({ message: 'Deployment queued', deployment })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
}

// GET /api/deploy/:id/clone  — SSE stream of clone logs
export const cloneDeployment = async (req: Request, res: Response) => {
  const { id } = req.params

  const deployment = await Deployment.findById(id)
  if (!deployment) {
    res.status(404).json({ error: 'Deployment not found' })
    return
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (msg: string) => res.write(`data: ${msg}\n\n`)

  const cloneDir = path.join(PROJECTS_DIR, id)

  try {
    await Deployment.findByIdAndUpdate(id, { status: 'building' })

    send('Initialising clone...')

    if (!fs.existsSync(PROJECTS_DIR)) fs.mkdirSync(PROJECTS_DIR, { recursive: true })
    if (fs.existsSync(cloneDir)) fs.rmSync(cloneDir, { recursive: true, force: true })

    send(`Cloning ${deployment.repoUrl} ...`)

    const git = simpleGit()
    await git.clone(deployment.repoUrl, cloneDir, ['--depth', '1'], (err, data) => {
      if (data) send(data.trim())
    })

    send('Project cloned successfully ✓')

    await Deployment.findByIdAndUpdate(id, { status: 'live' })

    send('__DONE__')
    res.end()
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Clone failed'
    send(`ERROR: ${message}`)
    await Deployment.findByIdAndUpdate(id, { status: 'failed' })
    send('__DONE__')
    res.end()
  }
}

// GET /api/deploy
export const getDeployments = async (_req: Request, res: Response) => {
  try {
    const deployments = await Deployment.find().sort({ createdAt: -1 })
    res.json(deployments)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server error' })
  }
}
