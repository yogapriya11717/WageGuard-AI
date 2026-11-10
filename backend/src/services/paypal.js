// WageGuard - PayPal Sandbox service.
//
// getPayPalAccessToken() returns a valid Sandbox access token. The token is cached in memory
// and reused until shortly before it expires. createPayPalOrder() starts a USD order.
// getPayPalOrder() and capturePayPalOrder() read and capture that order.
// Credentials and tokens are never logged and never appear in error messages.
//
// Needs these variables in backend/.env:
//   PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_BASE_URL (https://api-m.sandbox.paypal.com)

export const PAYPAL_SANDBOX_URL = 'https://api-m.sandbox.paypal.com'

const REQUEST_TIMEOUT_MS = 15000 // give up on PayPal after 15 seconds
const EXPIRY_MARGIN_MS = 60000 // treat the token as expired 60 seconds early

// ---------------------------------------------------------------
// Error type. The message is always safe to send to a client or print in a log.
//  - status: the HTTP status the API route should answer with
//  - code:   a short machine-readable reason
// ---------------------------------------------------------------
export class PayPalError extends Error {
  constructor(message, { status = 502, code = 'PAYPAL_ERROR' } = {}) {
    super(message)
    this.name = 'PayPalError'
    this.status = status
    this.code = code
  }
}

// In-memory cache (lost when the server restarts, which is fine).
let cachedToken = null // the access token string
let cachedExpiresAt = 0 // time (ms since epoch) when it stops being valid
let pendingRequest = null // a token request already in progress, shared by concurrent callers

// Treats empty values and placeholders like "your-client-id" as missing.
const isMissing = (value) => value === '' || value.includes('your-')

// ---------------------------------------------------------------
// Reads and checks the PayPal settings. Variable NAMES may appear in errors, values never do.
// ---------------------------------------------------------------
function readConfig() {
  const clientId = (process.env.PAYPAL_CLIENT_ID || '').trim()
  const clientSecret = (process.env.PAYPAL_CLIENT_SECRET || '').trim()
  const baseUrl = (process.env.PAYPAL_BASE_URL || '').trim().replace(/\/+$/, '')

  const missing = []
  if (isMissing(clientId)) missing.push('PAYPAL_CLIENT_ID')
  if (isMissing(clientSecret)) missing.push('PAYPAL_CLIENT_SECRET')
  if (isMissing(baseUrl)) missing.push('PAYPAL_BASE_URL')

  if (missing.length > 0) {
    throw new PayPalError(`PayPal is not configured. Missing: ${missing.join(', ')}`, {
      status: 500,
      code: 'PAYPAL_NOT_CONFIGURED',
    })
  }

  // This project only talks to the Sandbox. Refuse anything else (e.g. the live PayPal URL).
  if (baseUrl !== PAYPAL_SANDBOX_URL) {
    throw new PayPalError(`PAYPAL_BASE_URL must be ${PAYPAL_SANDBOX_URL}`, {
      status: 500,
      code: 'PAYPAL_NOT_CONFIGURED',
    })
  }

  return { clientId, clientSecret, baseUrl }
}

// Short text that is safe to include in an error message.
const safeText = (value) => String(value ?? '').replace(/\s+/g, ' ').slice(0, 120)

// 408, 429 and 5xx mean PayPal may or may not have processed the call, so they are never
// a definite "no". The route keeps the milestone Pending when it sees PAYPAL_UNCERTAIN.
const isUncertainStatus = (status) => status === 408 || status === 429 || status >= 500
const uncertainError = () =>
  new PayPalError(
    'PayPal could not confirm this request right now. Nothing was marked as paid or failed. Wait a moment, then use Resume checkout.',
    { status: 503, code: 'PAYPAL_UNCERTAIN' },
  )

