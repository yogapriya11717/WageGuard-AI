import { Router } from 'express'

const router = Router()

// GET /api/health  ->  quick check that the server is alive
router.get('/', (req, res) => {
  res.json({ success: true, message: 'WageGuard API is running' })
})

export default router
