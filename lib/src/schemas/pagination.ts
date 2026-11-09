import { z } from 'zod';
import { sortTokensFor, type SortToken } from '../sort';

export const OffsetPageSchema = z.object({
  offset: z.number().int().min(0),
  limit: z.number().int().min(1),
  total: z.number().int().min(0),
});

export type OffsetPage = z.infer<typeof OffsetPageSchema>;

/** Options for a select: at most `limit` items, and whether more matched than were returned. */
export const LookupMetaSchema = z.object({
  limit: z.number().int().min(1),
  truncated: z.boolean(),
});

export type LookupMeta = z.infer<typeof LookupMetaSchema>;

export const makeSortEnum = <TField extends string>(fields: readonly TField[]) =>
  z.enum(sortTokensFor(fields) as [SortToken<TField>, ...SortToken<TField>[]]);