// ---------------------------------------------------------------
// Asks PayPal for a brand-new token. Stores it in the cache on success.
// ---------------------------------------------------------------
async function requestNewToken() {
  const { clientId, clientSecret, baseUrl } = readConfig()
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  let response
  try {
    response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    // Only a short reason is kept. The original error is not attached, so nothing sensitive can leak.
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new PayPalError('PayPal did not respond in time. Please try again.', {
        status: 504,
        code: 'PAYPAL_TIMEOUT',
      })
    }
    throw new PayPalError('Could not reach PayPal. Please try again.', {
      status: 502,
      code: 'PAYPAL_NETWORK_ERROR',
    })
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    body = null // the answer was not JSON
  }

  if (!response.ok) {
    // PayPal's "error" field is a short code like "invalid_client". The response never contains our credentials.
    const reason = typeof body?.error === 'string' ? ` (${safeText(body.error)})` : ''
    throw new PayPalError(`PayPal authentication failed: HTTP ${response.status}${reason}`, {
      status: 502,
      code: 'PAYPAL_AUTH_FAILED',
    })
  }

  if (typeof body?.access_token !== 'string' || body.access_token === '') {
    throw new PayPalError('PayPal returned an unexpected authentication response.', {
      status: 502,
      code: 'PAYPAL_BAD_RESPONSE',
    })
  }

  // expires_in is in seconds. If it is missing or invalid, the token is used but not cached.
  const expiresInSeconds = Number(body.expires_in)
  const lifetimeMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds * 1000 : 0

  cachedToken = body.access_token
  cachedExpiresAt = Date.now() + lifetimeMs

  return cachedToken
}

// ---------------------------------------------------------------
// Public function: returns a valid access token (from the cache when possible).
// Throws PayPalError on any failure.
// ---------------------------------------------------------------
export async function getPayPalAccessToken() {
  // 1. Reuse the cached token while it is still valid (with a safety margin)
  if (cachedToken && Date.now() < cachedExpiresAt - EXPIRY_MARGIN_MS) {
    return cachedToken
  }

  // 2. If another call is already fetching a token, wait for that one instead of sending a second request
  if (pendingRequest) return pendingRequest

  // 3. Otherwise fetch a new one
  pendingRequest = requestNewToken().finally(() => {
    pendingRequest = null
  })
  return pendingRequest
}

