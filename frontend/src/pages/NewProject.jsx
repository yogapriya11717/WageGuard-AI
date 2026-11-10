import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { money, uid } from '../data.js'
import { aiAnalyze } from '../api.js'
import { Icon, Badge, Stamp } from '../components/ui.jsx'

const SAMPLE = 'Hi! Build a five-page website for my studio. I can pay ₹8,000 after launch. We may need a few changes.'
const STEPS = ['The brief', 'Review the plan', 'Approve']
const MAX_CONVERSATION_CHARS = 8000 // same limit as the backend

function Field({ label, flagged, children }) {
  return (
    <label className={`field ${flagged ? 'flagged' : ''}`}>
      <span>{label}{flagged && <Badge tone="red">Not specified</Badge>}</span>
      {children}
    </label>
  )
}

export default function NewProject() {
  const navigate = useNavigate()
  const { dispatch } = useStore()
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [form, setForm] = useState({ title: '', client: '', conversation: '' })
  const [plan, setPlan] = useState(null)

  const ready = form.title.trim() && form.client.trim() && form.conversation.trim().length > 10
  const setF = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const setP = (k, v) => setPlan((p) => ({ ...p, [k]: v }))
  const setMs = (i, k, v) => setPlan((p) => ({ ...p, milestones: p.milestones.map((m, j) => (j === i ? { ...m, [k]: v, suggested: false } : m)) }))
  const setDel = (i, v) => setPlan((p) => ({ ...p, deliverables: p.deliverables.map((d, j) => (j === i ? v : d)) }))

  // Asks the backend (Gemini) to draft the plan. Nothing is saved here. If it fails, you stay on this
  // step with everything you typed, and only a successful answer moves you to the review step.
  const analyze = async () => {
    if (analyzing) return
    if (!ready) { setError('Add a project title, client name and a conversation of at least 11 characters.'); return }
    const conversation = form.conversation.trim()
    if (conversation.length > MAX_CONVERSATION_CHARS) {
      setError(`The conversation is too long (${conversation.length} characters). The limit is ${MAX_CONVERSATION_CHARS}. Please paste only the important messages.`)
      return
    }
    setError('')
    setAnalyzing(true)
    try {
      setPlan(await aiAnalyze(conversation))
      setStep(2)
    } catch (err) {
      setError(err.message || 'The analysis failed. Please try again.')
    } finally {
      setAnalyzing(false)
    }
  }

  const msSum = plan ? plan.milestones.reduce((s, m) => s + (Number(m.amount) || 0), 0) : 0
  const mismatch = plan && Number(plan.total) !== msSum
  const planValid = plan && Number(plan.total) > 0 && plan.milestones.length > 0 &&
    plan.milestones.every((m) => m.title.trim() && Number(m.amount) >= 0) &&
    plan.deliverables.some((d) => d.trim()) && !mismatch

  const approve = async () => {
    if (saving) return
    if (!planValid) { setError('Complete the required details and make sure milestone amounts equal the project total.'); return }
    setError('')
    // revisions may be a number or '' (the input gives a string such as "3")
    const rv = String(plan.revisions ?? '').trim()
    const revisions = rv !== '' && Number.isFinite(Number(rv)) && Number(rv) >= 0 ? Number(rv) : ''
    const project = {
      id: uid('p_'),
      title: form.title.trim(),
      client: form.client.trim(),
      conversation: form.conversation.trim(),
      total: Number(plan.total) || msSum,
      currency: plan.currency,
      createdAt: new Date().toISOString(),
      deliverables: plan.deliverables.map((d) => d.trim()).filter(Boolean),
      deadline: plan.deadline,
      revisions,
      paymentTerms: plan.paymentTerms,
      milestones: plan.milestones.map((m) => ({
        id: uid('m_'), title: m.title, description: m.description || '', amount: Number(m.amount) || 0,
        dueDate: m.dueDate, workStatus: 'Not Started', paymentStatus: 'Not Requested', paypalOrderId: null,
      })),
      scopeChanges: [],
    }
    setSaving(true)
    try {
      // Saved in the database first. If this fails, everything typed so far stays on screen.
      const saved = await dispatch({ type: 'ADD_PROJECT', project })
      navigate(`/projects/${saved.id}`)
    } catch (err) {
      setError(err.message || 'The project could not be saved. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">New project</p>
          <h1>From chat to commitment</h1>
        </div>
      </div>

      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s} className={step === i + 1 ? 'now' : step > i + 1 ? 'done' : ''}>
            <b>{step > i + 1 ? <Icon name="check" size={14} /> : i + 1}</b> {s}
          </li>
        ))}
      </ol>

      {step === 1 && (
        <div className="card pad form-card">
          <div className="grid-2">
            <Field label="Project title">
              <input className="input" value={form.title} onChange={setF('title')} placeholder="e.g. Five-page studio website" disabled={analyzing} />
            </Field>
            <Field label="Client name">
              <input className="input" value={form.client} onChange={setF('client')} placeholder="e.g. Arjun Mehta" disabled={analyzing} />
            </Field>
          </div>
          <Field label="Paste the conversation or brief">
            <textarea className="input" rows="8" value={form.conversation} onChange={setF('conversation')} disabled={analyzing}
              placeholder="Paste what the client wrote on WhatsApp, email, DMs…" />
          </Field>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setForm({ title: 'Five-page studio website', client: 'Arjun Mehta', conversation: SAMPLE })} disabled={analyzing}>
              Use the demo message
            </button>
            <button type="button" className="btn btn-primary" disabled={!ready || analyzing} onClick={analyze}>
              <Icon name="spark" size={16} /> {analyzing ? 'Analyzing…' : 'Analyze conversation'}
            </button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          {analyzing && <p className="helper-note" role="status">Analyzing with AI… this can take up to a minute.</p>}
          <p className="helper-note">The plan is drafted by AI (Google Gemini) from the conversation you paste, and that text is sent to Google for analysis. It is a draft assistant, not legal advice. Review every detail before approving.</p>
        </div>
      )}

      {step === 2 && plan && (
        <div className="plan-grid">
          <div className="stack">
            <div className="card pad callout">
              <h3><Icon name="alert" size={18} /> Gaps worth a conversation</h3>
              <p className="muted">These weren’t clearly agreed. Fill them in, or ask the client before you start.</p>
              <ul>
                {plan.missing.map((m) => (
                  <li key={m.field}><b>{m.field}.</b> {m.note}</li>
                ))}
              </ul>
            </div>

            <div className="card pad form-card">
              <h3>Deliverables</h3>
              {plan.deliverables.map((d, i) => (
                <div className="inline" key={i}>
                  <input className="input" value={d} onChange={(e) => setDel(i, e.target.value)} />
                  <button type="button" className="icon-btn" aria-label="Remove deliverable"
                    onClick={() => setP('deliverables', plan.deliverables.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setP('deliverables', [...plan.deliverables, ''])}>
                <Icon name="plus" size={14} /> Add deliverable
              </button>

              <div className="grid-2 gap-top">
                <Field label="Total amount" flagged={!Number(plan.total)}>
                  <input className="input" type="number" min="0" value={plan.total} onChange={(e) => setP('total', e.target.value)} />
                </Field>
                <Field label="Currency">
                  <select className="input" value={plan.currency} onChange={(e) => setP('currency', e.target.value)}>
                    <option value="INR">INR · ₹</option><option value="USD">USD · $</option>
                  </select>
                </Field>
                <Field label="Deadline" flagged={!plan.deadline}>
                  <input className="input" value={plan.deadline} onChange={(e) => setP('deadline', e.target.value)} placeholder="e.g. 30 Nov 2026" />
                </Field>
                <Field label="Revisions included" flagged={plan.revisions === ''}>
                  <input className="input" type="number" min="0" value={plan.revisions} onChange={(e) => setP('revisions', e.target.value)} />
                </Field>
                <Field label="Payment condition" flagged={!plan.paymentTerms}>
                  <input className="input" value={plan.paymentTerms} onChange={(e) => setP('paymentTerms', e.target.value)} placeholder="e.g. 50% upfront" />
                </Field>
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="card pad form-card">
              <div className="card-head">
                <h3>Milestones</h3>
                {plan.milestones.some((m) => m.suggested) && <Badge tone="ochre">Suggested split</Badge>}
              </div>
              {plan.milestones.map((m, i) => (
                <div className="ms-edit" key={i}>
                  <span className="ms-num">{i + 1}</span>
                  <input className="input" value={m.title} onChange={(e) => setMs(i, 'title', e.target.value)} aria-label="Milestone title" />
                  <input className="input ms-description" value={m.description || ''} onChange={(e) => setMs(i, 'description', e.target.value)} aria-label="Milestone description" placeholder="What will be delivered?" />
                  <input className="input amt" type="number" min="0" step="1" value={m.amount} onChange={(e) => setMs(i, 'amount', e.target.value)} aria-label="Amount" />
                  <input className="input date" type="date" value={m.dueDate} onChange={(e) => setMs(i, 'dueDate', e.target.value)} aria-label="Due date" />
                  <button type="button" className="icon-btn" aria-label="Remove milestone"
                    onClick={() => setP('milestones', plan.milestones.filter((_, j) => j !== i))}><Icon name="trash" size={16} /></button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => setP('milestones', [...plan.milestones, { title: 'New milestone', description: '', amount: 0, dueDate: '' }])}>
                <Icon name="plus" size={14} /> Add milestone
              </button>
              <p className={`sum ${mismatch ? 'warn' : ''}`}>
                Milestones add up to <b className="mono">{money(msSum, plan.currency)}</b>
                {mismatch ? <> — the total says {money(plan.total, plan.currency)}.</> : ' — matches the total.'}
              </p>
            </div>

            <div className="card pad">
              <h3>Original message</h3>
              <blockquote>{form.conversation}</blockquote>
            </div>
          </div>

          <div className="plan-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>Back</button>
            <button type="button" className="btn btn-primary" onClick={() => { setError(''); setStep(3) }} disabled={!planValid}>
              Looks right, continue <Icon name="arrow" size={16} />
            </button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      )}

      {step === 3 && plan && (
        <div className="card pad approve">
          <Stamp tone="red">Draft</Stamp>
          <h2>{form.title}</h2>
          <p className="muted">For {form.client}</p>
          <div className="ledger plain">
            <div className="ledger-row"><span>Deliverables</span><i /><b>{plan.deliverables.filter(Boolean).join(', ') || '—'}</b></div>
            <div className="ledger-row"><span>Total</span><i /><b className="mono">{money(plan.total || msSum, plan.currency)}</b></div>
            <div className="ledger-row"><span>Deadline</span><i /><b>{plan.deadline || 'Not set'}</b></div>
            <div className="ledger-row"><span>Revisions</span><i /><b>{plan.revisions === '' ? 'Not set' : plan.revisions}</b></div>
            <div className="ledger-row"><span>Milestones</span><i /><b>{plan.milestones.length}</b></div>
            <div className="ledger-row"><span>Payment terms</span><i /><b>{plan.paymentTerms || 'Not set'}</b></div>
          </div>
          <div className="approval-milestones">
            <h3>Milestone breakdown</h3>
            {plan.milestones.map((m, i) => <div className="ledger-row" key={i}><span>{m.title}</span><i /><b className="mono">{money(m.amount, plan.currency)}</b></div>)}
          </div>
          <p className="muted">Approving saves this as your reference for the project. Changes later go through a scope check.</p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(2)} disabled={saving}>Back to edit</button>
            <button type="button" className="btn btn-accent" onClick={approve} disabled={!planValid || saving}><Icon name="check" size={16} /> {saving ? 'Saving…' : 'Approve & save plan'}</button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      )}
    </>
  )
}
