import { Routes, Route, Link } from 'react-router-dom'
import Layout from './components/Layout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Projects from './pages/Projects.jsx'
import NewProject from './pages/NewProject.jsx'
import ProjectDetail from './pages/ProjectDetail.jsx'
import ScopeRequests from './pages/ScopeRequests.jsx'
import Payments from './pages/Payments.jsx'

function NotFound() {
  return (
    <div className="empty">
      <h3>That page wandered off.</h3>
      <p>The link may be old or the project was removed.</p>
      <Link className="btn btn-primary" to="/">Back to your desk</Link>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/new" element={<NewProject />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="scope" element={<ScopeRequests />} />
        <Route path="payments" element={<Payments />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
