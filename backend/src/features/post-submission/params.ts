import { z } from 'zod';

const SourceSchema = z.object({
  scope: z.enum(['workspace', 'form']),
  settingId: z.string(),
  version: z.number().int(),
});

/** An action recorded with a submission: its code, options and the settings row they came from. */
const SubmittedActionSchema = z.object({
  code: z.string(),
  options: z.record(z.string(), z.unknown()),
  source: SourceSchema,
});

/** The submitted job's params: the actions in effect when the submission was received. */
export const SubmittedJobParamsSchema = z.object({
  actions: z.array(SubmittedActionSchema).default([]),
});

/** An action job's params; the options are checked again against the plugin's own schema. */
export const ActionJobParamsSchema = z.object({
  options: z.record(z.string(), z.unknown()),
  source: SourceSchema,
});
