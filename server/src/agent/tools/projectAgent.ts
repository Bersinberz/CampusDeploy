/**
 * NemoClaw Project Analysis Agent
 *
 * Tools:
 *   list_directory  — explore project tree
 *   read_file       — read any file
 *   patch_file      — fix source code issues before building
 *   write_files     — write deployment files (ends the loop)
 */

import OpenAI from 'openai'
import fs from 'fs'
import path from 'path'
import type { Logger } from '../utils/logger.js'
import { AgentResultSchema } from '../utils/schema.js'
import type { AgentResult } from '../utils/schema.js'

// ── Tool definitions ───────────────────────────────────────────────────────

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name:        'list_directory',
      description: 'List files and folders in a directory of the cloned project.',
      parameters: {
        type: 'object',
        properties: {
          dir: { type: 'string', description: 'Relative path inside the project (e.g. "." or "client/src")' },
        },
        required: ['dir'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name:        'read_file',
      description: 'Read the contents of a file in the cloned project.',
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Relative path to the file' },
        },
        required: ['file'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name:        'patch_file',
      description: 'Fix a source code file by replacing its full content. Use this to fix TypeScript errors, import issues, or any source code problem that would prevent the build from succeeding. You MUST read the file first before patching.',
      parameters: {
        type: 'object',
        properties: {
          file:    { type: 'string', description: 'Relative path to the file to patch' },
          content: { type: 'string', description: 'The complete new content of the file' },
          reason:  { type: 'string', description: 'Why this patch is needed' },
        },
        required: ['file', 'content', 'reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name:        'write_files',
      description: 'Write production deployment files. Call this ONLY after fully understanding the project AND fixing any source code issues.',
      parameters: {
        type: 'object',
        properties: {
          projectType: { type: 'string' },
          deployFiles: {
            type:  'array',
            items: {
              type: 'object',
              properties: {
                filename: { type: 'string' },
                content:  { type: 'string' },
              },
              required: ['filename', 'content'],
            },
            description: 'Deployment files to write: Dockerfile, docker-compose.yml, nginx.conf, .env, .env.example',
          },
          notes: { type: 'string' },
        },
        required: ['projectType', 'deployFiles', 'notes'],
      },
    },
  },
]

// ── Tool executors ─────────────────────────────────────────────────────────

const SKIP_DIRS    = new Set(['node_modules', '.git', '__pycache__', 'dist', 'build', '.venv', 'venv', '.next'])
const MAX_FILE_READ = 4_000

// Source files the agent is allowed to patch (no deployment files, no binaries)
const PATCHABLE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.java', '.rb',
  '.css', '.scss', '.html', '.json', '.yaml', '.yml', '.toml', '.env',
])

