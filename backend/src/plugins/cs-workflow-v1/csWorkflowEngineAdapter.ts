import { z } from 'zod';
import type { PluginConfigReader } from '../../core/config/pluginConfig';
import type {
  WorkflowEngineAdapter,
  WorkflowEngineReadinessResult,
  GetWorkflowsResult,
  Workflow,
  GetWorkflowParams,
} from '../../core/integrations/workflow/WorkflowEngineAdapter';
import { HttpClientError, joinUrl, resolveTimeoutMs } from '../../core/http/httpClient';
import { ServiceUnavailableError } from '../../core/errors';
import { log } from '../../core/logging';

const PLUGIN = 'cs-workflow-v1';
const SERVICE = 'Connected Services Workflow';
const WORKFLOWS_PATH = 'workflows';

const workflowItem = z.object({
  id: z.string(),
  name: z.string().optional(),
  nodes: z
    .array(
      z.object({
        type: z.string(),
        parameters: z.object({ path: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});
const WorkflowsResponseSchema = z.object({
  data: z.array(workflowItem),
  nextCursor: z.string().nullable().optional(),
});

/** Connected Services workflows, started and read with the caller's own token. */
export class CsWorkflowEngineAdapter implements WorkflowEngineAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly baseUrlWithoutApi: string;

  constructor(config: PluginConfigReader) {
    this.baseUrl = config.getRequired('API_BASE_URL');
    this.baseUrlWithoutApi = this.baseUrl.replace(/\/api\/v\d+\/*$/, '');
    this.timeoutMs = resolveTimeoutMs(
      config.getOptionalNumber('TIMEOUT_MS'),
      'PLUGIN_CS_WORKFLOW_V1_TIMEOUT_MS',
    );
    this.apiKey = config.getRequired('API_KEY');
  }

  // N8n does'n have a health endpoint, so we just check that we can get the workflows list.
  async readinessCheck(): Promise<WorkflowEngineReadinessResult> {
    try {
      const res = await this.request('GET', WORKFLOWS_PATH);
      const body: unknown = await res.json().catch(() => undefined);
      if (!WorkflowsResponseSchema.safeParse(body).data) {
        return { ok: false, message: `Unexpected ${SERVICE} health response` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async getWorkflows(params: GetWorkflowParams): Promise<GetWorkflowsResult> {
    const { name, cursor } = params;
    const url =
      WORKFLOWS_PATH +
      '?' +
      (name ? `name=${encodeURIComponent(name)}` : '') +
      (name && cursor ? '&' : '') +
      (cursor ? `cursor=${encodeURIComponent(cursor)}` : '') +
      (name || cursor ? '&' : '') +
      'active=true';

    let body: unknown;
    try {
      const res = await this.request('GET', url);
      body = await res.json();
    } catch (err) {
      const status = err instanceof HttpClientError ? err.status : undefined;
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ plugin: PLUGIN, status, error: message }, 'Workflow request failed');
      // The caller sends no input, so a CSTAR 4xx is a 503 too; upstream detail stays out of the response.
      throw new ServiceUnavailableError(
        status ? `${SERVICE} error ${status}` : `${SERVICE} is unavailable`,
      );
    }

    const safeParseResult = WorkflowsResponseSchema.safeParse(body);
    if (!safeParseResult.data) {
      throw new Error(`Unexpected ${SERVICE} workflows response: ${safeParseResult.error.message}`);
    }
    return {
      workflows: safeParseResult.data.data as unknown as Array<Workflow>,
      cursor: safeParseResult.data.nextCursor,
    };
  }

  async getWorkflow(name: string): Promise<Workflow> {
    const workflows = await this.getWorkflows({ name });
    const workflow = workflows.workflows.find((w) => w.name === name);
    if (!workflow) {
      throw new Error(`Workflow ${name} not found`);
    }
    return workflow;
  }

  async startWorkflow(name: string, payload: object): Promise<boolean> {
    const workflow = await this.getWorkflow(name);
    const webhookNode = (workflow as unknown as Workflow).nodes.find(
      (n) => n.type === 'n8n-nodes-base.webhook',
    );

    const path = (webhookNode?.parameters as { path?: string } | null)?.path ?? null;
    if (!path) {
      throw new Error(`Workflow ${name} does not have a path parameter`);
    }
    const res = await this.request('POST', `webhook/${path}`, payload, true);
    if (res.status >= 200 && res.status < 300) {
      return true;
    }
    throw new Error(`Unexpected ${SERVICE} workflows response`);
  }

  /** Request under the base URL; a non-2xx response throws HttpClientError. */
  private async request(
    method: 'GET' | 'POST',
    path: string,
    payload?: unknown,
    withoutApi = false,
  ): Promise<Response> {
    const url = joinUrl(withoutApi ? this.baseUrlWithoutApi : this.baseUrl, path);
    const headers: Record<string, string> = {};
    if (this.apiKey) headers['X-N8N-API-KEY'] = this.apiKey;
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpClientError(res.status, res.statusText, text, url);
    }
    return res;
  }
}
