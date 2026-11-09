import type { TemplateFileType } from './templateFileType';

/** Result of a document-generation readiness check; exposes no config or credentials. */
export interface DocumentGenerationReadinessResult {
  ok: boolean;
  message?: string;
}

/** A rendered document returned by the generation backend. */
export interface DocumentRenderResult {
  data: Buffer;
  contentType?: string;
}

/** A document to render: the template file, the answer data it renders, and backend options. */
export interface DocumentRenderRequest {
  template: { content: Buffer; fileType: TemplateFileType };
  data: Record<string, unknown>;
  /** Backend-specific render options, passed through unchanged. */
  options: Record<string, unknown>;
}

export interface DocumentGenerationAdapter {
  /** Render a document and return the raw bytes. The backend shapes the request for its API. */
  render(request: DocumentRenderRequest): Promise<DocumentRenderResult>;
  /** Optional: report whether the backend is reachable (readiness). No config in the result. */
  readinessCheck?(): Promise<DocumentGenerationReadinessResult>;
}
