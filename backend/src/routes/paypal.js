import { randomBytes } from 'crypto'
import { Router } from 'express'
import Project from '../models/Project.js'
import {
  PayPalError,
  capturePayPalOrder,
  createPayPalOrder,
  getPayPalOrder,
} from '../services/paypal.js'

const router = Router()

const AMBIGUOUS_CODES = new Set(['PAYPAL_TIMEOUT', 'PAYPAL_NETWORK_ERROR', 'PAYPAL_BAD_RESPONSE', 'PAYPAL_UNCERTAIN'])
const DEFINITE_CREATE_FAILURES = new Set([
  'PAYPAL_ORDER_FAILED',
  'PAYPAL_AUTH_FAILED',
  'PAYPAL_NOT_CONFIGURED',
  'PAYPAL_INVALID_INPUT',
])
const DEFINITE_CAPTURE_FAILURES = new Set(['PAYPAL_CAPTURE_DECLINED', 'PAYPAL_ORDER_FAILED'])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value) => typeof value === 'string' && value.trim() !== ''
const toCents = (amount) => Math.round(Number(amount) * 100)
const requestKey = () => randomBytes(16).toString('hex')
const isRequestMarker = (value) => typeof value === 'string' && /^req:[a-f0-9]{32}$/.test(value)
const isRealOrderId = (value) => isText(value) && !value.startsWith('req:')

function clientOrigin() {
  return (process.env.CLIENT_URL || 'http://localhost:5173').trim().replace(/\/+$/, '')
}

// Same shape as the other project routes. Kept local so those files stay untouched.
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

function sendPayPalError(res, err) {
  if (err instanceof PayPalError) {
    return res.status(err.status || 502).json({ success: false, message: err.message })
  }
  console.error('PayPal route error:', err?.message || err)
  return res.status(500).json({ success: false, message: 'Something went wrong on the server' })
}

function readBody(body, allowed) {
  if (!isObject(body)) return { error: 'Request body must be a JSON object' }
  const extra = Object.keys(body).filter((key) => !allowed.includes(key))
  if (extra.length > 0) return { error: `Not allowed: ${extra.join(', ')}` }
  for (const key of allowed) {
    if (!isText(body[key])) return { error: `${key} is required` }
  }
  return { values: Object.fromEntries(allowed.map((key) => [key, body[key].trim()])) }
}

function checkoutUrls(projectId, milestoneId) {
  const origin = clientOrigin()
  const project = encodeURIComponent(projectId)
  const milestone = encodeURIComponent(milestoneId)
  const base = `${origin}/projects/${project}?milestone=${milestone}`
  return {
    returnUrl: `${base}&payment=return`,
    cancelUrl: `${base}&payment=cancel`,
  }
}

function orderProblems(order, project, milestone, orderId) {
  const problems = []
  if (order.id !== orderId) problems.push('order id')
  if (order.unitCount !== 1) problems.push('purchase units')
  if (order.customId !== `${project.id}:${milestone.id}`) problems.push('order reference')
  if (order.referenceId && order.referenceId !== milestone.id) problems.push('milestone reference')
  if (order.currencyCode !== 'USD' || project.currency !== 'USD') problems.push('currency')
  if (toCents(order.amountValue) !== toCents(milestone.amount)) problems.push('amount')
  return problems
}

function matchingCapture(captures, milestone) {
  return (captures || []).find(
    (capture) =>
      capture.status === 'COMPLETED' &&
      isText(capture.id) &&
      capture.currencyCode === 'USD' &&
      toCents(capture.value) === toCents(milestone.amount),
  )
}

async function loadMilestone(projectId, milestoneId) {
  const project = await Project.findOne({ id: projectId }).lean()
  if (!project) return { error: { status: 404, message: 'Project not found' } }
  const milestone = (project.milestones ?? []).find((item) => item.id === milestoneId)
  if (!milestone) return { error: { status: 404, message: 'Milestone not found' } }
  return { project, milestone }
}

function payableAmount(milestone) {
  return Number.isFinite(milestone.amount) && milestone.amount > 0 && toCents(milestone.amount) > 0
}

