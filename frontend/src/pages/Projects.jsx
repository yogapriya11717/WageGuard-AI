import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store.jsx'
import { Icon, Empty } from '../components/ui.jsx'
import ProjectCard from '../components/ProjectCard.jsx'

function projectStatus(project) {
  const milestones = project.milestones || []
  if (milestones.length && milestones.every((m) => m.workStatus === 'Approved')) return 'Completed'
  if (milestones.some((m) => ['In Progress', 'Submitted', 'Approved'].includes(m.workStatus))) return 'In progress'
  return 'Not started'
}

export default function Projects() {
  const { projects } = useStore()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('All')
  const [sort, setSort] = useState('newest')

  const list = useMemo(() => {
    const filtered = projects.filter((p) => {
      const matchesQuery = `${p.title} ${p.client} ${(p.deliverables || []).join(' ')}`.toLowerCase().includes(q.toLowerCase())
      return matchesQuery && (status === 'All' || projectStatus(p) === status)
    })
    return filtered.sort((a, b) => {
      if (sort === 'name') return a.title.localeCompare(b.title)
      if (sort === 'amount') return Number(b.total || 0) - Number(a.total || 0)
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    })
  }, [projects, q, status, sort])

  return (
    <>
      <div className="page-head">
        <div><p className="eyebrow">Workspace</p><h1>Projects</h1><p className="lede">{projects.length} saved project{projects.length === 1 ? '' : 's'} · search, filter and track progress.</p></div>
        <Link to="/projects/new" className="btn btn-accent btn-sm"><Icon name="plus" size={15} /> New project</Link>
      </div>
      <div className="project-toolbar">
        <label className="search"><Icon name="search" size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search project, client or deliverable" /></label>
        <select className="input filter-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          {['All', 'Not started', 'In progress', 'Completed'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="input filter-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort projects">
          <option value="newest">Newest first</option><option value="name">Name A–Z</option><option value="amount">Highest value</option>
        </select>
      </div>
      {list.length === 0 ? (
        <div className="card"><Empty title={projects.length ? 'No matching projects' : 'No projects yet'}>{projects.length ? 'Try changing your search or filters.' : 'Paste a client message and create your first project plan.'}</Empty>
          {!projects.length && <p className="center"><Link to="/projects/new" className="btn btn-accent">Start a project</Link></p>}
        </div>
      ) : <div className="grid-cards">{list.map((p) => <ProjectCard key={p.id} project={p} />)}</div>}
    </>
  )
}
