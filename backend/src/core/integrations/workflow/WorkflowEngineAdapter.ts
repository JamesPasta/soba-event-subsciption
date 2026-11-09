/** Result of a workflow engine readiness check; no config or credentials are exposed. */
export interface WorkflowEngineReadinessResult {
  ok: boolean;
  message?: string;
}

export interface Workflow {
  id: string;
  name: string;
  nodes?: Array<Record<string, unknown>>;
}

/** Result of a workflow engine readiness check; no config or credentials are exposed. */
export interface GetWorkflowsResult {
  workflows: Array<Workflow>;
  cursor?: string;
}

export interface GetWorkflowParams {
  name?: string;
  cursor?: string;
}

export interface WorkflowEngineAdapter {
  readinessCheck?(): Promise<WorkflowEngineReadinessResult>;
  getWorkflows?(params: GetWorkflowParams): Promise<GetWorkflowsResult>;
  getWorkflow?(name: string): Promise<Workflow>;
  startWorkflow?(name: string, payload: unknown): Promise<boolean>;
}