async function saveOrderId(projectId, milestoneId, marker, orderId) {
  const saved = await Project.findOneAndUpdate(
    {
      id: projectId,
      milestones: { $elemMatch: { id: milestoneId, paymentStatus: 'Pending', paypalOrderId: marker } },
    },
    { $set: { 'milestones.$.paypalOrderId': orderId } },
    { new: true },
  ).lean()
  if (saved) return saved

  const current = await Project.findOne({ id: projectId }).lean()
  const milestone = current?.milestones?.find((item) => item.id === milestoneId)
  if (milestone?.paypalOrderId === orderId) return current
  return null
}

async function markFailedAndClearMarker(projectId, milestoneId, marker) {
  await Project.updateOne(
    {
      id: projectId,
      milestones: { $elemMatch: { id: milestoneId, paymentStatus: 'Pending', paypalOrderId: marker } },
    },
    { $set: { 'milestones.$.paymentStatus': 'Failed', 'milestones.$.paypalOrderId': null } },
  )
}

async function markFailedKeepOrder(projectId, milestoneId, orderId) {
  await Project.updateOne(
    {
      id: projectId,
      milestones: { $elemMatch: { id: milestoneId, paymentStatus: 'Pending', paypalOrderId: orderId } },
    },
    { $set: { 'milestones.$.paymentStatus': 'Failed' } },
  )
}

async function markCompleted(projectId, milestoneId, orderId, captureId) {
  const paidAt = new Date()
  return Project.findOneAndUpdate(
    {
      id: projectId,
      milestones: {
        $elemMatch: {
          id: milestoneId,
          paypalOrderId: orderId,
          paymentStatus: { $in: ['Pending', 'Completed'] },
        },
      },
    },
    {
      $set: {
        'milestones.$.paymentStatus': 'Completed',
        'milestones.$.paypalCaptureId': captureId,
        'milestones.$.paidAt': paidAt,
        'milestones.$.updatedAt': paidAt.toISOString(),
      },
    },
    { new: true },
  ).lean()
}

function paymentResponse(res, project, extra = {}) {
  return res.json({ success: true, ...extra, data: formatProject(project) })
}

// Places the order for a marker we already stored. The same marker is reused
// after a timeout, so PayPal returns the original order instead of a second one.
async function placeOrder(res, projectId, milestoneId, marker) {
  const loaded = await loadMilestone(projectId, milestoneId)
  if (loaded.error) return res.status(loaded.error.status).json({ success: false, message: loaded.error.message })
  const { project, milestone } = loaded
  if (milestone.paymentStatus !== 'Pending' || milestone.paypalOrderId !== marker) {
    return resumeOrExplain(res, project, milestone)
  }

  const { returnUrl, cancelUrl } = checkoutUrls(projectId, milestoneId)
  try {
    const created = await createPayPalOrder({
      amount: milestone.amount,
      projectId,
      milestoneId,
      returnUrl,
      cancelUrl,
      requestId: marker.slice(4),
    })
    const saved = await saveOrderId(projectId, milestoneId, marker, created.orderId)
    if (!saved) {
      return res.status(409).json({
        success: false,
        message: 'Checkout was updated elsewhere. Refresh the page and resume checkout.',
      })
    }
    return paymentResponse(res, saved, { approvalUrl: created.approvalUrl, orderId: created.orderId })
  } catch (err) {
    // A timeout or a body we cannot read may still have created the order.
    // Leave the idempotency marker in place and keep the milestone Pending.
    if (err instanceof PayPalError && AMBIGUOUS_CODES.has(err.code)) {
      return sendPayPalError(res, err)
    }
    if (err instanceof PayPalError && DEFINITE_CREATE_FAILURES.has(err.code)) {
      await markFailedAndClearMarker(projectId, milestoneId, marker)
    }
    return sendPayPalError(res, err)
  }
}

