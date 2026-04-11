export type LogFn = (msg: string) => void

export function makeLogger(prefix: string, onLog?: LogFn) {
  return {
    info:  (msg: string) => { console.log(`[${prefix}] ${msg}`) },
    warn:  (msg: string) => { console.warn(`[${prefix}] ${msg}`) },
    error: (msg: string) => { console.error(`[${prefix}] ${msg}`) },
    raw:   (msg: string) => { onLog?.(msg) },
  }
}

export type Logger = ReturnType<typeof makeLogger>
