import { z } from 'zod';

/** A reaction recorded with a status change: its job type and the options it runs with. */
const StatusReactionSchema = z.object({
  code: z.string(),
  options: z.record(z.string(), z.unknown()),
});

/** The status-changed job's params: the change, and the reactions in effect when it was made. */
export const StatusChangedJobParamsSchema = z.object({
  statusChangeId: z.uuid(),
  actions: z.array(StatusReactionSchema).default([]),
});
export type StatusChangedJobParams = z.infer<typeof StatusChangedJobParamsSchema>;