async function syncCompletedOrder(res, project, milestone, order) {
  const capture = matchingCapture(order.captures, milestone)
  if (!capture) {
    return res.status(409).json({
      success: false,
      message: 'PayPal marked this order complete, but the capture amount could not be verified.',
    })
  }
  if (milestone.paymentStatus === 'Completed' && milestone.paypalCaptureId === capture.id) {
    return paymentResponse(res, project, { approvalUrl: null, orderId: order.id })
  }
  const saved = await markCompleted(project.id, milestone.id, order.id, capture.id)
  if (!saved) {
    return res.status(409).json({ success: false, message: 'This payment was updated elsewhere. Refresh the page.' })
  }
  return paymentResponse(res, saved, { approvalUrl: null, orderId: order.id })
}

async function resumeRealOrder(res, project, milestone) {
  let order
  try {
    order = await getPayPalOrder(milestone.paypalOrderId)
  } catch (err) {
    if (err instanceof PayPalError && err.code === 'PAYPAL_ORDER_NOT_FOUND') {
      await markFailedKeepOrder(project.id, milestone.id, milestone.paypalOrderId)
    }
    return sendPayPalError(res, err)
  }

  const problems = orderProblems(order, project, milestone, milestone.paypalOrderId)
  if (problems.length > 0) {
    return res.status(409).json({
      success: false,
      message: 'The PayPal order does not match this milestone. Payment was not completed.',
    })
  }

  if (order.status === 'COMPLETED') return syncCompletedOrder(res, project, milestone, order)

  if (order.status === 'VOIDED') {
    await markFailedKeepOrder(project.id, milestone.id, milestone.paypalOrderId)
    return res.status(409).json({
      success: false,
      message: 'This PayPal order is no longer payable. Try again to start a new checkout.',
    })
  }

  if (order.status === 'APPROVED') {
    return paymentResponse(res, project, { needsCapture: true, approvalUrl: null, orderId: order.id })
  }

  if (!order.approvalUrl) {
    return res.status(502).json({ success: false, message: 'PayPal did not return a checkout link. Please resume again.' })
  }
  return paymentResponse(res, project, { approvalUrl: order.approvalUrl, orderId: order.id })
}

async function resumeOrExplain(res, project, milestone) {
  if (milestone.paymentStatus === 'Completed') {
    return res.status(409).json({ success: false, message: 'This milestone is already paid.' })
  }
  if (milestone.paymentStatus === 'Pending' && isRealOrderId(milestone.paypalOrderId)) {
    return resumeRealOrder(res, project, milestone)
  }
  if (milestone.paymentStatus === 'Pending' && isRequestMarker(milestone.paypalOrderId)) {
    return placeOrder(res, project.id, milestone.id, milestone.paypalOrderId)
  }
  if (milestone.paymentStatus === 'Pending') {
    return res.status(409).json({
      success: false,
      message: 'Checkout is already being started. Use Resume checkout in a moment.',
    })
  }
  return res.status(409).json({ success: false, message: 'This milestone cannot be paid right now.' })
}

