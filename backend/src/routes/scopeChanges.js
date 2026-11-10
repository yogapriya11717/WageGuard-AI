import { randomBytes } from 'crypto'
import { Router } from 'express'
import Project, { CHANGE_KINDS } from '../models/Project.js'

const router = Router()

// Scope changes that can still be decided
const OPEN_STATUSES = ['pending', 'clarification']

// Payment fields can never be changed through these routes.
// They will only be changed by the verified PayPal flow in a later stage.
const PAYMENT_FIELDS = ['paymentStatus', 'paypalOrderId']

const isText = (value) => typeof value === 'string' && value.trim().length > 0
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// ---------------------------------------------------------------
// Same output format as the other project routes:
//  - no MongoDB _id or __v
//  - revisions: null  ->  ''
//  - milestones, scopeChanges, deliverables and changes are ALWAYS arrays
// (A copy of the helper in projects.js, so that file stays untouched.)
// ---------------------------------------------------------------
function formatProject(project) {
  const result = { ...project }
  delete result._id
  delete result.__v

  result.revisions = result.revisions ?? ''
  result.deliverables = result.deliverables ?? []
  result.milestones = result.milestones ?? []
  result.scopeChanges = (result.scopeChanges ?? []).map((change) => ({
    ...change,
    changes: change.changes ?? [],
  }))

  return result
}

// ---------------------------------------------------------------
// Makes a new id like "s_3fa91c2b" and checks that no project already uses it.
// field is the database path to check: 'scopeChanges.id' or 'milestones.id'.
// ---------------------------------------------------------------
async function generateUniqueId(prefix, field) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = prefix + randomBytes(4).toString('hex')
    if (!(await Project.exists({ [field]: id }))) return id
  }
  throw new Error(`Could not generate a unique id for ${field}`)
}

// ---------------------------------------------------------------
// Rejects payment fields and unknown fields. Returns an error message or null.
// ---------------------------------------------------------------
function checkAllowedKeys(body, allowedKeys) {
  const keys = Object.keys(body)

  const paymentKeys = keys.filter((key) => PAYMENT_FIELDS.includes(key))
  if (paymentKeys.length > 0) {
    return (
      `Payment fields cannot be set here: ${paymentKeys.join(', ')}. ` +
      'Payment status is only changed by the PayPal payment flow.'
    )
  }

  const otherKeys = keys.filter((key) => !allowedKeys.includes(key))
  if (otherKeys.length > 0) {
    return `Not allowed: ${otherKeys.join(', ')}. Allowed fields: ${allowedKeys.join(', ')}`
  }

  return null
}

// ---------------------------------------------------------------
// Checks the body for creating a scope change.
// The server sets id, createdAt and decidedAt itself, so a client cannot send them.
// Returns { errors, data }. data holds the cleaned values when errors is empty.
// ---------------------------------------------------------------
function validateNewScopeChange(body) {
  if (!isObject(body)) return { errors: ['Request body must be a JSON object'] }

  const keyError = checkAllowedKeys(body, ['request', 'changes', 'suggestedAmount', 'addDeliverable', 'status'])
  if (keyError) return { errors: [keyError] }

  const errors = []

  if (!isText(body.request)) errors.push('request is required and must be a non-empty string')

  // changes: optional array of { kind, text }
  const changes = body.changes ?? []
  if (!Array.isArray(changes)) {
    errors.push('changes must be an array')
  } else {
    changes.forEach((item, i) => {
      const label = `changes[${i}]`
      if (!isObject(item)) return errors.push(`${label} must be an object`)
      if (!CHANGE_KINDS.includes(item.kind)) errors.push(`${label}.kind must be one of: ${CHANGE_KINDS.join(', ')}`)
      if (typeof item.text !== 'string') errors.push(`${label}.text must be a string`)
    })
  }

  // suggestedAmount: optional number, 0 or more
  const suggestedAmount = body.suggestedAmount ?? 0
  if (!isNumber(suggestedAmount) || suggestedAmount < 0) errors.push('suggestedAmount must be a number (0 or more)')

  // addDeliverable: optional string
  const addDeliverable = body.addDeliverable ?? ''
  if (typeof addDeliverable !== 'string') errors.push('addDeliverable must be a string')

  // status: a new request can only start as pending or clarification
  const status = body.status ?? 'pending'
  if (!OPEN_STATUSES.includes(status)) errors.push(`status must be one of: ${OPEN_STATUSES.join(', ')}`)

  if (errors.length > 0) return { errors }

  return {
    errors: [],
    data: {
      request: body.request,
      changes: changes.map((item) => ({ kind: item.kind, text: item.text })),
      suggestedAmount,
      addDeliverable,
      status,
    },
  }
}

