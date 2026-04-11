import { z } from 'zod'

export const DeployFileSchema = z.object({
  filename: z.string().min(1),
  content:  z.string().min(1),
})

export const AgentResultSchema = z.object({
  projectType: z.string().min(1),
  deployFiles: z.array(DeployFileSchema).min(1),
  notes:       z.string(),
})

export type DeployFile  = z.infer<typeof DeployFileSchema>
export type AgentResult = z.infer<typeof AgentResultSchema>

// ── JSON repair + parse ────────────────────────────────────────────────────

function repairJson(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/)
  let s = (fenceMatch ? fenceMatch[1] : raw).trim()

  let braces = 0, brackets = 0, inString = false, escape = false
  for (const ch of s) {
    if (escape)          { escape = false; continue }
    if (ch === '\\')     { escape = true;  continue }
    if (ch === '"')      { inString = !inString; continue }
    if (inString)        continue
    if (ch === '{')      braces++
    else if (ch === '}') braces--
    else if (ch === '[') brackets++
    else if (ch === ']') brackets--
  }
  if (inString) s += '"'
  s += ']'.repeat(Math.max(0, brackets))
  s += '}'.repeat(Math.max(0, braces))
  return s
}

export function parseAndValidate(raw: string): AgentResult | null {
  const attempts = [
    () => {
      const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
      return JSON.parse((fence ? fence[1] : raw).trim())
    },
    () => JSON.parse(repairJson(raw)),
  ]

  for (const attempt of attempts) {
    try {
      const parsed = attempt()
      const result = AgentResultSchema.safeParse(parsed)
      if (result.success) return result.data
      console.warn('[Schema] Validation failed:', result.error.issues.map(i => i.message).join(', '))
    } catch { /* try next */ }
  }
  return null
}
