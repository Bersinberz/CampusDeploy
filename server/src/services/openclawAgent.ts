/**
 * Thin compatibility shim — the controller calls these two functions.
 * All real logic now lives in the NemoClaw agent architecture under src/agent/.
 */

import { analyzeProject }     from '../agent/tools/analyzeProject.js'
import { runProjectAgent }    from '../agent/tools/projectAgent.js'
import { applyFiles }         from '../agent/tools/applyFiles.js'
import { makeLogger }         from '../agent/utils/logger.js'

export async function analyzeAndModifyProject(projectPath: string, onLog?: (msg: string) => void): Promise<void> {
  const log = makeLogger('NemoClaw', onLog)
  analyzeProject({ projectDir: projectPath }, log)
  const { result } = await runProjectAgent({ projectDir: projectPath }, log)
  if (result) applyFiles({ projectDir: projectPath, result }, log)
  else log.error('Agent failed to generate deployment files')
}

export async function reanalyzeWithErrors(
  projectPath: string,
  errorLogs:   string,
  onLog?:      (msg: string) => void,
): Promise<boolean> {
  const log = makeLogger('NemoClaw', onLog)
  const { result } = await runProjectAgent({ projectDir: projectPath, errorLogs }, log)
  if (!result) { log.error('Agent re-analysis failed'); return false }
  applyFiles({ projectDir: projectPath, result }, log)
  return true
}
