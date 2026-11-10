// WageGuard - the only place that talks to the backend API.
// Pages do not use this file yet (that happens in the next steps).
//
// In development the browser calls "/api/..." on the Vite server, and Vite forwards it
// to the backend (see vite.config.js). For a deployed site, set VITE_API_URL to the
// backend address (for example https://wageguard-api.onrender.com).

const BASE_URL = (import.meta.env?.VITE_API_URL || '').replace(/\/+$/, '')

const DEFAULT_TIMEOUT_MS = 20000 // normal requests
const AI_TIMEOUT_MS = 100000 // Gemini calls can take longer (the backend allows 45 s per try, with one retry)

// An error with a message that is safe to show to the user.
export class ApiError extends Error {
  constructor(message, status = 0, details = []) {
    super(message)
    this.name = 'ApiError'
    this.status = status // HTTP status, or 0 if the server could not be reached
    this.details = details // list of validation messages from the backend, if any
  }
}

// Sends one request and returns the backend's JSON ({ success: true, ... }).
// Throws ApiError for network problems, timeouts and every { success: false } answer.
async function request(path, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response
  let payload = null
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    try {
      payload = await response.json()
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      payload = null // the answer was not JSON
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new ApiError('The server took too long to answer. Please try again.')
    }
    throw new ApiError('Could not reach the WageGuard server. Check that the backend is running.')
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok || !payload || payload.success !== true) {
    if (!payload && response.status >= 500) {
      throw new ApiError('The WageGuard server is not responding. Check that the backend is running.', response.status)
    }
    const details = Array.isArray(payload?.errors) ? payload.errors : []
    const base = payload?.message || `Request failed (HTTP ${response.status})`
    throw new ApiError(details.length ? `${base}: ${details.join('; ')}` : base, response.status, details)
  }
  return payload
}

const enc = encodeURIComponent

// ---------------------------------------------------------------
// Health
// ---------------------------------------------------------------
export const checkHealth = () => request('/api/health')

// ---------------------------------------------------------------
// Projects. Every function below returns the project(s) exactly as the backend sends them.
// ---------------------------------------------------------------
export const getProjects = async () => (await request('/api/projects')).data

export const getProject = async (projectId) => (await request(`/api/projects/${enc(projectId)}`)).data

// The backend needs the project id and every milestone id to be sent (p_... and m_...).
export const createProject = async (project) => (await request('/api/projects', { method: 'POST', body: project })).data

// ---------------------------------------------------------------
// Milestones. Only workStatus can be changed here. Payment fields are never sent.
// Returns the whole updated project.
// ---------------------------------------------------------------
// PayPal calls can wait on the Sandbox. The backend allows 15 s per PayPal call and a capture
// can make up to three (token, order lookup, capture), so this stays above 45 s. A shorter
// timeout would give up while the backend is still working.
const PAYPAL_TIMEOUT_MS = 50000

// Returns the whole response: approvalUrl, orderId, needsCapture and data (the project).
export const createPayPalCheckout = async (projectId, milestoneId) =>
  request('/api/paypal/create-order', {
    method: 'POST',
    body: { projectId, milestoneId },
    timeoutMs: PAYPAL_TIMEOUT_MS,
  })

// Returns the whole response. data is the project after a verified capture.
export const capturePayPalCheckout = async (projectId, milestoneId, orderId) =>
  request('/api/paypal/capture-order', {
    method: 'POST',
    body: { projectId, milestoneId, orderId },
    timeoutMs: PAYPAL_TIMEOUT_MS,
  })

export const updateWorkStatus = async (projectId, milestoneId, workStatus) =>
  (
    await request(`/api/projects/${enc(projectId)}/milestones/${enc(milestoneId)}`, {
      method: 'PATCH',
      body: { workStatus },
    })
  ).data

// ---------------------------------------------------------------
// Scope changes. Both return the whole updated project.
// ---------------------------------------------------------------

// Only the fields the backend accepts are sent. id and createdAt are made by the backend,
// so they are dropped here even if the page passes them in.
export const createScopeChange = async (projectId, change) =>
  (
    await request(`/api/projects/${enc(projectId)}/scope-changes`, {
      method: 'POST',
      body: {
        request: change.request,
        changes: (change.changes ?? []).map((c) => ({ kind: c.kind, text: c.text })),
        suggestedAmount: change.suggestedAmount ?? 0,
        addDeliverable: change.addDeliverable ?? '',
        status: change.status ?? 'pending',
      },
    })
  ).data

// decision must be 'accepted' or 'declined'
export const decideScopeChange = async (projectId, scopeChangeId, decision) =>
  (
    await request(`/api/projects/${enc(projectId)}/scope-changes/${enc(scopeChangeId)}`, {
      method: 'PATCH',
      body: { status: decision },
    })
  ).data

// ---------------------------------------------------------------
// AI (Gemini). Nothing is saved by these two calls.
// ---------------------------------------------------------------

// Returns { deliverables, total, currency, deadline, revisions, paymentTerms, milestones, missing }
export const aiAnalyze = async (conversation) =>
  (await request('/api/ai/analyze', { method: 'POST', body: { conversation }, timeoutMs: AI_TIMEOUT_MS })).data

// The backend wants revisions as a number or '' (a numeric string like "3" would be rejected).
function cleanRevisions(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return ''
}

// Returns { changes, suggestedAmount, addDeliverable, withinScope, needsClarification }
// Only the six agreement fields are sent. Nothing else from the project leaves the browser.
export const aiScopeCheck = async (project, requestText) =>
  (
    await request('/api/ai/scope-check', {
      method: 'POST',
      timeoutMs: AI_TIMEOUT_MS,
      body: {
        project: {
          deliverables: (project.deliverables ?? []).filter((d) => typeof d === 'string' && d.trim() !== ''),
          total: Number(project.total),
          currency: project.currency,
          revisions: cleanRevisions(project.revisions),
          deadline: project.deadline || '',
          paymentTerms: project.paymentTerms || '',
        },
        request: requestText,
      },
    })
  ).data
