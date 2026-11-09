import { env } from './core/config/env';
env.loadEnv();

import express from 'express';
import rTracer from 'cls-rtracer';
import cors from 'cors';
import passport from 'passport';
import { checkJwt } from './core/middleware/auth';
import { designRouter, submitRouter, filesApiRouter, coreRouter } from './core/api';
import {
  healthRouter,
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
} from './core/api/health';
import { metaRouter } from './core/api/meta';
import { buildOpenApiSpec } from './core/api/shared/openapi';
import swaggerUi from 'swagger-ui-express';
import { httpLogger, log } from './core/logging';
import { resolveActor, resolveActorOrPublic } from './core/middleware/actor';
import { requireFeature } from './core/middleware/requireFeature';
import { requireSobaAdmin } from './core/middleware/requireSobaAdmin';
import { coreErrorHandler, notFoundHandler } from './core/middleware/errorHandler';
import { adminRouter } from './core/api/admin';
import { globalRateLimit, apiRateLimit, publicRateLimit } from './core/middleware/rateLimit';
import { initializePassport } from './core/auth/passport';
import { Features } from './core/db/codes';
import { pool } from './core/db/client';
import { assertJobShutdownFits, getJobSettings, startJobs, stopJobs } from './core/jobs';
import { setTimeout as delay } from 'node:timers/promises';

const app = express();
app.disable('x-powered-by');
const port = Number(process.env.PORT) || 4000;
// Read before listening, so an invalid value stops startup before the port opens.
const shutdownSettings = env.getShutdownSettings();
assertJobShutdownFits(getJobSettings(), shutdownSettings.timeoutMs);

// The app serves the base path itself, so Routes and probes address the same URLs the browser uses.
const apiBasePath = env.getApiBasePath();
const apiPath = (path: string) => `${apiBasePath}${path}`;

// Trust X-Forwarded-* from a bounded number of proxies (not `true` — breaks express-rate-limit IP keys)
app.set('trust proxy', env.getTrustProxySetting());

initializePassport();

// Downloads read their file name from Content-Disposition.
const corsExposedHeaders = ['Content-Disposition'];
// CORS is always restricted to an explicit allowlist of trusted origins (never `*`).
// Production origins come from CORS_ORIGIN; in development we fall back to CORS_DEV_ORIGIN
// (configurable per developer via .env) when CORS_ORIGIN is unset.
const configuredOrigins = env.getCorsOrigins() ?? [];
let allowedOrigins = configuredOrigins;
if (allowedOrigins.length === 0 && env.isDevelopment()) {
  allowedOrigins = env.getCorsDevOrigins() ?? [];
}

if (allowedOrigins.length > 0) {
  log.info({ origins: allowedOrigins }, 'Allowing CORS for configured origins');
  app.use(
    cors({
      origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
      credentials: true,
      exposedHeaders: corsExposedHeaders,
    }),
  );
} else {
  log.info('No CORS origins configured; cross-origin requests will be blocked');
}

app.use(
  rTracer.expressMiddleware({
    useHeader: true,
    headerName: 'X-Request-Id',
    echoHeader: true,
  }),
);

app.use(httpLogger);
app.use(passport.initialize());

app.use(globalRateLimit);

// ——— Public routes (no authentication) ———
app.get(apiPath('/api/docs/openapi.json'), publicRateLimit, (_req, res) => {
  res.json(buildOpenApiSpec());
});
app.use(
  apiPath('/api/docs'),
  publicRateLimit,
  swaggerUi.serve,
  swaggerUi.setup(null, {
    swaggerOptions: {
      url: apiPath('/api/docs/openapi.json'),
    },
  }),
);

// ——— v1 API ———
// Each surface has its own base path, so its middleware only runs for its own routes (no fall-through,
// no double rate-limit) and its auth stack is uniform.
app.use(apiPath('/api/v1/meta'), publicRateLimit, express.json(), metaRouter);
app.use(apiPath('/api/v1/health'), publicRateLimit, healthRouter);

// Body limit for the body-carrying surfaces (see env.getJsonBodyLimit). meta stays at express's
// default: it is public and body-less.
const jsonBodyLimit = env.getJsonBodyLimit();

// Submit feature (public-capable): anonymous resolves to the public user; each submit route authorizes
// itself. 404s when submit-mode is disabled.
app.use(
  apiPath('/api/v1/submit'),
  apiRateLimit,
  express.json({ limit: jsonBodyLimit }),
  checkJwt({ allowPublic: true }),
  resolveActorOrPublic,
  requireFeature(Features.submit_mode),
  submitRouter,
);

// Files feature (public-capable): submission attachments, same auth as submit. Multipart and
// body-less only, so no JSON parser. 404s when submit-mode is disabled.
app.use(
  apiPath('/api/v1/files'),
  apiRateLimit,
  checkJwt({ allowPublic: true }),
  resolveActorOrPublic,
  requireFeature(Features.submit_mode),
  filesApiRouter,
);

// Design feature (staff): mandatory auth. 404s when design-mode is disabled.
app.use(
  apiPath('/api/v1/design'),
  apiRateLimit,
  express.json({ limit: jsonBodyLimit }),
  checkJwt(),
  resolveActor,
  requireFeature(Features.design_mode),
  designRouter,
);

// Admin: platform administration.
app.use(
  apiPath('/api/v1/admin'),
  apiRateLimit,
  express.json({ limit: jsonBodyLimit }),
  checkJwt(),
  resolveActor,
  requireSobaAdmin,
  adminRouter,
);

// Core: workspace/account management and staff document templates (mandatory auth). Mounted last
// so the more specific paths win.
app.use(
  apiPath('/api/v1'),
  apiRateLimit,
  express.json({ limit: jsonBodyLimit }),
  checkJwt(),
  resolveActor,
  coreRouter,
);

// Paths outside every surface, and errors raised by the surface middleware above (auth, feature
// gates, body parsing), which run before a surface router's own error handler.
app.use(notFoundHandler);
app.use(coreErrorHandler);

const server = app.listen(port, () => {
  log.info({ port }, 'Express is listening');
  startJobs();
  void logStartupHealth()
    .then(logTempStorageSelfTest)
    .then(logVirusScanSelfTest)
    .then(logCacheSelfTest)
    .then(logMessageBusSelfTest)
    .then(logEventStreamSelfTest)
    .then(logDocumentGenerationReadiness)
    .then(logTenantEngineReadiness)
    .then(logCredentialIssuerReadiness)
    .then(logWorkflowEngineReadiness)
    .then(logNotificationReadiness)
    .then(logUserSearchReadiness)
    .catch((err) => log.warn({ err }, 'Startup diagnostics failed'));
});

let shuttingDown = false;

/**
 * Node is PID 1 in the pod, so SIGTERM is ignored unless handled. On SIGTERM, keep serving for the
 * shutdown delay while routing moves off the pod, and drain jobs alongside; then stop serving, close
 * the pool and exit. SIGINT skips the delay. A second signal, or the shutdown timeout, exits at once.
 */
const shutdown = (signal: NodeJS.Signals): void => {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  log.info({ signal }, 'Shutting down');
  setTimeout(() => {
    log.error({ timeoutMs: shutdownSettings.timeoutMs }, 'Shutdown timed out');
    process.exit(1);
  }, shutdownSettings.timeoutMs).unref();
  const serveMs = signal === 'SIGTERM' ? shutdownSettings.delayMs : 0;
  Promise.all([stopJobs(), delay(serveMs)])
    .then(() => new Promise<void>((resolve) => server.close(() => resolve())))
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      log.error({ err }, 'Shutdown failed');
      process.exit(1);
    });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
