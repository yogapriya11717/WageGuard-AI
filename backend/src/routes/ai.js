import { Router } from 'express'
import { analyzeRequestSchema, scopeCheckRequestSchema, formatZodError } from '../validators/aiSchemas.js'
import { analyzeConversationWithGemini, checkScopeWithGemini, GeminiError } from '../services/gemini.js'

const router = Router()

// ---------------------------------------------------------------
// Sends a consistent error response
//  - GeminiError  -> its own status (502 for an unusable AI answer, 500 if not configured)
//  - anything else -> 500
// ---------------------------------------------------------------
function sendError(res, err) {
  if (err instanceof GeminiError) {
    return res.status(err.status).json({ success: false, message: err.message })
  }
  console.error('AI route error:', err)
  return res.status(500).json({ success: false, message: 'Something went wrong on the server' })
}

// Sends the 400 response for a failed Zod check
function sendValidationError(res, error) {
  return res.status(400).json({ success: false, message: 'Validation failed', errors: formatZodError(error) })
}

// ---------------------------------------------------------------
// POST /api/ai/analyze
// Body: { "conversation": "..." }
// Returns { success, data } where data has the same shape as the frontend's
// analyzeConversation(): deliverables, total, currency, deadline, revisions,
// paymentTerms, milestones, missing. Nothing is saved to the database.
// ---------------------------------------------------------------
router.post('/analyze', async (req, res) => {
  try {
    const parsed = analyzeRequestSchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(res, parsed.error)

    const data = await analyzeConversationWithGemini(parsed.data.conversation)
    res.json({ success: true, data })
  } catch (err) {
    sendError(res, err)
  }
})

// ---------------------------------------------------------------
// POST /api/ai/scope-check
// Body: { "project": { deliverables, total, currency, revisions, deadline, paymentTerms },
//         "request": "..." }
// Returns { success, data } where data has the same shape as the frontend's
// scopeCheck(): changes, suggestedAmount, addDeliverable, withinScope, needsClarification.
// Nothing is saved: use the scope-change API to save a request.
// ---------------------------------------------------------------
router.post('/scope-check', async (req, res) => {
  try {
    const parsed = scopeCheckRequestSchema.safeParse(req.body)
    if (!parsed.success) return sendValidationError(res, parsed.error)

    const data = await checkScopeWithGemini(parsed.data.project, parsed.data.request)
    res.json({ success: true, data })
  } catch (err) {
    sendError(res, err)
  }
})

export default router
