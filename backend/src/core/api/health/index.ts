import express from 'express';
import { readinessHandler } from './readyHandler';
import { coreErrorHandler, notFoundHandler } from '../../middleware/errorHandler';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

router.get('/ready', readinessHandler);
router.use(notFoundHandler);
router.use(coreErrorHandler);

export const healthRouter = router;
export { registerHealthOpenApi } from './schema';
export {
  logStartupHealth,
  logTempStorageSelfTest,
  logVirusScanSelfTest,
  logCacheSelfTest,
  logMessageBusSelfTest,
  logEventStreamSelfTest,
  logDocumentGenerationReadiness,
  logTenantEngineReadiness,
  logCredentialIssuerReadiness,
  logWorkflowEngineReadiness,
  logNotificationReadiness,
  logUserSearchReadiness,
} from './startupHealth';
