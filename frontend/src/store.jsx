import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, getProjects, createProject, updateWorkStatus, createScopeChange, decideScopeChange, createPayPalCheckout, capturePayPalCheckout } from './api.js'

// The backend (MongoDB) is now the source of truth for projects.
// The old localStorage key 'wageguard-projects-v1' is no longer read or written, and it is not deleted.
// The theme preference still lives in localStorage (see Layout.jsx).

const StoreContext = createContext(null)

const replaceProject = (list, project) => list.map((p) => (p.id === project.id ? project : p))
const addProject = (list, project) => [project, ...list.filter((p) => p.id !== project.id)]

export function StoreProvider({ children }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true) // true only until the first load finishes
  const [error, setError] = useState('') // set only if the FIRST load fails
  const loadedOnce = useRef(false)
  const latestLoad = useRef(0)

  // Loads all projects from the backend. Only the newest call is allowed to change the state.
  const reload = useCallback(async () => {
    const thisLoad = ++latestLoad.current
    if (!loadedOnce.current) {
      setLoading(true)
      setError('')
    }
    try {
      const list = await getProjects()
      if (thisLoad !== latestLoad.current) return
      loadedOnce.current = true
      setProjects(list)
      setError('')
    } catch (err) {
      if (thisLoad !== latestLoad.current) return
      // If projects are already on screen, keep showing them instead of replacing the page with an error.
      if (!loadedOnce.current) setError(err.message || 'Could not load your projects.')
      else console.error('WageGuard could not refresh projects:', err)
    } finally {
      if (thisLoad === latestLoad.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // Same actions as before, but each one now talks to the backend first and updates the screen
  // only with what the server sends back. dispatch returns a Promise: it resolves with the saved
  // project, or rejects with an ApiError (the screen data stays exactly as it was).
  const dispatch = useCallback(async (action) => {
    switch (action.type) {
      case 'ADD_PROJECT': {
        const saved = await createProject(action.project)
        setProjects((prev) => addProject(prev, saved))
        return saved
      }

      case 'UPDATE_MILESTONE': {
        const patch = action.patch || {}
        if (Object.keys(patch).some((key) => key !== 'workStatus')) {
          throw new ApiError('Only the work status can be changed here. Payments are handled by PayPal.')
        }
        const saved = await updateWorkStatus(action.projectId, action.milestoneId, patch.workStatus)
        setProjects((prev) => replaceProject(prev, saved))
        return saved
      }

      case 'ADD_SCOPE_CHANGE': {
        const saved = await createScopeChange(action.projectId, action.change)
        setProjects((prev) => replaceProject(prev, saved))
        return saved
      }

      case 'DECIDE_SCOPE_CHANGE': {
        const decision = action.status || (action.accept ? 'accepted' : 'declined')
        if (decision !== 'accepted' && decision !== 'declined') {
          throw new ApiError('A scope change can only be accepted or declined.')
        }
        const saved = await decideScopeChange(action.projectId, action.changeId, decision)
        setProjects((prev) => replaceProject(prev, saved))
        return saved
      }

      case 'START_CHECKOUT': {
        const payload = await createPayPalCheckout(action.projectId, action.milestoneId)
        if (payload?.data?.id) setProjects((prev) => replaceProject(prev, payload.data))
        return payload
      }

      case 'CAPTURE_PAYMENT': {
        const payload = await capturePayPalCheckout(action.projectId, action.milestoneId, action.orderId)
        if (payload?.data?.id) setProjects((prev) => replaceProject(prev, payload.data))
        return payload
      }

      default:
        throw new Error(`Unknown action: ${action.type}`)
    }
  }, [])

  const value = useMemo(
    () => ({ projects, dispatch, loading, error, reload }),
    [projects, dispatch, loading, error, reload],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export const useStore = () => useContext(StoreContext)
