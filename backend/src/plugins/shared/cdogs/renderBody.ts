// Shared code for the CDOGS plugins. Under plugins/shared, which the plugin registry skips (see
// NON_PLUGIN_DIRS), so it is never treated as a plugin.

import type { DocumentRenderRequest } from '../../../core/integrations/document-generation/DocumentGenerationAdapter';

type Payload = Record<string, unknown>;

const asRecord = (value: unknown): Payload | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Payload)
    : undefined;

/**
 * Flatten answer data to the shape CDOGS/Carbone templates use ({d.field}). Form-engine submission
 * documents nest the answers under `.data`; unwrap that. Data already flat passes through.
 */
const flattenAnswerData = (data: unknown): Payload => {
  const record = asRecord(data);
  if (!record) return {};
  return asRecord(record.data) ?? record;
};

/**
 * Build the body posted to CDOGS: the template as base64, the flattened answer data, and the
 * options with `overwrite: true` so a cached template hash never 405s (v3/Carbone caches by content
 * hash; v2 ignores the flag). CDOGS-specific policy lives here, keeping the document-generation
 * service agnostic.
 */
export const toCdogsRenderBody = (request: DocumentRenderRequest): Payload => ({
  data: flattenAnswerData(request.data),
  options: { ...request.options, overwrite: true },
  template: {
    content: request.template.content.toString('base64'),
    encodingType: 'base64',
    fileType: request.template.fileType,
  },
});
