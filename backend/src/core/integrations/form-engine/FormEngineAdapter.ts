/** Result of a form engine readiness check; no config or credentials are exposed. */
export interface FormEngineReadinessResult {
  ok: boolean;
  message?: string;
}

/** Input for upserting a form schema into the engine; idempotent by form version. */
export interface UpsertSchemaInput {
  /** SOBA form_version id; used to derive the deterministic engine identity. */
  formVersionId: string;
  /** SOBA workspace id; recorded on the engine document for tenancy/filtering. */
  workspaceId: string;
  /** The form definition (Form.io schema JSON) to store. */
  schema: Record<string, unknown>;
  /** Optional human-readable title; defaults to the schema's own title. */
  title?: string;
  /**
   * The document the version refers to, written when it still exists. When given, every other
   * document with the version's identity is deleted before the write.
   */
  engineRef?: string;
  /** Abandons the engine calls when it fires. */
  signal?: AbortSignal;
}

/** Input for creating a new (immutable) submission document in the engine for a save/revision. */
export interface CreateSubmissionInput {
  /** Engine ref of the form the submission belongs to (the form version's engineSchemaRef). */
  engineFormRef: string;
  /** SOBA submission id; recorded on the engine document for correlation. */
  submissionId: string;
  /** SOBA revision id this document is written for; the idempotency key. */
  revisionId: string;
  /** SOBA workspace id; recorded on the engine document for tenancy/filtering. */
  workspaceId: string;
  /** The submission answer data to store. */
  data: Record<string, unknown>;
  /** False stores the answers without the engine's validation, for a draft that may be incomplete. */
  validate: boolean;
}

/** Answers of many submissions keyed by engine ref, and the refs the engine did not return. */
export interface ReadSubmissionsResult {
  found: Map<string, Record<string, unknown>>;
  missing: string[];
}

export interface ReadSubmissionsOptions {
  /**
   * Whole answers, signature images and base64 file data included. Off by default: the engine may
   * shorten or leave out such answers, which keeps large reads small.
   */
  full?: boolean;
}

export interface FormEngineAdapter {
  /** Optional: report whether the engine is reachable (readiness). No config in result. */
  readinessCheck?(): Promise<FormEngineReadinessResult>;
  /**
   * Create or update the engine document for a form version, keyed by a deterministic
   * identity derived from `formVersionId`. Idempotent: safe to retry. Returns the engine ref.
   */
  upsertSchema?(input: UpsertSchemaInput): Promise<{ engineRef: string }>;
  /** Read the engine document by ref. Returns null if not found. */
  readSchema?(engineRef: string): Promise<Record<string, unknown> | null>;
  /** Delete the engine document by ref (compensation / cleanup). */
  deleteSchema?(engineRef: string): Promise<void>;
  /**
   * Create a new submission document under `engineFormRef`. Each save makes a new (immutable)
   * document; idempotent per revision id via a planted correlation key, so a retried write for the
   * same revision converges on one document. Returns the engine ref.
   */
  createSubmission?(input: CreateSubmissionInput): Promise<{ engineRef: string }>;
  /** Read a submission document by form ref + submission ref, stripped of engine-managed fields. Null if not found. */
  readSubmission?(
    engineFormRef: string,
    engineRef: string,
  ): Promise<Record<string, unknown> | null>;
  /**
   * Read many submission documents of one form, stripped like readSubmission. Refs the engine has
   * no document for are listed in `missing`; `signal` abandons the read.
   */
  readSubmissions?(
    engineFormRef: string,
    engineRefs: string[],
    signal?: AbortSignal,
    options?: ReadSubmissionsOptions,
  ): Promise<ReadSubmissionsResult>;
  /** Delete a submission document by form ref + submission ref (compensation / cleanup). */
  deleteSubmission?(engineFormRef: string, engineRef: string): Promise<void>;
  /**
   * Normalize a schema (imported file or exported design) into a clean, portable,
   * builder-ready form definition for this engine. Pure transform — no engine call.
   * Returns the schema unchanged if the engine has nothing to do.
   */
  normalizeSchema?(schema: Record<string, unknown>): Record<string, unknown>;
  /**
   * The parts of a stored schema that decide what a filler sees and how their answers validate,
   * without the document's identity and metadata; what a schema hash covers. Pure, no engine call.
   */
  renderedSchema?(schema: Record<string, unknown>): Record<string, unknown>;
}