// ---------------------------------------------------------------
// POST /api/paypal/create-order
// Body: { projectId, milestoneId }
// Amount and currency always come from MongoDB.
// ---------------------------------------------------------------
router.post('/create-order', async (req, res) => {
  try {
    const parsed = readBody(req.body, ['projectId', 'milestoneId'])
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error })
    const { projectId, milestoneId } = parsed.values

    const loaded = await loadMilestone(projectId, milestoneId)
    if (loaded.error) return res.status(loaded.error.status).json({ success: false, message: loaded.error.message })
    const { project, milestone } = loaded

    if (project.currency !== 'USD') {
      return res.status(400).json({ success: false, message: 'PayPal checkout is available for USD projects only.' })
    }
    if (!payableAmount(milestone)) {
      return res.status(400).json({ success: false, message: 'This milestone has no amount to collect.' })
    }
    if (milestone.workStatus !== 'Approved') {
      return res.status(400).json({ success: false, message: 'Approve the work before requesting payment.' })
    }
    if (milestone.paymentStatus === 'Completed') {
      return res.status(409).json({ success: false, message: 'This milestone is already paid.' })
    }
    if (milestone.paymentStatus === 'Pending') {
      if (isRealOrderId(milestone.paypalOrderId)) return resumeRealOrder(res, project, milestone)
      if (isRequestMarker(milestone.paypalOrderId)) return placeOrder(res, projectId, milestoneId, milestone.paypalOrderId)
      return res.status(409).json({
        success: false,
        message: 'Checkout is already being started. Use Resume checkout in a moment.',
      })
    }
    if (milestone.paymentStatus !== 'Not Requested' && milestone.paymentStatus !== 'Failed') {
      return res.status(409).json({ success: false, message: 'This milestone cannot be paid right now.' })
    }

    const marker = `req:${requestKey()}`
    const claimed = await Project.findOneAndUpdate(
      {
        id: projectId,
        currency: 'USD',
        milestones: {
          $elemMatch: {
            id: milestoneId,
            workStatus: 'Approved',
            amount: { $gte: 0.01 },
            paymentStatus: { $in: ['Not Requested', 'Failed'] },
          },
        },
      },
      {
        $set: {
          'milestones.$.paymentStatus': 'Pending',
          'milestones.$.paypalOrderId': marker,
          'milestones.$.paypalCaptureId': null,
          'milestones.$.paidAt': null,
        },
      },
      { new: true },
    ).lean()

    if (!claimed) {
      const again = await loadMilestone(projectId, milestoneId)
      if (again.error) return res.status(again.error.status).json({ success: false, message: again.error.message })
      return resumeOrExplain(res, again.project, again.milestone)
    }

    return placeOrder(res, projectId, milestoneId, marker)
  } catch (err) {
    return sendPayPalError(res, err)
  }
})

async function failCapture(res, err, projectId, milestoneId, orderId) {
  if (err instanceof PayPalError && DEFINITE_CAPTURE_FAILURES.has(err.code)) {
    await markFailedKeepOrder(projectId, milestoneId, orderId)
  }
  return sendPayPalError(res, err)
}

