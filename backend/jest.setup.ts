import path from 'node:path';
import dotenv from 'dotenv';

// Ensure dotenv does not log "injecting env" and tips when running tests.
process.env.DOTENV_CONFIG_QUIET = 'true';

const backendRoot = __dirname;

// Match app bootstrap: local .env wins when present (devcontainer), then fill gaps for CI.
dotenv.config({ path: path.join(backendRoot, '.env'), quiet: true });
dotenv.config({ path: path.join(backendRoot, '.env.local'), override: true, quiet: true });

// Always override after dotenv: supertest error-handler tests intentionally trigger 500s.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';

function setDefaultEnv(key: string, value: string): void {
  if (process.env[key] === undefined || process.env[key] === '') {
    process.env[key] = value;
  }
}

// Unit tests mock repos; no live DB connection is required at import time.
// Ensure no tests depend on active/running infrastructure (e.g. database, Redis, etc.).
setDefaultEnv('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/soba_test');
setDefaultEnv('IDP_PLUGIN_DEFAULT_SSO_JWKS_URI', 'https://example.test/jwks');
setDefaultEnv('IDP_PLUGIN_DEFAULT_SSO_JWT_ISSUER', 'https://example.test/realms/test');
setDefaultEnv('IDP_PLUGIN_DEFAULT_SSO_JWT_AUDIENCE', 'test-client');
