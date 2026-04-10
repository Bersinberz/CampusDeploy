import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import connectDB from './config/db.js'
import deployRouter from './routes/deploy.js'

const app = express()
const PORT = process.env.PORT ?? 4000
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'

// Middleware
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Request logger
app.use((req, _res, next) => {
  console.log(`[Request] ${req.method} ${req.url}`)
  next()
})

// Routes
app.use('/api/deploy', deployRouter)

// Health check
app.get('/health', (_req, res) => {
  console.log('[Health] Health check requested')
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() })
})

// 404 handler
app.use((req, res) => {
  console.warn(`[404] Route not found: ${req.method} ${req.url}`)
  res.status(404).json({ error: 'Route not found' })
})

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`[Error] ${err.message}`)
  res.status(500).json({ error: err.message ?? 'Internal server error' })
})

// DB + server boot
console.log('[Boot] Connecting to MongoDB...')
connectDB()
  .then(() => {
    console.log('[Boot] MongoDB connected successfully')
    const server = app.listen(PORT, () => console.log(`[Boot] Server running → http://localhost:${PORT}`))

    // Disable timeout globally — SSE + SSH + docker builds can run for many minutes
    server.timeout = 0
    server.keepAliveTimeout = 0
  })
  .catch(err => {
    console.error('[Boot] MongoDB connection failed:', err.message)
    process.exit(1)
  })