// ---------------------------------------------------------------
// Checks the body for deciding a scope change: only { status: 'accepted' | 'declined' }
// ---------------------------------------------------------------
function validateDecision(body) {
  if (!isObject(body)) return ['Request body must be a JSON object']

  const keyError = checkAllowedKeys(body, ['status'])
  if (keyError) return [keyError]

  if (body.status === undefined) return ['status is required']
  if (!['accepted', 'declined'].includes(body.status)) return ['status must be either accepted or declined']

  return []
}

// ---------------------------------------------------------------
// Sends a consistent error response
// ---------------------------------------------------------------
function sendError(res, err) {
  // Mongoose rejected a value
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: Object.values(err.errors).map((e) => e.message),
    })
  }

  console.error('Scope change route error:', err)
  return res.status(500).json({ success: false, message: 'Something went wrong on the server' })
}

// ---------------------------------------------------------------
// POST /api/projects/:projectId/scope-changes
// Body: { request, changes, suggestedAmount, addDeliverable, status }
// The server generates id (s_...) and createdAt. Returns the whole updated project.
// ---------------------------------------------------------------
router.post('/:projectId/scope-changes', async (req, res) => {
  try {
    // 1. Check the request body first
    const { errors, data } = validateNewScopeChange(req.body)
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors })
    }

    // 2. Find the project by its string id
    const project = await Project.findOne({ id: req.params.projectId })
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' })
    }

    // 3. Add the new scope change (newest first, like the frontend does).
    //    No decidedAt: it is only set when the change is decided.
    const id = await generateUniqueId('s_', 'scopeChanges.id')
    project.scopeChanges.unshift({ id, ...data, createdAt: new Date().toISOString() })
    await project.save()

    res.status(201).json({ success: true, data: formatProject(project.toObject()) })
  } catch (err) {
    sendError(res, err)
  }
})

// ---------------------------------------------------------------
// PATCH /api/projects/:projectId/scope-changes/:scopeChangeId
// Body: { "status": "accepted" }  or  { "status": "declined" }
// Returns the whole updated project.
// ---------------------------------------------------------------
router.patch('/:projectId/scope-changes/:scopeChangeId', async (req, res) => {
  try {
    // 1. Check the request body first
    const errors = validateDecision(req.body)
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors })
    }
    const decision = req.body.status

    // 2. Find the project and the scope change by their string ids
    const { projectId, scopeChangeId } = req.params
    const project = await Project.findOne({ id: projectId }).lean()
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' })
    }

    const scopeChange = (project.scopeChanges ?? []).find((s) => s.id === scopeChangeId)
    if (!scopeChange) {
      return res.status(404).json({ success: false, message: 'Scope change not found' })
    }

    // 3. A scope change can only be decided once
    if (!OPEN_STATUSES.includes(scopeChange.status)) {
      return res.status(409).json({
        success: false,
        message: `This scope change was already ${scopeChange.status}`,
      })
    }

    // 4. Build the database update. The scope change is marked decided,
    //    and (only when accepted) the agreement grows.
    const update = {
      $set: {
        'scopeChanges.$.status': decision,
        'scopeChanges.$.decidedAt': new Date().toISOString(),
      },
    }

    if (decision === 'accepted') {
      const amount = Number(scopeChange.suggestedAmount) || 0
      const extra = scopeChange.addDeliverable ?? ''
      const hasDeliverable = extra.trim() !== ''

      if (amount > 0) update.$inc = { total: amount }
      if (hasDeliverable) update.$push = { deliverables: extra }

      if (amount > 0) {
        const milestone = {
          id: await generateUniqueId('m_', 'milestones.id'),
          title: `Add-on: ${hasDeliverable ? extra : 'extra work'}`,
          description: 'Added after a confirmed scope change',
          amount,
          dueDate: '',
          workStatus: 'Not Started',
          paymentStatus: 'Not Requested',
          paypalOrderId: null,
        }
        update.$push = { ...update.$push, milestones: milestone }
      }
    }

    // 5. Apply everything in ONE database operation.
    //    The filter only matches while the scope change is still open, so if two
    //    requests arrive at the same time, only one of them can succeed.
    const updated = await Project.findOneAndUpdate(
      {
        id: projectId,
        scopeChanges: { $elemMatch: { id: scopeChangeId, status: { $in: OPEN_STATUSES } } },
      },
      update,
      { new: true },
    ).lean()

    if (!updated) {
      // Nothing matched: someone else decided it just now, or the project was deleted
      if (!(await Project.exists({ id: projectId }))) {
        return res.status(404).json({ success: false, message: 'Project not found' })
      }
      return res.status(409).json({ success: false, message: 'This scope change was already decided' })
    }

    res.json({ success: true, data: formatProject(updated) })
  } catch (err) {
    sendError(res, err)
  }
})

export default router
