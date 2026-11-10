import mongoose from 'mongoose'

const { Schema } = mongoose

// ---------------------------------------------------------------
// Allowed values. These match the frontend (src/data.js) exactly.
// ---------------------------------------------------------------
export const CURRENCIES = ['INR', 'USD']
export const WORK_STATUSES = ['Not Started', 'In Progress', 'Submitted', 'Approved']
export const PAYMENT_STATUSES = ['Not Requested', 'Pending', 'Completed', 'Failed']
export const SCOPE_STATUSES = ['pending', 'clarification', 'accepted', 'declined']
export const CHANGE_KINDS = [
  'Added deliverable',
  'Extra revisions',
  'Changed deadline',
  'Possible additional work',
  'Clarification needed',
]

// ---------------------------------------------------------------
// Small validators. Dates are stored as plain STRINGS, not Date objects.
// ---------------------------------------------------------------

// ISO date-time string, e.g. "2026-10-21T09:00:00.000Z"
const isoDateTime = {
  validator: (value) => /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value)),
  message: (props) => `${props.path} must be an ISO date string like 2026-10-21T09:00:00.000Z`,
}

// Calendar date "YYYY-MM-DD". An empty string is allowed (means "no due date").
const calendarDate = {
  validator: (value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value),
  message: (props) => `${props.path} must be YYYY-MM-DD or an empty string`,
}

// ---------------------------------------------------------------
// 1. "changes" items inside a scope change: { kind, text }
// ---------------------------------------------------------------
const changeSchema = new Schema(
  {
    kind: { type: String, enum: CHANGE_KINDS, required: true },
    text: { type: String, default: '' },
  },
  { _id: false }, // no automatic MongoDB _id for these small objects
)

// ---------------------------------------------------------------
// 2. Milestone (lives inside a project)
// ---------------------------------------------------------------
const milestoneSchema = new Schema(
  {
    id: { type: String, required: true }, // string ID from the frontend, e.g. "m_1"
    title: { type: String, required: true },
    description: { type: String, default: '' },
    amount: { type: Number, required: true, min: 0 },
    dueDate: { type: String, default: '', validate: calendarDate }, // "YYYY-MM-DD" or ''
    workStatus: { type: String, enum: WORK_STATUSES, default: 'Not Started' },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'Not Requested' },
    paypalOrderId: { type: String, default: null },
    paypalCaptureId: { type: String, default: null },
    paidAt: { type: Date, default: null },

    // Optional fields: no default, so they are simply absent until someone sets them.
    updatedAt: { type: String, validate: isoDateTime },
    suggested: { type: Boolean },
  },
  { _id: false, id: false }, // no automatic _id, no extra "id" virtual
)

// ---------------------------------------------------------------
// 3. Scope change (lives inside a project)
// ---------------------------------------------------------------
const scopeChangeSchema = new Schema(
  {
    id: { type: String, required: true }, // string ID from the frontend, e.g. "s_1"
    request: { type: String, required: true },
    changes: { type: [changeSchema], default: [] },
    suggestedAmount: { type: Number, default: 0, min: 0 },
    addDeliverable: { type: String, default: '' },
    status: { type: String, enum: SCOPE_STATUSES, default: 'pending' },
    createdAt: { type: String, required: true, validate: isoDateTime },

    // Optional: only filled in once the freelancer decides.
    decidedAt: { type: String, validate: isoDateTime },
  },
  { _id: false, id: false },
)

// ---------------------------------------------------------------
// 4. Project (the main document)
// ---------------------------------------------------------------
const projectSchema = new Schema(
  {
    id: { type: String, required: true, unique: true }, // string ID, e.g. "p_demo1"
    title: { type: String, required: true },
    client: { type: String, required: true },
    conversation: { type: String, required: true },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: CURRENCIES, required: true },
    createdAt: { type: String, required: true, validate: isoDateTime },
    deliverables: { type: [String], default: [] },
    deadline: { type: String, default: '' }, // free text like "30 Nov 2026"
    paymentTerms: { type: String, default: '' },

    // A number, or null when the client has not set a revision limit.
    // The frontend sometimes sends '' for "not set", so we turn '' into null.
    revisions: {
      type: Number,
      default: null,
      min: 0,
      set: (value) => (value === '' || value === undefined ? null : value),
    },

    milestones: { type: [milestoneSchema], default: [] },
    scopeChanges: { type: [scopeChangeSchema], default: [] },
  },
  {
    timestamps: false, // we never auto-generate createdAt/updatedAt
    versionKey: false, // hides the internal "__v" field
    id: false, // we have our own string "id", so skip Mongoose's default "id" virtual
    toJSON: {
      // MongoDB's own _id stays internal. API responses only contain our fields.
      transform: (doc, ret) => {
        delete ret._id
        return ret
      },
    },
  },
)

// The model. Mongoose stores it in a collection called "projects".
const Project = mongoose.model('Project', projectSchema)

export default Project
