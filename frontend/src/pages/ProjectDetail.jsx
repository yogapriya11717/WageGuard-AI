import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { WORK, money, fmtDate, paidAmount } from '../data.js'
import { aiScopeCheck } from '../api.js'
import { Icon, Badge, PayBadge, Stamp, Meter } from '../components/ui.jsx'

// One capture per PayPal return, shared by the Strict Mode remount.
// An entry only lives while its request is in flight (it is removed when the request settles),
// so a failed capture is never replayed and can be tried again.
const returnCaptures = new Map()

function payAction(milestone, currency) {
  const usd = currency === 'USD'
  const hasAmount = Number(milestone.amount) > 0
  if (!usd) return { kind: 'note', text: 'PayPal checkout is available for USD projects only.' }
  if (!hasAmount) return { kind: 'note', text: 'This milestone has no amount to collect.' }
  if (milestone.paymentStatus === 'Pending') return { kind: 'button', label: 'Resume checkout', tone: 'btn-primary' }
  if (milestone.workStatus !== 'Approved') return { kind: 'note', text: 'Available once the work is approved' }
  if (milestone.paymentStatus === 'Failed') return { kind: 'button', label: 'Try again', tone: 'btn-accent' }
  if (milestone.paymentStatus === 'Not Requested') return { kind: 'button', label: 'Request payment', tone: 'btn-accent' }
  return null
}

function Milestone({ m, i, currency, onWork, busy, saving, onPay, paying }) {
  const action = payAction(m, currency)
  const paymentLocked = m.paymentStatus === 'Pending' || m.paymentStatus === 'Completed'
  return (
    <article className="card receipt">
      <div className="receipt-top">
        <span className="ms-num">{i + 1}</span>
        <div className="grow">
          <h4>{m.title}</h4>
          <small>{m.description || 'No description'} · due {fmtDate(m.dueDate)}</small>
        </div>
        <b className="mono amount">{money(m.amount, currency)}</b>
      </div>

      <div className="seg" role="group" aria-label="Work status">
        {WORK.map((w) => (
          <button key={w} type="button" className={m.workStatus === w ? 'on' : ''} onClick={() => onWork(w)} disabled={busy || paymentLocked}>{w}</button>
        ))}
      </div>

      <div className="receipt-foot">
        <PayBadge status={m.paymentStatus} />
        <div className="grow" />
        {saving && <small className="muted">Saving…</small>}
        {paying && <small className="muted">Opening PayPal…</small>}
        {m.paymentStatus === 'Completed' && <span className="mono muted">{m.paypalOrderId}</span>}
        {action?.kind === 'note' && <small className="muted">{action.text}</small>}
        {action?.kind === 'button' && (
          <button className={`btn ${action.tone} btn-sm`} onClick={() => onPay(m)} disabled={busy || paying}>{action.label}</button>
        )}
      </div>
    </article>
  )
}

