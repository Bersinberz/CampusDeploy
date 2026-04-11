/**
 * NemoClaw Agent Runner
 * Autonomous DevOps agent loop:
 *   clone → analyze → generate → apply → validate
 *   if validate fails → fix → apply → validate → repeat (max iterations)
 */

import path from 'path'
import { cloneRepo }          from './tools/cloneRepo.js'
import { analyzeProject }     from './tools/analyzeProject.js'
import { runProjectAgent }    from './tools/projectAgent.js'
import { applyFiles }         from './tools/applyFiles.js'
import { validateProject }    from './tools/validateProject.js'
import { makeLogger }         from './utils/logger.js'
import type { LogFn }         from './utils/logger.js'

// ── Agent config (mirrors agent.devops.yaml) ───────────────────────────────

const AGENT_CONFIG = {
  name:          'NemoClaw DevOps Agent',
  maxIterations: 5,
  stopCondition: 'validation_success',
  projectsDir:   path.resolve('projects'),
}

// ── Agent state ────────────────────────────────────────────────────────────

interface AgentState {
  step:        'idle' | 'clone' | 'analyze' | 'generate' | 'apply' | 'validate' | 'fix' | 'done' | 'failed'
  iteration:   number
  context:     string
  lastLogs:    string
  deployUrl:   string
  error?:      string
}

// ── Main agent entry point ─────────────────────────────────────────────────

export interface AgentRunInput {
  repoUrl:    string
  folderName: string
  onLog:      LogFn
}

export interface AgentRunOutput {
  success:   boolean
  deployUrl: string
  logs:      string
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const { repoUrl, folderName, onLog } = input
  const log       = makeLogger('NemoClaw', onLog)
  const cloneDir  = path.join(AGENT_CONFIG.projectsDir, folderName)
  const allLogs:  string[] = []

  const track = (msg: string) => { allLogs.push(msg); onLog(msg) }

  const state: AgentState = {
    step:      'idle',
    iteration: 0,
    context:   '',
    lastLogs:  '',
    deployUrl: '',
  }

  // ── Step 1: Clone ──────────────────────────────────────────────────────
  state.step = 'clone'
  track('Initializing workspace...')
  const cloneOut = await cloneRepo({ repoUrl, targetDir: cloneDir }, log)
  if (!cloneOut.success) {
    track(`ERROR: ${cloneOut.error}`)
    return { success: false, deployUrl: '', logs: allLogs.join('\n') }
  }

  // ── Step 2: Analyze ────────────────────────────────────────────────────
  state.step = 'analyze'
  track('Analyzing Your Project...')
  // File collection still runs to emit "Analyzing file:" SSE messages
  analyzeProject({ projectDir: cloneDir }, log)

  // ── Agent loop: agent → apply → validate (→ fix → repeat) ─────────────
  while (state.iteration < AGENT_CONFIG.maxIterations) {
    state.iteration++
    log.info(`Agent iteration ${state.iteration}/${AGENT_CONFIG.maxIterations}`)

    // ── Step 3: Agent analyzes + generates ───────────────────────────────
    state.step = 'generate'
    if (state.iteration > 1) track(`Retrying deployment — attempt ${state.iteration} of ${AGENT_CONFIG.maxIterations}...`)

    const agentOut = await runProjectAgent(
      { projectDir: cloneDir, errorLogs: state.iteration > 1 ? state.lastLogs : undefined },
      log,
    )

    if (!agentOut.result) {
      track('ERROR: Agent could not generate deployment files. Aborting.')
      state.step = 'failed'
      break
    }

    track('✓ Production code is ready.')

    // ── Step 4: Apply ────────────────────────────────────────────────────
    state.step = 'apply'
    applyFiles({ projectDir: cloneDir, result: agentOut.result }, log)

    // ── Step 5: Validate ─────────────────────────────────────────────────
    state.step = 'validate'
    if (state.iteration === 1) track('Deployment started...')

    const valOut = await validateProject({ projectDir: cloneDir }, log)
    state.lastLogs = valOut.logs

    if (valOut.success) {
      state.step      = 'done'
      state.deployUrl = valOut.url ?? ''
      track('Deployment successful.')
      track(`Live URL: ${state.deployUrl}`)
      break
    }

    track(`Deployment failed on attempt ${state.iteration}.`)

    // ── Step 6: Agent self-corrects on next iteration ─────────────────────
    if (state.iteration >= AGENT_CONFIG.maxIterations) {
      track(`ERROR: Deployment failed after ${AGENT_CONFIG.maxIterations} attempts.`)
      state.step = 'failed'
    }
  }

  if (state.step !== 'done') {
    if (state.step !== 'failed') {
      track(`ERROR: Deployment failed after ${AGENT_CONFIG.maxIterations} attempts.`)
    }
    return { success: false, deployUrl: '', logs: allLogs.join('\n') }
  }

  return { success: true, deployUrl: state.deployUrl, logs: allLogs.join('\n') }
}
