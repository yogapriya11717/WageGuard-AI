import 'dotenv/config' // loads variables from .env into process.env
import express from 'express'
import cors from 'cors'
import { connectDB } from './config/db.js'
import healthRoutes from './routes/health.js'
import projectRoutes from './routes/projects.js'
import milestoneRoutes from './routes/milestones.js'
import scopeChangeRoutes from './routes/scopeChanges.js'
import aiRoutes from './routes/ai.js'
import paypalRoutes from './routes/paypal.js'

const app = express()
const PORT = process.env.PORT || 5000
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

// Middleware
app.use(cors({ origin: CLIENT_URL })) // only the Vite frontend may call this API
app.use(express.json())               // lets us read JSON request bodies

// Routes
app.use('/api/health', healthRoutes)
app.use('/api/projects', projectRoutes)
app.use('/api/projects', milestoneRoutes)
app.use('/api/projects', scopeChangeRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/paypal', paypalRoutes)

// Unknown URLs get a JSON 404 (instead of Express's default HTML page)
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` })
})

// Catches anything not handled above, e.g. a request body with broken JSON
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON in request body' })
  }
  console.error('Unhandled error:', err)
  res.status(500).json({ success: false, message: 'Something went wrong on the server' })
})

// Connect to the database FIRST, then start listening for requests.
async function startServer() {
  try {
    await connectDB()
  } catch (error) {
    console.error('--------------------------------------------')
    console.error('  Could not connect to MongoDB. Server NOT started.')
    console.error(`  ${error.message}`)
    console.error('--------------------------------------------')
    process.exit(1) // stop the program
  }

  app.listen(PORT, () => {
    console.log('--------------------------------------------')
    console.log('  WageGuard API is running')
    console.log(`  URL:     http://localhost:${PORT}`)
    console.log(`  Health:  http://localhost:${PORT}/api/health`)
    console.log(`  CORS:    ${CLIENT_URL}`)
    console.log('--------------------------------------------')
  })
}

startServer()