export default function ProjectDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { projects, dispatch, reload } = useStore()
  const [savingId, setSavingId] = useState(null) // milestone being saved right now
  const [payBusy, setPayBusy] = useState(null) // milestone whose PayPal checkout is in flight
  const [workError, setWorkError] = useState('')
  const [paymentError, setPaymentError] = useState('')
  const [paymentNote, setPaymentNote] = useState('')
  const [request, setRequest] = useState('')
  const [result, setResult] = useState(null)
  const [checking, setChecking] = useState(false) // the AI scope check is running
  const [logging, setLogging] = useState(false) // a scope-change request is being saved
  const [scopeError, setScopeError] = useState('')
  const [decidingId, setDecidingId] = useState(null) // scope change being accepted/rejected right now
  const [decideError, setDecideError] = useState('')

  const paymentFlag = searchParams.get('payment')
  const returnMilestone = searchParams.get('milestone')
  const paypalToken = searchParams.get('token')

  // PayPal sends the browser back here. The redirect itself is not proof of payment:
  // the backend captures the order and only then marks the milestone paid.
  useEffect(() => {
    if (!id) return
    if (paymentFlag === 'cancel') {
      setPaymentNote('Checkout was cancelled. You can resume it when you are ready.')
      setPaymentError('')
      navigate(`/projects/${id}`, { replace: true })
      return
    }
    if (paymentFlag !== 'return' || !returnMilestone || !paypalToken) return

    const key = `${id}:${returnMilestone}:${paypalToken}`
    if (!returnCaptures.has(key)) {
      const attempt = dispatch({ type: 'CAPTURE_PAYMENT', projectId: id, milestoneId: returnMilestone, orderId: paypalToken })
        .finally(() => returnCaptures.delete(key)) // success or failure: forget it so a retry can run
      returnCaptures.set(key, attempt)
    }
    let active = true
    setPayBusy(returnMilestone)
    setPaymentError('')
    setPaymentNote('')
    returnCaptures.get(key).then(() => {
      if (!active) return
      setPaymentNote('Payment completed.')
    }).catch((err) => {
      if (!active) return
      setPaymentError(`Payment is not confirmed: ${err.message}`)
      reload() // show what the server really holds (Pending shows Resume checkout)
    }).finally(() => {
      if (!active) return
      setPayBusy(null)
      navigate(`/projects/${id}`, { replace: true })
    })
    return () => { active = false }
  }, [paymentFlag, returnMilestone, paypalToken, id, dispatch, navigate, reload])

  const project = projects.find((p) => p.id === id)
  if (!project) {
    return (
      <div className="empty">
        <h3>Project not found</h3>
        <Link className="btn btn-primary" to="/projects">All projects</Link>
      </div>
    )
  }

  const paid = paidAmount(project)

  // Opens PayPal hosted checkout. Completed is never set from this page.
  const startCheckout = async (m) => {
    if (payBusy || savingId) return
    setPaymentError('')
    setPaymentNote('')
    setPayBusy(m.id)
    try {
      const payload = await dispatch({ type: 'START_CHECKOUT', projectId: project.id, milestoneId: m.id })
      if (payload?.needsCapture && payload.orderId) {
        await dispatch({
          type: 'CAPTURE_PAYMENT',
          projectId: project.id,
          milestoneId: m.id,
          orderId: payload.orderId,
        })
        setPaymentNote('Payment completed.')
        return
      }
      if (payload?.approvalUrl) {
        window.location.assign(payload.approvalUrl)
        return
      }
      const paid = payload?.data?.milestones?.find((item) => item.id === m.id)
      if (paid?.paymentStatus === 'Completed') {
        setPaymentNote('Payment completed.')
        return
      }
      setPaymentError('PayPal did not return a checkout link. Use Resume checkout to try again.')
    } catch (err) {
      setPaymentError(err.message)
      // A timeout can leave the milestone Pending on the server even though this call failed.
      // Reload so the screen shows Pending and the Resume checkout button.
      reload()
    } finally {
      setPayBusy(null)
    }
  }

  // Saves a work-status change in the database. The screen only changes after the server confirms it.
  // Only workStatus is ever sent. Payment fields cannot be changed from the frontend.
  const changeWork = async (m, workStatus) => {
    if (savingId || m.workStatus === workStatus) return
    setWorkError('')
    setSavingId(m.id)
    try {
      await dispatch({ type: 'UPDATE_MILESTONE', projectId: project.id, milestoneId: m.id, patch: { workStatus } })
    } catch (err) {
      setWorkError(`Couldn’t save “${m.title}”: ${err.message}`)
    } finally {
      setSavingId(null)
    }
  }

  // Asks the backend (Gemini) to compare the message with the agreement. Nothing is saved by this.
  // A request is only logged when you click "Log request & review".
  const MAX_REQUEST_CHARS = 2000 // same limit as the backend
  const runCheck = async () => {
    if (checking || logging) return
    const text = request.trim()
    if (text.length > MAX_REQUEST_CHARS) {
      setScopeError(`This message is too long (${text.length} characters). The limit is ${MAX_REQUEST_CHARS}.`)
      return
    }
    setScopeError('')
    setResult(null)
    setChecking(true)
    try {
      setResult(await aiScopeCheck(project, text))
    } catch (err) {
      setScopeError(`Couldn’t check this request: ${err.message}`)
    } finally {
      setChecking(false)
    }
  }

  // Saves the request in the database. The backend creates the id and the date.
  // The form is cleared only after the server confirms, so nothing typed is lost if saving fails.
  const logRequest = async () => {
    if (logging) return
    setScopeError('')
    setLogging(true)
    try {
      await dispatch({
        type: 'ADD_SCOPE_CHANGE', projectId: project.id,
        change: { request: request.trim(), changes: result.changes, suggestedAmount: result.suggestedAmount, addDeliverable: result.addDeliverable, status: result.needsClarification ? 'clarification' : 'pending' },
      })
      setRequest(''); setResult(null)
    } catch (err) {
      setScopeError(`Couldn’t log this request: ${err.message}`)
    } finally {
      setLogging(false)
    }
  }

  // Accept or reject. The backend does all the work (new total, new deliverable, add-on milestone);
  // the screen just shows the project the server sends back.
  const decide = async (change, accept) => {
    if (decidingId) return
    setDecideError('')
    setDecidingId(change.id)
    try {
      await dispatch({ type: 'DECIDE_SCOPE_CHANGE', projectId: project.id, changeId: change.id, accept })
    } catch (err) {
      setDecideError(`Couldn’t ${accept ? 'accept' : 'reject'} this request: ${err.message}`)
      if (err.status === 409) reload() // already decided elsewhere: refresh so the screen shows the real state
    } finally {
      setDecidingId(null)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/projects" className="text-link">← Projects</Link>
          <h1>{project.title}</h1>
          <p className="lede">For {project.client}</p>
        </div>
        <Stamp>Plan approved</Stamp>
      </div>

      <div className="card pad summary">
        <div>
          <span className="eyebrow">Received</span>
          <p className="big mono">{money(paid, project.currency)}<small> / {money(project.total, project.currency)}</small></p>
          <Meter value={project.total ? (paid / project.total) * 100 : 0} />
        </div>
        <div><span className="eyebrow">Deadline</span><p>{project.deadline || 'Not set'}</p></div>
        <div><span className="eyebrow">Revisions</span><p>{project.revisions === '' ? 'Not set' : project.revisions}</p></div>
        <div><span className="eyebrow">Payment</span><p>{project.paymentTerms || 'Not set'}</p></div>
      </div>

      <div className="card pad agreement-card">
        <div className="card-head"><h2>Agreement snapshot</h2><Badge tone="moss">Approved reference</Badge></div>
        <div className="agreement-grid">
          <div><span className="eyebrow">Client</span><p>{project.client}</p></div>
          <div><span className="eyebrow">Agreed total</span><p className="mono">{money(project.total, project.currency)}</p></div>
          <div><span className="eyebrow">Deadline</span><p>{project.deadline || 'Not specified'}</p></div>
          <div><span className="eyebrow">Revision limit</span><p>{project.revisions === '' ? 'Not specified' : project.revisions}</p></div>
          <div><span className="eyebrow">Payment terms</span><p>{project.paymentTerms || 'Not specified'}</p></div>
        </div>
        <details className="agreement-source"><summary>View original client conversation</summary><blockquote>{project.conversation || 'No original message saved.'}</blockquote></details>
      </div>

      <div className="detail-grid">
        <section>
          <div className="section-head"><h2>Milestones</h2></div>
          {workError && <p className="form-error" role="alert">{workError}</p>}
          {paymentError && <p className="form-error" role="alert">{paymentError}</p>}
          {paymentNote && <p className="muted" role="status">{paymentNote}</p>}
          <div className="stack">
            {project.milestones.map((m, i) => (
              <Milestone key={m.id} m={m} i={i} currency={project.currency}
                onWork={(w) => changeWork(m, w)} busy={savingId !== null || payBusy !== null} saving={savingId === m.id}
                onPay={startCheckout} paying={payBusy === m.id} />
            ))}
          </div>
        </section>

        <aside className="stack">
          <div className="card pad">
            <h3>Agreed scope</h3>
            <ul className="bullets">
              {project.deliverables.map((d) => <li key={d}>{d}</li>)}
            </ul>
          </div>

          <div className="card pad form-card">
            <h3>Did the client ask for more?</h3>
            <p className="muted">Paste the new message. We’ll compare it with the approved plan.</p>
            <textarea className="input" rows="4" value={request} onChange={(e) => { setRequest(e.target.value); setResult(null); setScopeError('') }} disabled={logging || checking}
              placeholder="e.g. Can you also add three more pages?" />
            <button className="btn btn-primary btn-sm" disabled={request.trim().length < 5 || logging || checking}
              onClick={runCheck}>
              <Icon name="scope" size={15} /> {checking ? 'Checking…' : 'Check against scope'}
            </button>

            {result && (
              <div className={`verdict ${result.withinScope ? 'ok' : 'over'}`}>
                {result.withinScope ? (
                  <p><b>Looks within scope.</b> Nothing here goes beyond the approved plan.</p>
                ) : (
                  <>
                    <p><b>{result.needsClarification ? 'This request needs clarification.' : 'This may go beyond the agreed scope.'}</b></p>
                    <ul>{result.changes.map((c, i) => <li key={`${c.kind}-${i}`}><Badge tone={result.needsClarification ? 'ochre' : 'red'}>{c.kind}</Badge> {c.text}</li>)}</ul>
                    {result.suggestedAmount > 0 && <p>Suggested add-on: <b className="mono">{money(result.suggestedAmount, project.currency)}</b></p>}
                    <button className="btn btn-accent btn-sm" onClick={logRequest} disabled={logging}>{logging ? 'Logging…' : 'Log request & review'}</button>
                  </>
                )}
              </div>
            )}
            {scopeError && <p className="form-error" role="alert">{scopeError}</p>}
          </div>

          {project.scopeChanges.length > 0 && (
            <div className="card pad">
              <h3>Request history</h3>
              {decideError && <p className="form-error" role="alert">{decideError}</p>}
              <ul className="stack-sm">
                {project.scopeChanges.map((s) => (
                  <li key={s.id} className="change">
                    <p>“{s.request}”</p>
                    {['pending', 'clarification'].includes(s.status) ? (
                      <>
                        {s.status === 'clarification' && <Badge tone="ochre">Clarification needed</Badge>}
                        <div className="form-actions">
                          {/* "Need clarification" is hidden for now: the backend only accepts accepted/declined decisions.
                              A request the AI flags as needing clarification is still saved with that status when it is logged. */}
                          {decidingId === s.id && <small className="muted">Saving…</small>}
                          <button className="btn btn-ghost btn-sm" onClick={() => decide(s, false)} disabled={decidingId !== null}>Reject</button>
                          <button className="btn btn-primary btn-sm" onClick={() => decide(s, true)} disabled={decidingId !== null}>
                            Accept {s.suggestedAmount ? `+${money(s.suggestedAmount, project.currency)}` : 'change'}
                          </button>
                        </div>
                      </>
                    ) : <Badge tone={s.status === 'accepted' ? 'moss' : 'mute'}>{s.status}</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      <section className="card pad">
        <div className="card-head"><h2>Activity history</h2></div>
        <ul className="activity-list">
          <li><span className="activity-dot" /><div><strong>Project plan approved</strong><small>{new Date(project.createdAt).toLocaleString('en-IN')}</small></div></li>
          {project.milestones.filter((m) => m.updatedAt || m.paymentStatus === 'Completed').map((m) => (
            <li key={`activity-${m.id}`}><span className="activity-dot" /><div><strong>{m.title} · {m.paymentStatus === 'Completed' ? 'Payment completed' : m.workStatus}</strong><small>{m.paidAt ? new Date(m.paidAt).toLocaleString('en-IN') : m.updatedAt ? new Date(m.updatedAt).toLocaleString('en-IN') : 'Date not recorded'}</small></div></li>
          ))}
          {(project.scopeChanges || []).map((change) => (
            <li key={`scope-${change.id}`}><span className="activity-dot" /><div><strong>Scope request · {change.status}</strong><small>{change.request} · {new Date(change.createdAt).toLocaleString('en-IN')}</small></div></li>
          ))}
        </ul>
      </section>

    </>
  )
}
