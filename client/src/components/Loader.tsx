interface LoaderProps {
  text?: string
  fullScreen?: boolean
}

export default function Loader({ text = 'Loading...', fullScreen = false }: LoaderProps) {
  const spinner = (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-2 border-violet-500/20" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-violet-500 border-r-violet-400 animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
        </div>
      </div>
      {text && <p className="text-slate-400 text-sm tracking-wide">{text}</p>}
    </div>
  )

  if (fullScreen) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0a0a0f]/90 backdrop-blur-sm flex items-center justify-center">
        <div className="animate-fade-up flex flex-col items-center gap-6">
          <div className="relative w-16 h-16">
            {/* Outer glow ring */}
            <div className="absolute inset-0 rounded-full border-2 border-violet-500/10" />
            {/* Mid ring */}
            <div className="absolute inset-1 rounded-full border-2 border-violet-500/20" />
            {/* Spinning arc */}
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-violet-500 border-r-indigo-400 animate-spin" />
            {/* Center dot */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-2.5 h-2.5 rounded-full bg-violet-400 animate-pulse" />
            </div>
          </div>
          {text && (
            <div className="text-center">
              <p className="text-white text-sm font-medium tracking-wide">{text}</p>
              <p className="text-slate-600 text-xs mt-1">Please wait...</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return spinner
}
