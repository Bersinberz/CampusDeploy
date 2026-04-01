import { useState, useEffect, useRef } from 'react'
import type { ChangeEvent } from 'react'
import axios from 'axios'
import { submitDeployment, streamCloneLogs } from '../services/deployService'
import Loader from '../components/Loader'
import MessageBox from '../components/MessageBox'

interface DeployForm { name: string; email: string; repoUrl: string }
type Stage = 'form' | 'cloning' | 'done'

export default function DeployPage() {
  const [form, setForm]       = useState<DeployForm>({ name: '', email: '', repoUrl: '' })
  const [stage, setStage]     = useState<Stage>('form')
  const [logs, setLogs]       = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const logEndRef             = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await submitDeployment(form)
      const id = res.data.deployment._id
      setStage('cloning')
      setLogs([])
      streamCloneLogs(
        id,
        (msg) => setLogs(prev => [...prev, msg]),
        ()    => setStage('done')
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

    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4">
        <div className="animate-fade-up w-full max-w-2xl">

          {/* Terminal header bar */}
          <div className="flex items-center gap-2 bg-[#1a1a24] border border-white/[0.08] rounded-t-2xl px-4 py-3">
            <span className="w-3 h-3 rounded-full bg-red-500/70" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/70" />
            <span className="ml-3 text-slate-500 text-xs font-mono">campusdeploy — clone</span>
            {!isDone && (
              <span className="ml-auto flex items-center gap-1.5 text-violet-400 text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                running
              </span>
            )}
            {isDone && !isError && <span className="ml-auto text-emerald-400 text-xs">✓ completed</span>}
            {isDone && isError  && <span className="ml-auto text-red-400 text-xs">✗ failed</span>}
          </div>

          {/* Log body */}
          <div className="bg-[#0d0d14] border-x border-b border-white/[0.08] rounded-b-2xl p-5 h-80 overflow-y-auto font-mono text-sm space-y-1">
            {logs.map((line, i) => (
              <div key={i} className={`leading-relaxed ${
                line.startsWith('ERROR') ? 'text-red-400'
                : line.includes('✓')    ? 'text-emerald-400'
                : 'text-slate-300'
              }`}>
                <span className="text-slate-600 select-none mr-2">$</span>{line}
              </div>
            ))}
            {!isDone && (
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
                title={isError ? 'Clone failed' : 'Project cloned!'}
                message={isError ? 'Something went wrong. Check the logs above.' : 'Your code is ready on the server.'}
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
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4 overflow-hidden">
      {loading && <Loader fullScreen text="Queuing your deployment" />}

      <div className="pointer-events-none fixed inset-0">
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-violet-700/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-80 h-80 bg-indigo-700/15 rounded-full blur-[100px]" />
      </div>

      <div className="animate-fade-up relative w-full max-w-lg z-10">

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-semibold tracking-widest uppercase mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            CampusDeploy
          </div>
          <h1 className="text-4xl font-extrabold text-white leading-tight mb-3">
            Deploy your project<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-indigo-400">in seconds</span>
          </h1>
          <p className="text-slate-400 text-sm max-w-sm mx-auto">
            Paste your GitHub repo, we'll clone it, detect the stack, build it with Docker, and hand you a live URL.
          </p>
        </div>

        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">

            <div className="animate-slide-in delay-100">
              <label htmlFor="name" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Your name</label>
              <input id="name" name="name" type="text" value={form.name} onChange={handleChange} required
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 hover:border-white/15 transition-all duration-200" />
            </div>

            <div className="animate-slide-in delay-200">
              <label htmlFor="email" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">College email</label>
              <input id="email" name="email" type="email" value={form.email} onChange={handleChange} required
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 hover:border-white/15 transition-all duration-200" />
            </div>

            <div className="animate-slide-in delay-300">
              <label htmlFor="repoUrl" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">GitHub repository URL</label>
              <input id="repoUrl" name="repoUrl" type="url" value={form.repoUrl} onChange={handleChange} required
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-slate-600 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 hover:border-white/15 transition-all duration-200" />
            </div>

            <div className="animate-slide-in delay-[400ms] pt-1">
              {error && (
                <div className="mb-3">
                  <MessageBox type="error" title="Error" message={error} onClose={() => setError(null)} />
                </div>
              )}
              <button type="submit" disabled={loading}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-sm tracking-wide shadow-lg shadow-violet-900/40 hover:shadow-violet-700/50 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0">
                {loading ? 'Deploying...' : 'Deploy my project'}
              </button>
            </div>

          </form>

          <p className="text-center text-slate-700 text-xs mt-6 italic">
            No config files. No DevOps degree. Just push and ship.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3 text-center animate-fade-up delay-500">
          {[{ icon: '📦', label: 'Clone repo' }, { icon: '🐳', label: 'Build & run' }, { icon: '🌐', label: 'Get live URL' }].map(({ icon, label }) => (
            <div key={label} className="bg-white/[0.02] border border-white/[0.06] rounded-xl py-3 px-2">
              <div className="text-xl mb-1">{icon}</div>
              <div className="text-slate-500 text-xs">{label}</div>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
