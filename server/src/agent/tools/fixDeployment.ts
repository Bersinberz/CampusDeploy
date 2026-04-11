import type { Logger } from '../utils/logger.js'
import { generateDeployment } from './generateDeployment.js'
import { applyFiles } from './applyFiles.js'
import type { AgentResult } from '../utils/schema.js'

export interface FixDeploymentInput {
  projectDir: string
  context:    string
  errorLogs:  string
}
export interface FixDeploymentOutput {
  success: boolean
  result:  AgentResult | null
}

export async function fixDeployment(input: FixDeploymentInput, log: Logger): Promise<FixDeploymentOutput> {
  const { projectDir, context, errorLogs } = input
  log.info('Sending error logs to AI for targeted fix...')
  log.raw('AI is diagnosing the failure and regenerating deployment files...')

  const { result } = await generateDeployment({ context, errorLogs }, log)
  if (!result) {
    log.error('AI could not generate a fix')
    return { success: false, result: null }
  }

  applyFiles({ projectDir, result }, log)
  log.raw('Deployment files updated.')
  return { success: true, result }
}
