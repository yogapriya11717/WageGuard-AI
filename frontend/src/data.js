// ---------- constants & helpers ----------
export const WORK = ['Not Started', 'In Progress', 'Submitted', 'Approved']
export const PAY = ['Not Requested', 'Pending', 'Completed', 'Failed']

export const money = (n, cur = 'INR') =>
  (cur === 'USD' ? '$' : '₹') + Number(n || 0).toLocaleString(cur === 'USD' ? 'en-US' : 'en-IN')

export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No date set'

export const uid = (prefix) => prefix + Math.random().toString(36).slice(2, 8)

export const paidAmount = (p) =>
  p.milestones.filter((m) => m.paymentStatus === 'Completed').reduce((s, m) => s + m.amount, 0)