// ---------------------------------------------------------------
// POST /api/paypal/capture-order
// Body: { projectId, milestoneId, orderId }
// Completed is saved only after PayPal's capture amount matches MongoDB.
// ---------------------------------------------------------------
router.post('/capture-order', async (req, res) => {
  try {
    const parsed = readBody(req.body, ['projectId', 'milestoneId', 'orderId'])
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error })
    const { projectId, milestoneId, orderId } = parsed.values

    const loaded = await loadMilestone(projectId, milestoneId)
    if (loaded.error) return res.status(loaded.error.status).json({ success: false, message: loaded.error.message })
    let { project, milestone } = loaded

    if (project.currency !== 'USD') {
      return res.status(400).json({ success: false, message: 'PayPal checkout is available for USD projects only.' })
    }
    if (
      milestone.paymentStatus === 'Completed' &&
      milestone.paypalCaptureId &&
      milestone.paypalOrderId === orderId
    ) {
      return paymentResponse(res, project, { orderId })
    }
    if (milestone.paymentStatus === 'Failed') {
      return res.status(409).json({ success: false, message: 'This payment failed. Try checkout again.' })
    }
    if (milestone.paymentStatus !== 'Pending') {
      return res.status(409).json({ success: false, message: 'This milestone is not waiting for a PayPal payment.' })
    }

    if (isRealOrderId(milestone.paypalOrderId) && milestone.paypalOrderId !== orderId) {
      return res.status(409).json({ success: false, message: 'This return does not match the open PayPal order.' })
    }

    // The return URL can arrive before we stored the order id (lost create response).
    // Adopt this order only after PayPal's own record matches the milestone.
    if (!isRealOrderId(milestone.paypalOrderId)) {
      let peeked
      try {
        peeked = await getPayPalOrder(orderId)
      } catch (err) {
        return sendPayPalError(res, err)
      }
      if (orderProblems(peeked, project, milestone, orderId).length > 0) {
        return res.status(409).json({
          success: false,
          message: 'The PayPal order does not match this milestone. Payment was not completed.',
        })
      }
      const adopted = await Project.findOneAndUpdate(
        {
          id: projectId,
          milestones: {
            $elemMatch: {
              id: milestoneId,
              paymentStatus: 'Pending',
              paypalOrderId: milestone.paypalOrderId ?? null,
            },
          },
        },
        { $set: { 'milestones.$.paypalOrderId': orderId } },
        { new: true },
      ).lean()
      if (!adopted) {
        const again = await loadMilestone(projectId, milestoneId)
        if (again.error) return res.status(again.error.status).json({ success: false, message: again.error.message })
        if (again.milestone.paypalOrderId !== orderId) {
          return res.status(409).json({ success: false, message: 'This payment was updated elsewhere. Refresh the page.' })
        }
        project = again.project
        milestone = again.milestone
      } else {
        project = adopted
        milestone = adopted.milestones.find((item) => item.id === milestoneId)
      }
      if (peeked.status === 'COMPLETED') return syncCompletedOrder(res, project, milestone, peeked)
    }

    let order
    try {
      order = await getPayPalOrder(orderId)
    } catch (err) {
      if (err instanceof PayPalError && err.code === 'PAYPAL_ORDER_NOT_FOUND') {
        await markFailedKeepOrder(projectId, milestoneId, orderId)
      }
      return sendPayPalError(res, err)
    }

    if (orderProblems(order, project, milestone, orderId).length > 0) {
      return res.status(409).json({
        success: false,
        message: 'The PayPal order does not match this milestone. Payment was not completed.',
      })
    }
    if (order.status === 'COMPLETED') return syncCompletedOrder(res, project, milestone, order)
    if (order.status === 'VOIDED') {
      await markFailedKeepOrder(projectId, milestoneId, orderId)
      return res.status(409).json({
        success: false,
        message: 'This PayPal order is no longer payable. Try again to start a new checkout.',
      })
    }

    // Capture only an order PayPal reports as APPROVED. Anything else (CREATED, SAVED,
    // PAYER_ACTION_REQUIRED...) means the buyer has not finished, so the milestone stays Pending.
    if (order.status !== 'APPROVED') {
      return res.status(409).json({
        success: false,
        message: 'PayPal has not recorded your approval yet. The payment stays Pending. Use Resume checkout to finish it.',
      })
    }

    // Same order always uses the same key, so a retry can never capture twice.
    let captured
    try {
      captured = await capturePayPalOrder(orderId, `wg-capture-${orderId}`)
    } catch (err) {
      if (err instanceof PayPalError && err.code === 'PAYPAL_ALREADY_CAPTURED') {
        try {
          const again = await getPayPalOrder(orderId)
          if (orderProblems(again, project, milestone, orderId).length > 0) {
            return res.status(409).json({
              success: false,
              message: 'The PayPal order does not match this milestone. Payment was not completed.',
            })
          }
          return syncCompletedOrder(res, project, milestone, again)
        } catch (loadErr) {
          return sendPayPalError(res, loadErr)
        }
      }
      return failCapture(res, err, projectId, milestoneId, orderId)
    }

    if (
      captured.captureStatus !== 'COMPLETED' ||
      captured.currencyCode !== 'USD' ||
      toCents(captured.amountValue) !== toCents(milestone.amount)
    ) {
      if (captured.captureStatus === 'DECLINED' || captured.captureStatus === 'FAILED') {
        await markFailedKeepOrder(projectId, milestoneId, orderId)
        return res.status(402).json({ success: false, message: 'The PayPal payment was declined.' })
      }
      return res.status(409).json({
        success: false,
        message: 'PayPal has not completed this payment yet. It was not marked as paid.',
      })
    }

    const saved = await markCompleted(projectId, milestoneId, orderId, captured.captureId)
    if (!saved) {
      const again = await loadMilestone(projectId, milestoneId)
      if (
        !again.error &&
        again.milestone.paymentStatus === 'Completed' &&
        again.milestone.paypalCaptureId === captured.captureId
      ) {
        return paymentResponse(res, again.project, { orderId })
      }
      return res.status(409).json({ success: false, message: 'This payment was updated elsewhere. Refresh the page.' })
    }
    return paymentResponse(res, saved, { orderId })
  } catch (err) {
    return sendPayPalError(res, err)
  }
})

export default router
