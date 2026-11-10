import { Link } from 'react-router-dom'
import { Meter } from './ui.jsx'
import { money, paidAmount } from '../data.js'

export default function ProjectCard({ project: p }) {
  const paid = paidAmount(p)
  const pct = p.total ? (paid / p.total) * 100 : 0
  const done = p.milestones.filter((m) => m.workStatus === 'Approved').length
  const pendingScope = (p.scopeChanges || []).filter((s) => s.status === 'pending').length
  const status = p.milestones.length && p.milestones.every((m) => m.workStatus === 'Approved')
    ? 'Completed'
    : p.milestones.some((m) => ['In Progress', 'Submitted', 'Approved'].includes(m.workStatus)) ? 'In progress' : 'Not started'

  return (
    <Link to={`/projects/${p.id}`} className="card project-card">
      <div className="pc-top">
        <span className="eyebrow">{p.client}</span>
        <span className={`badge ${status === 'Completed' ? 'b-moss' : status === 'In progress' ? 'b-blue' : 'b-mute'}`}>{status}</span>
      </div>
      <h3>{p.title}</h3>
      <Meter value={pct} />
      <div className="pc-meta">
        <span><b className="mono">{money(paid, p.currency)}</b> of {money(p.total, p.currency)} received</span>
        <span>{done}/{p.milestones.length} milestones</span>
        {pendingScope > 0 && <span className="dot-flag">{pendingScope} open request{pendingScope > 1 ? 's' : ''}</span>}
      </div>
    </Link>
  )
}
