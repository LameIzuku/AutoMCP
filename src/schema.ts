import { z } from 'zod';

export const inputSchema = z.object({
  question: z.string().trim().min(1).max(8000),
  original_request: z.string().trim().min(1).max(16000),
  project_context: z.string().max(24000).default(''),
  known_preferences: z.string().max(8000).default(''),
  session_id: z.string().min(1).max(200).default('default'),
  requires_user_input: z.boolean().default(false)
}).strict();
export type Input = z.infer<typeof inputSchema>;
export const candidateSchema = z.object({
  answer: z.string().trim().min(1).max(12000),
  needs_user: z.boolean(),
  assumptions: z.array(z.string().max(2000)).max(20)
}).strict();
export type Candidate = z.infer<typeof candidateSchema>;
export const judgmentSchema = z.object({
  winner: z.enum(['A', 'B', 'none']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(4000),
  needs_user: z.boolean()
}).strict();
export type Judgment = z.infer<typeof judgmentSchema>;
export type Result = {
  status: 'resolved' | 'needs_user' | 'error';
  answer: string | null;
  reason: string;
  confidence: number;
  selected_provider?: string;
  candidates?: Record<string, Candidate>;
  mock: boolean;
};
export const candidateJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    answer: { type: 'string' }, needs_user: { type: 'boolean' },
    assumptions: { type: 'array', items: { type: 'string' } }
  }, required: ['answer', 'needs_user', 'assumptions']
};
export const judgmentJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    winner: { type: 'string', enum: ['A', 'B', 'none'] },
    confidence: { type: 'number' }, reason: { type: 'string' }, needs_user: { type: 'boolean' }
  }, required: ['winner', 'confidence', 'reason', 'needs_user']
};
