import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { money } from '../data.js'
import { PayBadge, Empty } from '../components/ui.jsx'

// Shows the PayPal order id. The internal "req:" marker (checkout starting) is never shown.
const orderRef = (id) => (!id ? '—' : id.startsWith('req:') ? 'Starting checkout…' : id)

export default function Payments() {
  const { projects } = useStore()
  const [filter, setFilter] = useState('All')
  const rows = projects.flatMap((p) => p.milestones.map((m) => ({ ...m, project: p })))
    .filter((m) => m.paymentStatus !== 'Not Requested')
    .sort((a, b) => (b.updatedAt || b.dueDate || '').localeCompare(a.updatedAt || a.dueDate || ''))
  const currencies = [...new Set(projects.map((p) => p.currency || 'INR'))]
  const sum = (status, currency) => rows.filter((m) => m.paymentStatus === status && m.project.currency === currency).reduce((t, m) => t + Number(m.amount || 0), 0)
  const visible = filter === 'All' ? rows : rows.filter((m) => m.paymentStatus === filter)

  return (
    <>
      <div className="page-head">
        <div><p className="eyebrow">Money</p><h1>Payments</h1><p className="lede">Milestone payments are collected in the PayPal Sandbox.</p></div>
      </div>
      <div className="trio">
        {[
          ['Received', 'Completed', 'b-moss'],
          ['Pending', 'Pending', 'b-ochre'],
          ['Failed', 'Failed', 'b-red'],
        ].map(([label, status, tone]) => (
          <div className="card pad" key={status}><span className="eyebrow">{label}</span>
            {currencies.map((currency) => <p className="big mono" key={currency}>{money(sum(status, currency), currency)}</p>)}
            <small>{label === 'Received' ? 'Completed Sandbox payments' : `${label} milestone transactions`}</small>
          </div>
        ))}
      </div>
      <div className="card pad">
        <div className="card-head"><div><h2>Transaction history</h2><p className="muted">Payment records attached to their project and milestone.</p></div>
          <select className="input filter-select" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter transactions">
            <option>All</option><option>Pending</option><option>Completed</option><option>Failed</option>
          </select>
        </div>
        {visible.length === 0 ? <Empty title="No transactions found">{rows.length ? 'No transactions match this filter.' : 'Request payment on an approved milestone to see it here.'}</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Milestone</th><th>Project</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>{visible.map((m) => <tr key={`${m.project.id}-${m.id}`}>
              <td><strong>{m.title}</strong><small>{m.dueDate || 'No due date'}</small></td>
              <td><Link className="text-link" to={`/projects/${m.project.id}`}>{m.project.title}</Link></td>
              <td className="mono muted">{orderRef(m.paypalOrderId)}</td>
              <td className="mono">{money(m.amount, m.project.currency)}</td>
              <td><PayBadge status={m.paymentStatus} /></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </div>
    </>
  )
}
