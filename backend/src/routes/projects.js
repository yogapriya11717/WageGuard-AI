import { Router } from 'express'
import Project, { CURRENCIES } from '../models/Project.js'

const router = Router()

// ---------------------------------------------------------------
// Small helper functions
// ---------------------------------------------------------------
const isText = (value) => typeof value === 'string' && value.trim().length > 0
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const toCents = (amount) => Math.round(amount * 100) // avoids 0.1 + 0.2 style rounding problems

// ---------------------------------------------------------------
// Turns a database project into exactly what the frontend expects:
//  - no MongoDB _id or __v
//  - revisions: null  ->  ''
//  - milestones, scopeChanges, deliverables and changes are ALWAYS arrays
// Pass in a plain object (from .lean() or .toObject()).
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
// Checks the request body for a new project.
// Returns a list of error messages (an empty list means "all good").
// Enum values and date formats are checked by the Mongoose model afterwards.
// ---------------------------------------------------------------
function validateNewProject(body) {
  if (!isObject(body)) return ['Request body must be a JSON object']

  const errors = []

  if (!isText(body.id)) errors.push('id is required and must be a non-empty string')
  if (!isText(body.title)) errors.push('title is required')
  if (!isText(body.client)) errors.push('client is required')
  if (!isText(body.conversation) || body.conversation.trim().length <= 10) {
    errors.push('conversation is required and must be longer than 10 characters')
  }
  if (!isNumber(body.total) || body.total <= 0) errors.push('total must be a number greater than 0')
  if (!CURRENCIES.includes(body.currency)) errors.push(`currency must be one of: ${CURRENCIES.join(', ')}`)

  // Deliverables: array of strings, at least one not empty
  if (
    !Array.isArray(body.deliverables) ||
    !body.deliverables.every((item) => typeof item === 'string') ||
    !body.deliverables.some(isText)
  ) {
    errors.push('deliverables must be an array of strings with at least one non-empty item')
  }

  // Optional text fields
  for (const field of ['deadline', 'paymentTerms']) {
    if (body[field] !== undefined && typeof body[field] !== 'string') errors.push(`${field} must be a string`)
  }

  // Revisions: missing, null, '' or a number (a numeric string like "3" is also accepted,
  // because the frontend form can send it that way)
  const r = body.revisions
  const revisionsOk =
    r === undefined ||
    r === null ||
    r === '' ||
    (isNumber(r) && r >= 0) ||
    (typeof r === 'string' && r.trim() !== '' && Number.isFinite(Number(r)) && Number(r) >= 0)
  if (!revisionsOk) errors.push('revisions must be a number, an empty string or null')

  // Milestones
  if (!Array.isArray(body.milestones) || body.milestones.length === 0) {
    errors.push('at least one milestone is required')
  } else {
    let milestonesOk = true

    body.milestones.forEach((m, i) => {
      const label = `milestones[${i}]`
      if (!isObject(m)) {
        errors.push(`${label} must be an object`)
        milestonesOk = false
        return
      }
      if (!isText(m.id)) errors.push(`${label}.id is required and must be a non-empty string`)
      if (!isText(m.title)) errors.push(`${label}.title is required`)
      if (!isNumber(m.amount) || m.amount < 0) {
        errors.push(`${label}.amount must be a number (0 or more)`)
        milestonesOk = false
      }
      for (const field of ['description', 'dueDate']) {
        if (m[field] !== undefined && typeof m[field] !== 'string') errors.push(`${label}.${field} must be a string`)
      }
    })

    if (milestonesOk) {
      // The milestone amounts must add up to the project total
      if (isNumber(body.total)) {
        const sum = body.milestones.reduce((running, m) => running + m.amount, 0)
        if (toCents(sum) !== toCents(body.total)) {
          errors.push(`milestone amounts add up to ${toCents(sum) / 100}, but total is ${body.total}`)
        }
      }

      // Milestone ids must be unique inside this project
      const ids = body.milestones.map((m) => m.id)
      if (new Set(ids).size !== ids.length) errors.push('milestone ids must be unique within a project')
    }
  }

  // Scope changes: optional, but must be an array if sent
  if (body.scopeChanges !== undefined) {
    if (!Array.isArray(body.scopeChanges) || !body.scopeChanges.every(isObject)) {
      errors.push('scopeChanges must be an array of objects')
    }
  }

  return errors
}

