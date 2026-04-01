interface MessageBoxProps {
  type: 'success' | 'error' | 'info'
  title: string
  message: string
  onClose?: () => void
}

const config = {
  success: {
    icon: '✓',
    iconClass: 'bg-emerald-500/10 border-emerald-400/30 text-emerald-400',
    borderClass: 'border-emerald-500/20',
    titleClass: 'text-emerald-400',
    bg: 'bg-emerald-500/[0.04]',
  },
  error: {
    icon: '✕',
    iconClass: 'bg-red-500/10 border-red-400/30 text-red-400',
    borderClass: 'border-red-500/20',
    titleClass: 'text-red-400',
    bg: 'bg-red-500/[0.04]',
  },
  info: {
    icon: 'i',
    iconClass: 'bg-violet-500/10 border-violet-400/30 text-violet-400',
    borderClass: 'border-violet-500/20',
    titleClass: 'text-violet-400',
    bg: 'bg-violet-500/[0.04]',
  },
}

export default function MessageBox({ type, title, message, onClose }: MessageBoxProps) {
  const c = config[type]

  return (
    <div className={`animate-fade-up w-full rounded-2xl border ${c.borderClass} ${c.bg} backdrop-blur-sm p-5`}>
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className={`shrink-0 w-9 h-9 rounded-full border flex items-center justify-center font-bold text-sm ${c.iconClass}`}>
          {c.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={`font-semibold text-sm mb-1 ${c.titleClass}`}>{title}</p>
          <p className="text-slate-400 text-sm leading-relaxed">{message}</p>
        </div>

        {/* Close */}
        {onClose && (
          <button
            onClick={onClose}
            className="shrink-0 text-slate-600 hover:text-slate-400 transition-colors text-lg leading-none cursor-pointer"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}
