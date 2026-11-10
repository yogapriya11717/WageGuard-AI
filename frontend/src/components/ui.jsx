const paths = {
  home: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>,
  folder: <path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
  scope: <><path d="M7 4L3 8l4 4" /><path d="M3 8h13" /><path d="M17 20l4-4-4-4" /><path d="M21 16H8" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><circle cx="16" cy="14.5" r="1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  alert: <><path d="M12 4l10 17H2z" /><path d="M12 10v5M12 18v.01" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  moon: <path d="M20.5 14.2A8.5 8.5 0 019.8 3.5 8.5 8.5 0 1020.5 14.2z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
}

export function Icon({ name, size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

const WORK_TONE = { 'Not Started': 'mute', 'In Progress': 'ochre', Submitted: 'blue', Approved: 'moss' }
const PAY_TONE = { 'Not Requested': 'mute', Pending: 'ochre', Completed: 'moss', Failed: 'red' }

export const Badge = ({ tone = 'mute', children }) => <span className={`badge b-${tone}`}>{children}</span>
export const WorkBadge = ({ status }) => <Badge tone={WORK_TONE[status]}>{status}</Badge>
export const PayBadge = ({ status }) => <Badge tone={PAY_TONE[status]}>{status}</Badge>

export const Stamp = ({ children, tone = 'moss' }) => <span className={`stamp stamp-${tone}`}>{children}</span>

export const Meter = ({ value }) => (
  <div className="meter" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin="0" aria-valuemax="100">
    <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
  </div>
)

export const Empty = ({ title, children }) => (
  <div className="empty">
    <h3>{title}</h3>
    <p>{children}</p>
  </div>
)