// ---------------------------------------------------------------
// Builds the object we save. We pick the fields ourselves, so a client can
// never set MongoDB's _id or any unknown field.
// Payment fields are always reset: payments are only changed by the verified
// backend PayPal flow (a later stage), never by the client.
// ---------------------------------------------------------------
function buildProjectData(body) {
  return {
    id: body.id,
    title: body.title,
    client: body.client,
    conversation: body.conversation,
    total: body.total,
    currency: body.currency,
    createdAt: body.createdAt ?? new Date().toISOString(),
    deliverables: body.deliverables,
    deadline: body.deadline ?? '',
    paymentTerms: body.paymentTerms ?? '',
    revisions: body.revisions ?? null,
    milestones: body.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description ?? '',
      amount: m.amount,
      dueDate: m.dueDate ?? '',
      workStatus: 'Not Started', // always starts here; only the milestone update API changes it later
      paymentStatus: 'Not Requested',
      paypalOrderId: null,
    })),
    scopeChanges: [], // always starts empty; only the scope-change API adds to it later
  }
}

// ---------------------------------------------------------------
// Sends a consistent error response
// ---------------------------------------------------------------
function sendError(res, err) {
  // Mongoose rejected a value (wrong enum, bad date format, etc.)
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: Object.values(err.errors).map((e) => e.message),
    })
  }

  // Duplicate key: a project with this id already exists
  if (err.code === 11000) {
    return res.status(409).json({ success: false, message: 'A project with this id already exists' })
  }

  console.error('Project route error:', err)
  return res.status(500).json({ success: false, message: 'Something went wrong on the server' })
}

// ---------------------------------------------------------------
// GET /api/projects  ->  all projects, newest first
// (createdAt is an ISO string, so sorting it as text sorts by date)
// ---------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const projects = await Project.find().sort({ createdAt: -1 }).lean()
    res.json({ success: true, data: projects.map(formatProject) })
  } catch (err) {
    sendError(res, err)
  }
})

// ---------------------------------------------------------------
// GET /api/projects/:id  ->  one project (found by our string id)
// ---------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const project = await Project.findOne({ id: req.params.id }).lean()
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' })
    }
    res.json({ success: true, data: formatProject(project) })
  } catch (err) {
    sendError(res, err)
  }
})

// ---------------------------------------------------------------
// POST /api/projects  ->  create a project
// ---------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const errors = validateNewProject(req.body)
    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors })
    }

    // Friendly duplicate check (the unique index is the safety net)
    if (await Project.exists({ id: req.body.id })) {
      return res.status(409).json({ success: false, message: 'A project with this id already exists' })
    }

    const project = await Project.create(buildProjectData(req.body))
    res.status(201).json({ success: true, data: formatProject(project.toObject()) })
  } catch (err) {
    sendError(res, err)
  }
})

// ---------------------------------------------------------------
// DELETE /api/projects/:id  ->  delete a project by its string id
// ---------------------------------------------------------------
router.delete('/:id', async (req, res) => {
  try {
    // Delete only if NO milestone is Pending or Completed. The check and the delete are one
    // atomic database step, so a checkout that starts at the same moment cannot be orphaned.
    const deleted = await Project.findOneAndDelete({
      id: req.params.id,
      milestones: { $not: { $elemMatch: { paymentStatus: { $in: ['Pending', 'Completed'] } } } },
    }).lean()

    if (deleted) {
      return res.json({ success: true, message: 'Project deleted successfully' })
    }

    // Not deleted: either it does not exist, or a payment guard blocked it.
    if (!(await Project.exists({ id: req.params.id }))) {
      return res.status(404).json({ success: false, message: 'Project not found' })
    }
    return res.status(409).json({
      success: false,
      message: 'This project cannot be deleted while a milestone payment is pending or completed.',
    })
  } catch (err) {
    sendError(res, err)
  }
})

export default router