function execListDirectory(projectDir: string, dir: string): string {
  const target = path.join(projectDir, dir)
  if (!fs.existsSync(target)) return `Directory not found: ${dir}`
  try {
    const entries = fs.readdirSync(target, { withFileTypes: true })
    return entries
      .filter(e => !SKIP_DIRS.has(e.name))
      .map(e => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`)
      .join('\n') || '(empty)'
  } catch (e) { return `Error: ${e}` }
}

function execReadFile(projectDir: string, file: string): string {
  const norm   = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '')
  const target = path.join(projectDir, norm)
  if (!fs.existsSync(target)) return `File not found: ${file}`
  try {
    const content = fs.readFileSync(target, 'utf-8')
    return content.length > MAX_FILE_READ
      ? content.slice(0, MAX_FILE_READ) + `\n...(truncated)`
      : content
  } catch (e) { return `Error: ${e}` }
}

function execPatchFile(projectDir: string, file: string, content: string, reason: string, log: Logger): string {
  const norm = path.normalize(file).replace(/^(\.\.(\/|\\|$))+/, '')
  const ext  = path.extname(norm).toLowerCase()

  if (!PATCHABLE_EXTS.has(ext)) return `Cannot patch file with extension ${ext}`

  // Block patching deployment files — those go through write_files
  const base = path.basename(norm)
  if (['Dockerfile', 'docker-compose.yml', 'nginx.conf'].includes(base)) {
    return `Use write_files to update deployment files, not patch_file`
  }
  const target = path.join(projectDir, norm)
  if (!fs.existsSync(target)) return `File not found: ${file}`

  try {
    fs.writeFileSync(target, content, 'utf-8')
    log.info(`Patched source file: ${norm} — ${reason}`)
    log.raw(`Fixing source: ${norm}`)
    return `Successfully patched ${norm}`
  } catch (e) { return `Error patching: ${e}` }
}

function executeTool(projectDir: string, name: string, args: Record<string, unknown>, log: Logger): string {
  switch (name) {
    case 'list_directory': return execListDirectory(projectDir, String(args.dir ?? '.'))
    case 'read_file':      return execReadFile(projectDir, String(args.file ?? ''))
    case 'patch_file':     return execPatchFile(projectDir, String(args.file ?? ''), String(args.content ?? ''), String(args.reason ?? ''), log)
    default:               return `Unknown tool: ${name}`
  }
}

// ── Providers ─────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 40

interface LLMProvider { name: string; baseURL: string; apiKey: string; model: string }

const PROVIDERS: LLMProvider[] = [
  { name: 'Kimi K2',      baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: process.env.KIMI_API_KEY ?? '',     model: 'moonshotai/kimi-k2-instruct' },
  { name: 'DeepSeek V3.2',baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: process.env.DEEPSEEK_API_KEY ?? '', model: 'deepseek-ai/deepseek-v3.2' },
]

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an autonomous DevOps agent. Analyze a cloned GitHub project and produce production-ready deployment files.

TOOLS:
- list_directory: explore project structure
- read_file: read any file
- patch_file: fix source code issues (TypeScript errors, import problems, etc.) BEFORE building
- write_files: write Dockerfile, docker-compose.yml, nginx.conf, .env (call once when ready)

PROCESS:
1. List root directory to understand structure
2. Read key files: package.json, requirements.txt, go.mod, tsconfig.json, etc.
3. Detect: framework, language, build commands, start commands, ports, env vars, DB type
4. If there are TypeScript/build errors in the error logs, read the failing source files and use patch_file to fix them
5. Generate correct deployment files and call write_files

═══════════════════════════════════════════════
EXACT TEMPLATES TO FOLLOW (proven working)
═══════════════════════════════════════════════

── DOCKERFILE (monorepo with client + server) ──
\`\`\`
# Stage 1: Client Build
FROM node:18-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: Server Build
FROM node:18-alpine AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# Stage 3: Production Server
FROM node:18-alpine AS production
WORKDIR /app
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/package*.json ./
RUN npm ci --omit=dev
EXPOSE <SERVER_PORT>
CMD ["node", "dist/index.js"]

# Stage 4: Nginx for Static Files
FROM nginx:alpine AS nginx-stage
COPY --from=client-build /app/client/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
\`\`\`

── DOCKER-COMPOSE ──
\`\`\`
services:
  mongo:
    image: mongo:7.0
    container_name: <project>-mongo
    restart: unless-stopped
    expose:
      - "27017"
    environment:
      - MONGO_INITDB_ROOT_USERNAME=admin
      - MONGO_INITDB_ROOT_PASSWORD=password
    volumes:
      - mongo-data:/data/db
    networks:
      - app-network

  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: production
    container_name: <project>-app
    restart: unless-stopped
    expose:
      - "<SERVER_PORT>"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    networks:
      - app-network
    depends_on:
      - mongo

  nginx:
    build:
      context: .
      dockerfile: Dockerfile
      target: nginx-stage
    container_name: <project>-nginx
    restart: unless-stopped
    ports:
      - "80:80"
    networks:
      - app-network
    depends_on:
      - app

networks:
  app-network:
    driver: bridge

volumes:
  mongo-data:
\`\`\`

── NGINX.CONF ──
\`\`\`
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    types {
        application/javascript js mjs;
        text/css css;
    }

    upstream backend {
        server app:<SERVER_PORT>;
    }

    server {
        listen 80;
        server_name localhost;

        location / {
            root /usr/share/nginx/html;
            index index.html;
            try_files $uri $uri/ /index.html;
        }

        location /api/ {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }
    }
}
\`\`\`

── .ENV ──
\`\`\`
MONGO_URI=mongodb://admin:password@mongo:27017/<dbname>?authSource=admin
JWT_SECRET=supersecretjwtkey_changeme
PORT=<SERVER_PORT>
NODE_ENV=production
\`\`\`

═══════════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════════

BUILD ERRORS:
- "tsc: not found" → use "npm ci" (not --only=production) in build stages
- "Property X does not exist on type Y" → read the file, fix with patch_file
- NEVER fix source code errors in Dockerfile using sed or shell commands

DOCKER-COMPOSE:
- NEVER use "version:" key (obsolete, causes warnings)
- mongo: use expose not ports, set MONGO_INITDB_ROOT_USERNAME/PASSWORD
- app: use env_file .env, expose not ports, restart: unless-stopped
- nginx: ports "80:80", depends_on app, restart: unless-stopped
- All services on same named network

NGINX:
- ALWAYS use upstream block — never proxy_pass http://app:PORT directly
- ALWAYS include mime.types + types block override for js/css
- location / must have try_files $uri $uri/ /index.html for SPA routing

ENV:
- MONGO_URI must include credentials: mongodb://admin:password@mongo:27017/<db>?authSource=admin
- Always write .env (not just .env.example) so the container has real config`

// ── Main exports ───────────────────────────────────────────────────────────

export interface ProjectAgentInput  { projectDir: string; errorLogs?: string; projectContext?: string }
export interface ProjectAgentOutput { result: AgentResult | null; steps: number }

export async function runProjectAgent(input: ProjectAgentInput, log: Logger): Promise<ProjectAgentOutput> {
  const active = PROVIDERS.filter(p => p.apiKey.trim() !== '')
  if (active.length === 0) { log.error('No LLM providers configured'); return { result: null, steps: 0 } }

  for (const provider of active) {
    log.info(`Starting agent with provider: ${provider.name}`)
    const result = await runAgentLoop(provider, input.projectDir, input.errorLogs, input.projectContext, log)
    if (result) return { result, steps: 0 }
    log.warn(`${provider.name} agent failed, trying next provider...`)
  }

  log.error('All providers failed')
  return { result: null, steps: 0 }
}

async function runAgentLoop(
  provider:       LLMProvider,
  projectDir:     string,
  errorLogs:      string | undefined,
  projectContext: string | undefined,
  log:            Logger,
): Promise<AgentResult | null> {
  const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL })

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role:    'user',
      content: errorLogs
        ? `Fix the deployment. Previous Docker build failed with these errors:\n\n${errorLogs}\n\nRead the failing source files, fix them with patch_file, then write corrected deployment files.`
        : projectContext
          ? `Analyze the project and generate deployment files. Here is the full project context already collected:\n\n${projectContext}\n\nUse this context to understand the project. You may still use list_directory or read_file if you need more details, but prefer calling write_files as soon as you have enough information.`
          : 'Analyze the project and generate deployment files. Start by listing the root directory.',
    },
  ]

  log.raw('__AI_START__')

  for (let step = 0; step < MAX_ITERATIONS; step++) {
    log.info(`Agent step ${step + 1}/${MAX_ITERATIONS}`)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client.chat.completions.create as any)({
      model:       provider.model,
      messages,
      tools:       TOOLS,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens:  8192,
    })

    const message = response.choices[0].message
    messages.push(message)

    if (!message.tool_calls?.length) {
      log.warn('Agent returned text — prompting to use tools')
      messages.push({ role: 'user', content: 'Use a tool: list_directory, read_file, patch_file, or write_files.' })
      continue
    }

    for (const toolCall of message.tool_calls) {
      const name = toolCall.function.name
      let args: Record<string, unknown> = {}
      try { args = JSON.parse(toolCall.function.arguments) } catch { /* empty */ }

      if (name === 'write_files') {
        log.raw('__AI_DONE__')
        const parsed = AgentResultSchema.safeParse(args)
        if (!parsed.success) {
          const issues = parsed.error.issues.map(i => i.message).join(', ')
          log.warn(`write_files schema invalid: ${issues}`)
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `Schema invalid: ${issues}. Fix and retry.` })
          continue
        }
        log.info(`Agent complete — ${parsed.data.projectType}`)
        return parsed.data
      }

      // Execute read/list/patch tools
      if (name !== 'patch_file') {
        log.raw(`Analyzing file: ${args.file ?? args.dir ?? name}`)
      }
      const result = executeTool(projectDir, name, args, log)
      log.info(`Tool ${name} → ${result.length} chars`)

      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result })
    }
  }

  log.raw('__AI_DONE__')
  log.error(`Agent exceeded ${MAX_ITERATIONS} steps`)
  return null
}
