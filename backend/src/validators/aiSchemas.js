import { z } from 'zod'
import { CHANGE_KINDS, CURRENCIES } from '../models/Project.js'

// ---------------------------------------------------------------
// Input limits
// ---------------------------------------------------------------
export const MAX_CONVERSATION_CHARS = 8000
export const MAX_REQUEST_CHARS = 2000

// Turns a Zod error into a simple list of messages, e.g. "project.total: Required"
export function formatZodError(error) {
  return error.issues.map((issue) => {
    const where = issue.path.join('.')
    return where ? `${where}: ${issue.message}` : issue.message
  })
}

// ===============================================================
// 1. What the CLIENT may send us
// ===============================================================

// POST /api/ai/analyze  ->  { conversation }
export const analyzeRequestSchema = z
  .object({
    conversation: z
      .string()
      .trim()
      .min(11, 'must be longer than 10 characters')
      .max(MAX_CONVERSATION_CHARS, `must be at most ${MAX_CONVERSATION_CHARS} characters`),
  })
  .strict() // any other field is rejected

// The part of a project the AI needs. Any other project field is ignored (dropped).
const projectForScopeSchema = z.object({
  deliverables: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  total: z.number().positive().max(1_000_000_000),
  currency: z.enum(CURRENCIES),
  revisions: z.union([z.number().int().min(0).max(1000), z.literal(''), z.null()]).optional(),
  deadline: z.string().max(100).optional(),
  paymentTerms: z.string().max(300).optional(),
})

// POST /api/ai/scope-check  ->  { project, request }
export const scopeCheckRequestSchema = z
  .object({
    project: projectForScopeSchema,
    request: z
      .string()
      .trim()
      .min(3, 'must be at least 3 characters')
      .max(MAX_REQUEST_CHARS, `must be at most ${MAX_REQUEST_CHARS} characters`),
  })
  .strict()

// ===============================================================
// 2. What GEMINI may send back (checked before we trust it)
//    .nullish() means "may be null or missing", so a model that
//    leaves out an empty field does not break us.
// ===============================================================

// Conversation analysis, as Gemini returns it
export const aiAnalysisSchema = z.object({
  deliverables: z.array(z.string()).max(20),
  total: z.number().nullish(),
  currency: z.enum(CURRENCIES).nullish(),
  deadline: z.string().nullish(),
  revisions: z.number().int().min(0).nullish(),
  paymentTerms: z.string().nullish(),
  agreedMilestones: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().nullish(),
        amount: z.number().nullish(),
        dueDate: z.string().nullish(),
      }),
    )
    .max(10)
    .nullish(),
  suggestedMilestones: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().nullish(),
        percent: z.number(),
      }),
    )
    .max(6)
    .nullish(),
  notes: z
    .object({
      total: z.string().nullish(),
      currency: z.string().nullish(),
      deadline: z.string().nullish(),
      revisions: z.string().nullish(),
      paymentTerms: z.string().nullish(),
    })
    .nullish(),
})

// Scope check, as Gemini returns it
export const aiScopeSchema = z.object({
  changes: z.array(z.object({ kind: z.enum(CHANGE_KINDS), text: z.string() })).max(10),
  suggestedAmount: z.number().min(0).nullish(),
  addDeliverable: z.string().nullish(),
})

// ===============================================================
// 3. What WE send to the frontend: the exact shapes of the frontend's
//    analyzeConversation() and scopeCheck() functions.
// ===============================================================

const toCents = (amount) => Math.round(amount * 100)

// analyzeConversation() result.
// revisions is a number or '' (not set). Missing text fields are ''. Missing total is 0.
export const analysisResponseSchema = z
  .object({
    deliverables: z.array(z.string()).min(1),
    total: z.number().min(0),
    currency: z.enum(CURRENCIES),
    deadline: z.string(),
    revisions: z.union([z.number().int().min(0), z.literal('')]),
    paymentTerms: z.string(),
    milestones: z
      .array(
        z.object({
          title: z.string().min(1),
          description: z.string(),
          amount: z.number().min(0),
          dueDate: z.string(),
          suggested: z.boolean(),
        }),
      )
      .min(1),
    missing: z.array(z.object({ field: z.string().min(1), note: z.string().min(1) })),
  })
  .refine(
    (plan) => {
      if (plan.total === 0) return true // no budget known: nothing to add up to
      const sum = plan.milestones.reduce((running, m) => running + m.amount, 0)
      return toCents(sum) === toCents(plan.total)
    },
    { message: 'milestone amounts must add up to the total' },
  )

// scopeCheck() result
export const scopeResponseSchema = z.object({
  changes: z.array(z.object({ kind: z.enum(CHANGE_KINDS), text: z.string().min(1) })).max(5),
  suggestedAmount: z.number().min(0),
  addDeliverable: z.string(),
  withinScope: z.boolean(),
  needsClarification: z.boolean(),
})
