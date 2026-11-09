import { Request, Response } from 'express';
import { pool } from '../../db/client';
import { jobStats } from '../../db/repos/jobRepo';
import { checkFormEngineReadiness } from '../../integrations/form-engine/FormEngineRegistry';
import { checkDocumentGenerationReadiness } from '../../integrations/document-generation/DocumentGenerationRegistry';
import { checkUserSearchReadiness } from '../../integrations/user-search/UserSearchRegistry';
import { checkCredentialIssuerReadiness } from '../../integrations/credential-issuer/CredentialIssuerRegistry';
import { checkTenantEngineReadiness } from '../../integrations/tenant/TenantEngineRegistry';
import { checkWorkflowEngineReadiness } from '../../integrations/workflow/WorkflowEngineRegistry';
import {
  checkStorageReadiness,
  getCacheAdapter,
  getMessageBusAdapter,
  getEventStreamAdapter,
  getTempStorageAdapter,
  getVirusScanAdapter,
} from '../../integrations/plugins/PluginRegistry';
import { reportReadiness } from '../../integrations/plugins/readiness';

export async function readinessHandler(_req: Request, res: Response): Promise<void> {
  let dbOk = false;
  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch {
    // dbOk stays false
  }

  const formEngines = await checkFormEngineReadiness();
  const allEnginesOk = Object.values(formEngines).every((r) => r.ok);

  // Everything below is reported but non-gating — an outage degrades a feature (uploads, rendering,
  // caching, cross-pod fan-out, tenant lookup, workflows), it doesn't pull the pod from rotation the way DB or a
  // form engine does. Adapters without a readinessCheck (e.g. cache-memory, messagebus-memory) report
  // reachable.
  const storage = await checkStorageReadiness();
  const documentGeneration = await checkDocumentGenerationReadiness();
  const credentialIssuers = await checkCredentialIssuerReadiness();
  const tenantEngines = await checkTenantEngineReadiness();
  const workflowEngines = await checkWorkflowEngineReadiness();
  const userSearchPlugins = await checkUserSearchReadiness();
  const tempStorage = await reportReadiness(async () => ({
    ok: await getTempStorageAdapter().ping(),
  }));
  const virusScanner = await reportReadiness(async () => ({
    ok: await getVirusScanAdapter().ping(),
  }));
  const cache = await reportReadiness(() => getCacheAdapter().readinessCheck?.());
  const messageBus = await reportReadiness(() => getMessageBusAdapter().readinessCheck?.());
  const eventStream = await reportReadiness(() => getEventStreamAdapter().readinessCheck?.());
  // A job backlog or dead jobs are for operators to see; they never pull the pod.
  const jobs = dbOk
    ? await reportReadiness(async () => ({ ok: true, ...(await jobStats()) }))
    : { ok: false, message: 'Database unreachable' };

  const body = {
    status: dbOk && allEnginesOk ? 'ready' : 'unhealthy',
    db: dbOk ? 'ok' : 'unreachable',
    formEngines,
    storage,
    tempStorage,
    virusScanner,
    documentGeneration,
    tenantEngines,
    credentialIssuers,
    workflowEngines,
    userSearchPlugins,
    cache,
    messageBus,
    eventStream,
    jobs,
  };

  if (!dbOk || !allEnginesOk) {
    res.status(503).json(body);
    return;
  }
  res.status(200).json(body);
}
