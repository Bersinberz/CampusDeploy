import { useState, useEffect, useRef } from 'react'
import type { ChangeEvent } from 'react'
import axios from 'axios'
import { submitDeployment, streamCloneLogs } from '../services/deployService'
import Loader from '../components/Loader'
import MessageBox from '../components/MessageBox'

interface DeployForm { name: string; email: string; repoUrl: string }
interface FormErrors { name?: string; email?: string; repoUrl?: string }
type Stage = 'form' | 'cloning' | 'done'

function validateForm(form: DeployForm): FormErrors {
  const errors: FormErrors = {}

  if (!form.name.trim())
    errors.name = 'Name is required'
  else if (form.name.trim().length < 2)
    errors.name = 'Name must be at least 2 characters'

  if (!form.email.trim())
    errors.email = 'Email is required'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
    errors.email = 'Must be a valid email address'

  if (!form.repoUrl.trim())
    errors.repoUrl = 'Repository URL is required'
  else if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/.test(form.repoUrl))
    errors.repoUrl = 'Must be a valid GitHub URL (e.g. https://github.com/user/repo)'

  return errors
}

export default function DeployPage() {
  const [form, setForm] = useState<DeployForm>({ name: 'bersin', email: 'bersinmail@gmail.com', repoUrl: 'https://github.com/Bersinberz/Orama.git' })
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({})
  const [stage, setStage] = useState<Stage>('form')
  const [logs, setLogs] = useState<string[]>([])
  const [aiAnalyzing, setAiAnalyzing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    setFieldErrors(prev => ({ ...prev, [name]: undefined }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errors = validateForm(form)
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await submitDeployment(form)
      const id = res.data.deployment._id
      setStage('cloning')
      setLogs([])
      streamCloneLogs(
        id,
        (msg) => {
          if (msg === '__AI_START__') {
            setAiAnalyzing(true)
          } else if (msg === '__AI_DONE__') {
            setAiAnalyzing(false)
          } else if (msg.startsWith('__TOKEN__:')) {
            // ignore legacy token events
          } else {
            setLogs(prev => [...prev, msg])
          }
        },
        () => { setAiAnalyzing(false); setStage('done') }
      )
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.error ?? 'Request failed'
        : 'Request failed'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

// ── Log terminal view ──────────────────────────────────────────────
  if (stage === 'cloning' || stage === 'done') {
    const isDone  = stage === 'done'
    const isError = logs.some(l => l.startsWith('ERROR'))

    const productionReady = logs.some(l => l.includes('Production code is ready'))
    const deployStarted   = logs.some(l => l.includes('Deployment started'))

    const phaseLabel = deployStarted
      ? 'deploying'
      : productionReady
        ? 'production ready'
        : 'analyzing'

    // Map raw log lines to user-friendly messages
    const friendlyMessage = (line: string): string => {
      if (line.startsWith('Initializing workspace'))       return 'Setting up workspace...'
      if (line.startsWith('Cloning repository:'))          return `Cloning ${line.replace('Cloning repository:', '').trim()}`
      if (line.includes('Repository cloned'))              return 'Repository cloned successfully'
      if (line.includes('Analyzing Your Project'))         return 'Scanning project structure...'
      if (line.startsWith('Analyzing file:'))              return `   ${line.replace('Analyzing file:', '').trim()}`
      if (line.includes('Agent step'))                     return line
      if (line.includes('Agent complete'))                 return line
      if (line.includes('Production code is ready'))       return 'Production files generated'
      if (line.includes('Deployment started'))             return 'Starting deployment...'
      if (line.includes('Starting local Docker'))          return 'Starting Docker deployment...'
      if (line.includes('Stopping any existing'))          return 'Stopping existing containers...'
      if (line.includes('Building Docker image'))          return 'Building Docker image...'
      if (line.includes('Starting containers'))            return 'Starting containers...'
      if (line.includes('Fetching container logs'))        return 'Fetching container logs...'
      if (line.includes('Deployment successful'))          return 'Deployment successful!'
      if (line.includes('Retrying deployment'))            return line
      if (line.includes('AI is diagnosing'))               return 'AI is diagnosing the failure...'
      if (line.includes('Deployment files updated'))       return 'Deployment files updated, retrying...'
      if (line.startsWith('ERROR'))                        return line.replace('ERROR:', '').trim()
      if (line.startsWith('  ') || line.startsWith('   ')) return line
      return line
    }

    const getLiveUrl = (line: string): string | null => {
      if (!line.includes('Live URL:')) return null
      const url = line.replace('Live URL:', '').trim()
      // Strip default port 80
      return url.replace(/:80$/, '')
    }

    const getLineStyle = (line: string) => {
      if (line.startsWith('ERROR'))                         return 'text-red-400'
      if (line.includes('✓ Production code is ready') || line.includes('Production code is ready')) return 'text-emerald-400 font-semibold'
      if (line.includes('Deployment started') || line.includes('Deployment successful')) return 'text-violet-300 font-semibold'
      if (line.startsWith('Analyzing file:'))              return 'text-sky-400/70 text-xs'
      if (line.includes('✓') || line.includes('✅'))       return 'text-emerald-400'
      if (line.includes('Live URL:'))                      return 'text-emerald-300 font-semibold'
      if (line.startsWith('  ') || line.startsWith('   ')) return 'text-slate-500 text-xs'
      return 'text-slate-300'
    }

    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
        <div className="animate-fade-up w-full max-w-4xl">

          {/* Terminal header bar */}
          <div className="flex items-center gap-2 bg-[#1a1a24] border border-white/[0.08] rounded-t-2xl px-4 py-3">
            <span className="w-3 h-3 rounded-full bg-red-500/70" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/70" />
            <span className="ml-3 text-slate-500 text-xs font-mono">campusdeploy — deploy</span>
            {!isDone && (
              <span className="ml-auto flex items-center gap-1.5 text-violet-400 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                {phaseLabel}
              </span>
            )}
            {isDone && !isError && <span className="ml-auto text-emerald-400 text-xs">✓ completed</span>}
            {isDone && isError  && <span className="ml-auto text-red-400 text-xs">✗ failed</span>}
          </div>

          {/* Log body */}
          <div className="bg-[#0d0d14] border-x border-b border-white/[0.08] rounded-b-2xl p-5 h-120 overflow-y-auto font-mono text-sm space-y-1">
            {logs.map((line, i) => {
              const liveUrl = getLiveUrl(line)
              if (liveUrl) {
                return (
                  <div key={i} className="leading-relaxed text-emerald-300 font-semibold">
                    <span className="text-slate-600 select-none mr-2">$</span>
                    Live URL:{' '}
                    <a
                      href={liveUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 hover:text-emerald-200 transition-colors cursor-pointer"
                    >
                      {liveUrl}
                    </a>
                  </div>
                )
              }
              return (
                <div key={i} className={`leading-relaxed ${getLineStyle(line)}`}>
                  <span className="text-slate-600 select-none mr-2">$</span>
                  {friendlyMessage(line)}
                </div>
              )
            })}
            {aiAnalyzing && (
              <div className="flex items-center gap-1.5 text-violet-300 leading-relaxed">
                <span className="text-slate-600 select-none mr-2">$</span>
                <span>Analyzing your project</span>
                <span className="flex gap-0.5 ml-0.5">
                  <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1 h-1 rounded-full bg-violet-400 animate-bounce [animation-delay:300ms]" />
                </span>
              </div>
            )}
            {!isDone && !aiAnalyzing && (
              <div className="flex items-center gap-1 text-slate-500">
                <span className="text-slate-600 select-none mr-2">$</span>
                <span className="inline-block w-2 h-4 bg-violet-400 animate-pulse rounded-sm" />
              </div>
            )}
            <div ref={logEndRef} />
          </div>

          {/* Result banner */}
          {isDone && (
            <div className="mt-4">
              <MessageBox
                type={isError ? 'error' : 'success'}
                title={isError ? 'Deployment failed' : 'Deployment live!'}
                message={isError ? 'Something went wrong. Check the logs above.' : 'Your project is live on the server.'}
              />
            </div>
          )}

          {isDone && (
            <button
              onClick={() => { setStage('form'); setLogs([]) }}
              className="mt-4 w-full py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-400 text-sm hover:bg-white/[0.07] transition-colors cursor-pointer"
            >
              Deploy another project
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Form view ──────────────────────────────────────────────────────
  return (
    <div className="h-screen bg-[#0a0a0f] flex items-center justify-center p-4 overflow-hidden">
      {loading && <Loader fullScreen text="Queuing your deployment" />}

      <div className="pointer-events-none fixed inset-0">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-violet-700/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-80 h-80 bg-indigo-700/15 rounded-full blur-[100px]" />
      </div>

      <div className="animate-fade-up relative w-full max-w-lg z-10">

        <div className="text-center mb-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-semibold tracking-widest uppercase mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            CampusDeploy
          </div>
          <h1 className="text-3xl font-extrabold text-white leading-tight mb-2">
            Deploy your project<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-indigo-400">in seconds</span>
          </h1>
          <p className="text-slate-400 text-xs max-w-sm mx-auto">
            Paste your GitHub repo, we'll clone it, detect the stack, build it with Docker, and hand you a live URL.
          </p>
        </div>

        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-6 shadow-2xl">
          <form onSubmit={handleSubmit} noValidate className="space-y-4">

            <div className="animate-slide-in delay-100">
              <label htmlFor="name" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Your name</label>
              <input id="name" name="name" type="text" value={form.name} onChange={handleChange} required
                className={`w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border text-white placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 hover:border-white/15 transition-all duration-200 ${fieldErrors.name ? 'border-red-500/50' : 'border-white/[0.08]'}`} />
              {fieldErrors.name && <p className="text-red-400 text-xs mt-1">{fieldErrors.name}</p>}
            </div>

            <div className="animate-slide-in delay-200">
              <label htmlFor="email" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">College email</label>
              <input id="email" name="email" type="email" value={form.email} onChange={handleChange} required
                className={`w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border text-white placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 hover:border-white/15 transition-all duration-200 ${fieldErrors.email ? 'border-red-500/50' : 'border-white/[0.08]'}`} />
              {fieldErrors.email && <p className="text-red-400 text-xs mt-1">{fieldErrors.email}</p>}
            </div>

            <div className="animate-slide-in delay-300">
              <label htmlFor="repoUrl" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">GitHub repository URL</label>
              <input id="repoUrl" name="repoUrl" type="url" value={form.repoUrl} onChange={handleChange} required placeholder="https://github.com/user/repo"
                className={`w-full px-4 py-2.5 rounded-xl bg-white/[0.04] border text-white placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 hover:border-white/15 transition-all duration-200 ${fieldErrors.repoUrl ? 'border-red-500/50' : 'border-white/[0.08]'}`} />
              {fieldErrors.repoUrl && <p className="text-red-400 text-xs mt-1">{fieldErrors.repoUrl}</p>}
            </div>

            <div className="animate-slide-in delay-[400ms]">
              {error && (
                <div className="mb-3">
                  <MessageBox type="error" title="Error" message={error} onClose={() => setError(null)} />
                </div>
              )}
              <button type="submit"
                className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-sm tracking-wide shadow-lg shadow-violet-900/40 hover:shadow-violet-700/50 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0">
                Deploy my project
              </button>
            </div>

          </form>

          <p className="text-center text-slate-700 text-xs mt-4 italic">
            No config files. No DevOps degree. Just push and ship.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-center animate-fade-up delay-500">
          {[{ label: '📦 Clone repo' }, { label: '🔨 Build & run' }, { label: '🌐 Get live URL' }].map(({ label }) => (
            <div key={label} className="bg-white/[0.02] border border-white/[0.06] rounded-xl py-2 px-2">
              <div className="text-slate-500 text-xs">{label}</div>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
