import { Router } from 'express'
import Project, { WORK_STATUSES } from '../models/Project.js'

const router = Router()

// Payment fields can never be changed through this route.
// They will only be changed by the verified PayPal flow in a later stage.
const PAYMENT_FIELDS = ['paymentStatus', 'paypalOrderId']

// While a payment is Pending or Completed the approved work status must not change.
const LOCKED_PAYMENT_STATUSES = ['Pending', 'Completed']

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// ---------------------------------------------------------------
// Same output format as the project routes:
//  - no MongoDB _id or __v
//  - revisions: null  ->  ''
//  - milestones, scopeChanges, deliverables and changes are ALWAYS arrays
// (This is a copy of the helper in projects.js, so that file stays untouched.)
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
// Checks the request body. The ONLY thing a client may send is { workStatus }.
// Returns a list of error messages (an empty list means "all good").
// ---------------------------------------------------------------
function validateUpdate(body) {
  if (!isObject(body)) return ['Request body must be a JSON object']

  const keys = Object.keys(body)

  // Payment fields get their own clear message
  const paymentKeys = keys.filter((key) => PAYMENT_FIELDS.includes(key))
  if (paymentKeys.length > 0) {
    return [
      `Payment fields cannot be updated here: ${paymentKeys.join(', ')}. ` +
        'Payment status is only changed by the PayPal payment flow.',
    ]
  }

  // Anything else besides workStatus is not allowed either
  const otherKeys = keys.filter((key) => key !== 'workStatus')
  if (otherKeys.length > 0) {
    return [`Only workStatus can be updated. Not allowed: ${otherKeys.join(', ')}`]
  }

  if (body.workStatus === undefined) return ['workStatus is required']

  if (!WORK_STATUSES.includes(body.workStatus)) {
    return [`workStatus must be one of: ${WORK_STATUSES.join(', ')}`]
  }

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

  console.error('Milestone route error:', err)
  return res.status(500).json({ success: false, message: 'Something went wrong on the server' })
}

// ---------------------------------------------------------------
// PATCH /api/projects/:projectId/milestones/:milestoneId
// Body: { "workStatus": "In Progress" }
// Returns the whole updated project.
// ---------------------------------------------------------------
router.patch('/:projectId/milestones/:milestoneId', async (req, res) => {
  try {
    // 1. Check the request body first
    const errors = validateUpdate(req.body)
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors })
    }

    // 2. Find the project by its string id, then the milestone by its string id
    const { projectId, milestoneId } = req.params
    const { workStatus } = req.body
    const project = await Project.findOne({ id: projectId }).lean()
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' })
    }

    const milestone = (project.milestones ?? []).find((m) => m.id === milestoneId)
    if (!milestone) {
      return res.status(404).json({ success: false, message: 'Milestone not found' })
    }

    // 3. Same status: nothing to save (and updatedAt stays untouched)
    if (milestone.workStatus === workStatus) {
      return res.json({ success: true, data: formatProject(project) })
    }

    // 4. Change the status in ONE atomic database step. The payment-lock check is part of the
    //    filter, so a checkout that starts at the same moment cannot slip past it.
    const saved = await Project.findOneAndUpdate(
      {
        id: projectId,
        milestones: {
          $elemMatch: {
            id: milestoneId,
            workStatus: { $ne: workStatus },
            paymentStatus: { $nin: LOCKED_PAYMENT_STATUSES },
          },
        },
      },
      { $set: { 'milestones.$.workStatus': workStatus, 'milestones.$.updatedAt': new Date().toISOString() } },
      { new: true },
    ).lean()

    if (saved) {
      return res.json({ success: true, data: formatProject(saved) })
    }

    // Nothing matched: find out why, so the message is accurate.
    const current = await Project.findOne({ id: projectId }).lean()
    const latest = current?.milestones?.find((m) => m.id === milestoneId)
    if (!latest) {
      return res.status(404).json({ success: false, message: 'Milestone not found' })
    }
    if (LOCKED_PAYMENT_STATUSES.includes(latest.paymentStatus)) {
      return res.status(409).json({
        success: false,
        message: 'Work status is locked while payment is pending or completed.',
      })
    }
    if (latest.workStatus === workStatus) {
      return res.json({ success: true, data: formatProject(current) })
    }
    return res.status(409).json({ success: false, message: 'This milestone was updated elsewhere. Refresh the page.' })
  } catch (err) {
    sendError(res, err)
  }
})

export default router
