import type {
  DocumentGenerationAdapter,
  DocumentRenderResult,
} from '../../core/integrations/document-generation/DocumentGenerationAdapter';
import type { DocumentGenerationPluginDefinition } from '../../core/integrations/document-generation/DocumentGenerationPluginDefinition';

const CODE = 'docgen-noop';

// Stand-in for a rendered document so local dev/tests run without a real generator.
const PLACEHOLDER = Buffer.from('document generation is disabled (docgen-noop backend)\n');

/** No-op document generator: returns a placeholder document, no external call. Dev/test only. */
function createNoopDocumentGenerationAdapter(): DocumentGenerationAdapter {
  return {
    render(): Promise<DocumentRenderResult> {
      return Promise.resolve({ data: PLACEHOLDER, contentType: 'text/plain' });
    },
  };
}

export const documentGenerationPluginDefinition: DocumentGenerationPluginDefinition = {
  code: CODE,
  metadata: {
    code: CODE,
    name: 'No-op document generator',
  },
  createAdapter: createNoopDocumentGenerationAdapter,
};
