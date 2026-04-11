import OpenAI from 'openai'
import { parseAndValidate } from '../utils/schema.js'
import type { AgentResult } from '../utils/schema.js'
import type { Logger } from '../utils/logger.js'

interface LLMProvider {
  name:        string
  baseURL:     string
  apiKey:      string
  model:       string
  temperature: number
  top_p:       number
  max_tokens:  number
  thinking?:   boolean
}

const PROVIDERS: LLMProvider[] = [
  {
    name:        'Kimi K2',
    baseURL:     'https://integrate.api.nvidia.com/v1',
    apiKey:      process.env.KIMI_API_KEY ?? '',
    model:       'moonshotai/kimi-k2-instruct',
    temperature: 0.6,
    top_p:       0.9,
    max_tokens:  8192,
    thinking:    false,
  },
  {
    name:        'DeepSeek V3.2',
    baseURL:     'https://integrate.api.nvidia.com/v1',
    apiKey:      process.env.DEEPSEEK_API_KEY ?? '',
    model:       'deepseek-ai/deepseek-v3.2',
    temperature: 1,
    top_p:       0.95,
    max_tokens:  8192,
    thinking:    true,
  },
]

export interface GenerateDeploymentInput  { context: string; errorLogs?: string }
export interface GenerateDeploymentOutput { result: AgentResult | null; provider: string }

const DEPLOY_FILES_SCHEMA =
  `{"projectType":"...","deployFiles":[` +
  `{"filename":"Dockerfile","content":"..."},` +
  `{"filename":"docker-compose.yml","content":"..."},` +
  `{"filename":".env.example","content":"..."},` +
  `{"filename":"nginx.conf","content":"..."}` +
  `],"notes":"..."}`

function buildPrompt(context: string, errorLogs?: string): string {
  if (errorLogs) {
    return `Project files:\n${context}\n\n` +
      `Previous deployment FAILED:\n${errorLogs}\n\n` +
      `Fix the deployment files. Output ONLY this JSON:\n${DEPLOY_FILES_SCHEMA}`
  }
  return `Project files:\n${context}\n\nOutput ONLY this JSON:\n${DEPLOY_FILES_SCHEMA}`
}

async function callProvider(
  provider: LLMProvider,
  context:  string,
  errorLogs: string | undefined,
  log:      Logger,
): Promise<AgentResult | null> {
  const client    = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL })
  const extraBody = provider.thinking ? { chat_template_kwargs: { thinking: true } } : undefined

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = (await client.chat.completions.create({
    model:       provider.model,
    stream:      true,
    temperature: provider.temperature,
    top_p:       provider.top_p,
    max_tokens:  provider.max_tokens,
    ...(extraBody ? { extra_body: extraBody } : {}),
    messages: [
      { role: 'system', content: 'You are a JSON API. Output only raw JSON. No markdown. No explanation. Start with { end with }.' },
      { role: 'user',   content: buildPrompt(context, errorLogs) },
    ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as unknown as AsyncIterable<any>

  log.raw('__AI_START__')
  let rawReply = '', finishReason = ''

  for await (const chunk of stream) {
    if (!chunk.choices?.length) continue
    const delta = chunk.choices[0].delta as Record<string, unknown>
    if (typeof delta.content === 'string' && delta.content) rawReply += delta.content
    finishReason = chunk.choices[0]?.finish_reason ?? finishReason
  }

  log.raw('__AI_DONE__')
  log.info(`Provider ${provider.name} — finish: ${finishReason}, chars: ${rawReply.length}`)
  if (finishReason === 'length') log.warn(`${provider.name} response was cut off — attempting repair`)

  const result = parseAndValidate(rawReply)
  if (!result) log.warn(`${provider.name} returned invalid schema`)
  return result
}

export async function generateDeployment(
  input: GenerateDeploymentInput,
  log:   Logger,
): Promise<GenerateDeploymentOutput> {
  const active = PROVIDERS.filter(p => p.apiKey.trim() !== '')
  if (active.length === 0) {
    log.error('No LLM providers configured')
    return { result: null, provider: 'none' }
  }

  for (const provider of active) {
    log.info(`Trying provider: ${provider.name}`)
    try {
      const result = await callProvider(provider, input.context, input.errorLogs, log)
      if (result && result.deployFiles.length > 0) {
        log.info(`Success with ${provider.name} — project type: ${result.projectType}`)
        return { result, provider: provider.name }
      }
      log.warn(`${provider.name} returned no usable files, trying next...`)
    } catch (err) {
      log.warn(`${provider.name} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  log.error('All providers failed')
  return { result: null, provider: 'none' }
}
