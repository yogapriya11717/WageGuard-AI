import { Link } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { money, paidAmount } from '../data.js'
import { Icon, PayBadge, Empty } from '../components/ui.jsx'
import ProjectCard from '../components/ProjectCard.jsx'

export default function Dashboard() {
  const { projects } = useStore()
  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const all = projects.flatMap((p) => p.milestones.map((m) => ({ ...m, project: p })))
  const waiting = all.filter((m) => m.workStatus === 'Approved' && m.paymentStatus !== 'Completed')
  const active = projects.filter((p) => p.milestones.some((m) => m.paymentStatus !== 'Completed')).length
  const scope = projects.flatMap((p) => p.scopeChanges.filter((s) => s.status === 'pending').map((s) => ({ ...s, project: p })))
  const recent = all.filter((m) => m.paymentStatus !== 'Not Requested').slice(0, 5)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const upcoming = projects.flatMap((p) => p.milestones
    .filter((m) => m.dueDate && new Date(`${m.dueDate}T00:00:00`) >= today && m.workStatus !== 'Approved')
    .map((m) => ({ ...m, project: p })))
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)).slice(0, 4)
  const currencies = [...new Set(projects.map((p) => p.currency || 'INR'))]
  const formatTotals = (amounts) => currencies.map((currency) => money(amounts[currency] || 0, currency)).join(' · ')
  const totals = (selector) => projects.reduce((acc, p) => {
    acc[p.currency || 'INR'] = (acc[p.currency || 'INR'] || 0) + selector(p)
    return acc
  }, {})
  const portfolioByCurrency = totals((p) => Number(p.total || 0))
  const receivedByCurrency = totals((p) => paidAmount(p))
  const waitingByCurrency = totals((p) => p.milestones.filter((m) => m.paymentStatus === 'Pending' || (m.workStatus === 'Approved' && m.paymentStatus === 'Not Requested')).reduce((sum, m) => sum + Number(m.amount || 0), 0))

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">YOUR WORK. YOUR TERMS. YOUR PAYMENTS.</p>

<h1>
  Turn unclear client conversations into
  <em> clear commitments.</em>
</h1>

<p className="hero-description">
  WageGuard helps freelancers define project expectations,
  detect scope changes, and track milestone payments —
  all in one place.
</p>
          <div className="hero-actions">
            <Link to="/projects/new" className="btn btn-primary">
              <Icon name="spark" size={16} /> Create a project plan
            </Link>
            <Link to="/payments" className="btn btn-ghost">See payments</Link>
          </div>
        </div>

        <div className="card ledger">
          <h4>This month at a glance</h4>
          {[
            ['Received', formatTotals(receivedByCurrency)],
            ['Ready to collect', formatTotals(waitingByCurrency)],
            ['Projects running', active],
            ['Scope requests open', scope.length],
          ].map(([k, v]) => (
            <div className="ledger-row" key={k}>
              <span>{k}</span><i /><b className="mono">{v}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="trio stats-strip">
        <div className="card pad"><span className="eyebrow">Portfolio value</span><p className="big mono">{formatTotals(portfolioByCurrency)}</p><small>Across {projects.length} saved projects</small></div>
        <div className="card pad"><span className="eyebrow">Pending collection</span><p className="big mono">{formatTotals(waitingByCurrency)}</p><small>Approved or requested milestone payments</small></div>
        <div className="card pad"><span className="eyebrow">Work in progress</span><p className="big mono">{all.filter((m) => ['In Progress', 'Submitted'].includes(m.workStatus)).length}</p><small>Milestones currently underway</small></div>
      </section>

      <section className="two-col">
        <div className="card pad">
          <div className="card-head">
            <h2>Next actions</h2>
          </div>
          {waiting.length === 0 ? (
            <Empty title="All clear">Approved milestones that need payment will show up here.</Empty>
          ) : (
            <ul className="rows">
              {waiting.map((m) => (
                <li key={m.id}>
                  <div>
                    <strong>{m.title}</strong>
                    <small>{m.project.title}</small>
                  </div>
                  <span className="mono">{money(m.amount, m.project.currency)}</span>
                  <PayBadge status={m.paymentStatus} />
                  <Link to={`/projects/${m.project.id}`} className="icon-link" aria-label="Open project"><Icon name="arrow" /></Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card pad">
          <div className="card-head">
            <h2>Client requests</h2>
            <Link to="/scope" className="text-link">All requests</Link>
          </div>
          {scope.length === 0 ? (
            <Empty title="No new requests">When a client asks for more, check it against the plan from the project page.</Empty>
          ) : (
            <ul className="rows">
              {scope.map((s) => (
                <li key={s.id}>
                  <div>
                    <strong>“{s.request}”</strong>
                    <small>{s.project.title}</small>
                  </div>
                  <Link to={`/projects/${s.project.id}`} className="btn btn-ghost btn-sm">Review</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2>Your projects</h2>
          <Link to="/projects" className="text-link">View all</Link>
        </div>
        <div className="grid-cards">
          {projects.slice(0, 3).map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
      </section>

      <section className="card pad">
        <div className="card-head"><h2>Upcoming deadlines</h2><span className="eyebrow">{upcoming.length} on the horizon</span></div>
        {upcoming.length === 0 ? <Empty title="No upcoming deadlines">Add due dates to milestones to keep your delivery schedule visible.</Empty> : (
          <ul className="rows">
            {upcoming.map((m) => <li key={m.id}>
              <div><strong>{m.title}</strong><small>{m.project.title}</small></div>
              <span className="mono">{new Date(`${m.dueDate}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              <Link to={`/projects/${m.project.id}`} className="btn btn-ghost btn-sm">View</Link>
            </li>)}
          </ul>
        )}
      </section>

      <section className="card pad">
        <div className="card-head"><h2>Recent payment activity</h2></div>
        {recent.length === 0 ? (
          <Empty title="No payments yet">Once you request a milestone payment, it will be logged here.</Empty>
        ) : (
          <ul className="rows">
            {recent.map((m) => (
              <li key={m.id}>
                <div><strong>{m.title}</strong><small>{m.project.client}</small></div>
                <span className="mono">{money(m.amount, m.project.currency)}</span>
                <PayBadge status={m.paymentStatus} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