// ---------------------------------------------------------------
// Creates a PayPal Sandbox order (intent CAPTURE, USD). Nothing is captured here:
// the client still has to approve the order on PayPal's page.
//
// Input:  { amount, projectId, milestoneId, returnUrl, cancelUrl, requestId }
//   - amount:    a positive number (or numeric string) in USD
//   - requestId: the idempotency key, sent as the PayPal-Request-Id header.
//                Retrying with the same key returns the same order instead of a new one.
// Output: { orderId, status, approvalUrl }
// Throws PayPalError on any failure.
// ---------------------------------------------------------------
export async function createPayPalOrder({ amount, projectId, milestoneId, returnUrl, cancelUrl, requestId } = {}) {
  // 1. Check the input before calling PayPal
  const invalid = (message) => new PayPalError(message, { status: 400, code: 'PAYPAL_INVALID_INPUT' })
  const isText = (value) => typeof value === 'string' && value.trim() !== ''
  const isHttpUrl = (value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol)
    } catch {
      return false
    }
  }

  const numericAmount = typeof amount === 'string' ? Number(amount.trim()) : amount
  if (typeof numericAmount !== 'number' || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw invalid('amount must be a number greater than 0')
  }
  const value = numericAmount.toFixed(2) // PayPal wants a string with 2 decimals, e.g. "150.00"
  if (Number(value) <= 0) throw invalid('amount must be at least 0.01')

  if (!isText(projectId)) throw invalid('projectId is required')
  if (!isText(milestoneId)) throw invalid('milestoneId is required')
  if (!isText(requestId)) throw invalid('requestId is required')
  if (requestId.trim().length > 38) throw invalid('requestId must be 38 characters or fewer')
  if (!isText(returnUrl) || !isHttpUrl(returnUrl)) throw invalid('returnUrl must be a valid http(s) URL')
  if (!isText(cancelUrl) || !isHttpUrl(cancelUrl)) throw invalid('cancelUrl must be a valid http(s) URL')

  // 2. Get the access token (throws PayPalError if that fails)
  const accessToken = await getPayPalAccessToken()

  // 3. Send the request
  let response
  try {
    response = await fetch(`${PAYPAL_SANDBOX_URL}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'PayPal-Request-Id': requestId.trim(),
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: milestoneId.trim(),
            custom_id: `${projectId.trim()}:${milestoneId.trim()}`,
            description: 'WageGuard milestone payment',
            amount: { currency_code: 'USD', value },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: 'PAY_NOW',
              return_url: returnUrl.trim(),
              cancel_url: cancelUrl.trim(),
            },
          },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    // Only a short reason is kept. The original error is not attached, so nothing sensitive can leak.
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new PayPalError('PayPal did not respond in time. Please try again.', {
        status: 504,
        code: 'PAYPAL_TIMEOUT',
      })
    }
    throw new PayPalError('Could not reach PayPal. Please try again.', {
      status: 502,
      code: 'PAYPAL_NETWORK_ERROR',
    })
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    body = null // the answer was not JSON
  }

  if (!response.ok) {
    // The order may exist even though PayPal answered with an error. Keep it ambiguous.
    if (isUncertainStatus(response.status)) throw uncertainError()
    const name = typeof body?.name === 'string' ? ` | ${safeText(body.name)}` : ''
    const message = typeof body?.message === 'string' ? ` | ${safeText(body.message)}` : ''
    throw new PayPalError(`PayPal could not create the order: HTTP ${response.status}${name}${message}`, {
      status: 502,
      code: 'PAYPAL_ORDER_FAILED',
    })
  }

  // 4. Read the result. The approval link is where the client goes to pay.
  const links = Array.isArray(body?.links) ? body.links : []
  const approval = links.find((link) => link?.rel === 'payer-action') || links.find((link) => link?.rel === 'approve')

  if (typeof body?.id !== 'string' || body.id === '' || typeof approval?.href !== 'string') {
    throw new PayPalError('PayPal returned an unexpected order response.', {
      status: 502,
      code: 'PAYPAL_BAD_RESPONSE',
    })
  }

  return { orderId: body.id, status: String(body.status ?? ''), approvalUrl: approval.href }
}

// ---------------------------------------------------------------
// One authenticated PayPal call. Used by get-order and capture.
// Throws PayPalError. Timeout and network failures stay distinct from
// a definite HTTP rejection, so the route can avoid marking a payment Failed
// when PayPal may already have accepted the call.
// ---------------------------------------------------------------
async function paypalJson(path, { method, body, requestId, action }) {
  const { baseUrl } = readConfig()
  const accessToken = await getPayPalAccessToken()
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (requestId) headers['PayPal-Request-Id'] = requestId.trim()

  let response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new PayPalError('PayPal did not respond in time. Please try again.', {
        status: 504,
        code: 'PAYPAL_TIMEOUT',
      })
    }
    throw new PayPalError('Could not reach PayPal. Please try again.', {
      status: 502,
      code: 'PAYPAL_NETWORK_ERROR',
    })
  }

  let parsed = null
  try {
    parsed = await response.json()
  } catch {
    parsed = null
  }

  if (!response.ok) {
    const name = typeof parsed?.name === 'string' ? parsed.name : ''
    const issues = Array.isArray(parsed?.details)
      ? parsed.details.map((item) => item?.issue).filter((issue) => typeof issue === 'string')
      : []
    // 408/429/5xx: PayPal may have processed the call. Never treat as a definite failure.
    if (isUncertainStatus(response.status)) throw uncertainError()
    if (name === 'ORDER_NOT_APPROVED' || issues.includes('ORDER_NOT_APPROVED')) {
      throw new PayPalError('PayPal has not recorded your approval yet. The payment stays Pending. Use Resume checkout to finish it.', {
        status: 409,
        code: 'PAYPAL_ORDER_NOT_APPROVED',
      })
    }
    if (name === 'ORDER_ALREADY_CAPTURED' || issues.includes('ORDER_ALREADY_CAPTURED')) {
      throw new PayPalError('This PayPal order was already captured.', {
        status: 409,
        code: 'PAYPAL_ALREADY_CAPTURED',
      })
    }
    if (name === 'INSTRUMENT_DECLINED' || issues.includes('INSTRUMENT_DECLINED')) {
      throw new PayPalError('The PayPal payment was declined.', {
        status: 402,
        code: 'PAYPAL_CAPTURE_DECLINED',
      })
    }
    if (response.status === 404 || name === 'RESOURCE_NOT_FOUND') {
      throw new PayPalError('PayPal could not find that order.', {
        status: 404,
        code: 'PAYPAL_ORDER_NOT_FOUND',
      })
    }
    const reasonName = name ? ` | ${safeText(name)}` : ''
    const message = typeof parsed?.message === 'string' ? ` | ${safeText(parsed.message)}` : ''
    throw new PayPalError(`PayPal could not ${action}: HTTP ${response.status}${reasonName}${message}`, {
      status: 502,
      code: 'PAYPAL_ORDER_FAILED',
    })
  }

  return parsed
}

function approvalLink(body) {
  const links = Array.isArray(body?.links) ? body.links : []
  const approval = links.find((link) => link?.rel === 'payer-action') || links.find((link) => link?.rel === 'approve')
  return typeof approval?.href === 'string' ? approval.href : ''
}

function readCaptures(unit) {
  const captures = Array.isArray(unit?.payments?.captures) ? unit.payments.captures : []
  return captures.map((capture) => ({
    id: typeof capture?.id === 'string' ? capture.id : '',
    status: typeof capture?.status === 'string' ? capture.status : '',
    currencyCode: typeof capture?.amount?.currency_code === 'string' ? capture.amount.currency_code : '',
    value: typeof capture?.amount?.value === 'string' ? capture.amount.value : '',
  }))
}

// ---------------------------------------------------------------
// Reads one order. Does not capture it.
// ---------------------------------------------------------------
export async function getPayPalOrder(orderId) {
  if (typeof orderId !== 'string' || orderId.trim() === '' || orderId.startsWith('req:')) {
    throw new PayPalError('orderId is required', { status: 400, code: 'PAYPAL_INVALID_INPUT' })
  }

  const body = await paypalJson(`/v2/checkout/orders/${encodeURIComponent(orderId.trim())}`, {
    method: 'GET',
    action: 'load the order',
  })
  const units = Array.isArray(body?.purchase_units) ? body.purchase_units : []
  const unit = units[0] ?? null
  if (typeof body?.id !== 'string' || body.id === '') {
    throw new PayPalError('PayPal returned an unexpected order response.', {
      status: 502,
      code: 'PAYPAL_BAD_RESPONSE',
    })
  }

  return {
    id: body.id,
    status: String(body.status ?? ''),
    unitCount: units.length, // WageGuard orders always have exactly one purchase unit
    customId: typeof unit?.custom_id === 'string' ? unit.custom_id : '',
    referenceId: typeof unit?.reference_id === 'string' ? unit.reference_id : '',
    currencyCode: typeof unit?.amount?.currency_code === 'string' ? unit.amount.currency_code : '',
    amountValue: typeof unit?.amount?.value === 'string' ? unit.amount.value : '',
    approvalUrl: approvalLink(body),
    captures: readCaptures(unit),
  }
}

// ---------------------------------------------------------------
// Captures an approved order. Throws PAYPAL_ALREADY_CAPTURED when PayPal
// says the order was captured already, so the route can read that capture.
// ---------------------------------------------------------------
export async function capturePayPalOrder(orderId, requestId) {
  const invalid = (message) => new PayPalError(message, { status: 400, code: 'PAYPAL_INVALID_INPUT' })
  if (typeof orderId !== 'string' || orderId.trim() === '' || orderId.startsWith('req:')) throw invalid('orderId is required')
  if (typeof requestId !== 'string' || requestId.trim() === '') throw invalid('requestId is required')
  if (requestId.trim().length > 38) throw invalid('requestId must be 38 characters or fewer')

  const body = await paypalJson(`/v2/checkout/orders/${encodeURIComponent(orderId.trim())}/capture`, {
    method: 'POST',
    body: {},
    requestId,
    action: 'capture the order',
  })
  const units = Array.isArray(body?.purchase_units) ? body.purchase_units : []
  const capture = units.length === 1 ? readCaptures(units[0])[0] : null
  if (typeof body?.id !== 'string' || body.id === '' || !capture?.id) {
    throw new PayPalError('PayPal returned an unexpected capture response.', {
      status: 502,
      code: 'PAYPAL_BAD_RESPONSE',
    })
  }

  return {
    orderId: body.id,
    status: String(body.status ?? ''),
    captureId: capture.id,
    captureStatus: capture.status,
    currencyCode: capture.currencyCode,
    amountValue: capture.value,
  }
}
