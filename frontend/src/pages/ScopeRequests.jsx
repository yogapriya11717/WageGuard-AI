import { Link } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { money } from '../data.js'
import { Badge, Empty } from '../components/ui.jsx'

const tone = { pending: 'ochre', clarification: 'ochre', accepted: 'moss', declined: 'mute' }

export default function ScopeRequests() {
  const { projects } = useStore()
  const all = projects.flatMap((p) => p.scopeChanges.map((s) => ({ ...s, project: p })))

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Scope</p>
          <h1>Client requests</h1>
          <p className="lede">Every “can you also…” is logged here, so nothing slips into the work unpriced.</p>
        </div>
      </div>

      <div className="card pad">
        {all.length === 0 ? (
          <Empty title="Nothing logged">Check a new request from inside a project and it will be saved here.</Empty>
        ) : (
          <ul className="rows">
            {all.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>“{s.request}”</strong>
                  <small>{s.project.title} · {s.changes.map((c) => c.kind).join(', ')}</small>
                </div>
                <span className="mono">{s.suggestedAmount ? `+${money(s.suggestedAmount, s.project.currency)}` : '—'}</span>
                <Badge tone={tone[s.status]}>{s.status}</Badge>
                <Link to={`/projects/${s.project.id}`} className="btn btn-ghost btn-sm">Open</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
