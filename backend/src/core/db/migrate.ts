// Must be first: initializes .env + .env.local for this process.
import { env } from '../config/env';
env.loadEnv();

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { db, pool } from './client';

const quoteIdentifier = (identifier: string) => `"${identifier.replace(/"/g, '""')}"`;

// Pipeline performance fix: Revert if needed.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetry = <T>(label: string, task: () => Promise<T>): Promise<T> => {
  const attempts = env.getDbMigrationReadyAttempts();
  const sleepMs = env.getDbMigrationReadySleepMs();

  const tryAttempt = async (attempt: number): Promise<T> => {
    try {
      return await task();
    } catch (error) {
      console.error(`${label} failed on attempt ${attempt}/${attempts}`, error);
      if (attempt >= attempts) throw error;
      await sleep(sleepMs);
      return tryAttempt(attempt + 1);
    }
  };
  return tryAttempt(1);
};

// Role defaults reach new sessions only, so this runs before `pool` connects. Through PgBouncer a
// changed value can take up to server_lifetime to reach every server connection.
const applyRoleTimeouts = async (adminPool: Pool) => {
  await adminPool.query(
    `ALTER ROLE CURRENT_USER SET statement_timeout = ${env.getDbStatementTimeoutMs()}`,
  );
  await adminPool.query(`ALTER ROLE CURRENT_USER SET lock_timeout = ${env.getDbLockTimeoutMs()}`);
};

const setUpDatabase = async () => {
  const databaseUrl = env.getDatabaseUrl();

  const targetUrl = new URL(databaseUrl);
  const targetDbName = targetUrl.pathname.replace(/^\//, '');
  if (!targetDbName) {
    throw new Error('DATABASE_URL must include a database name');
  }

  const adminDbName = env.getDbAdminDatabase() ?? 'postgres';
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = `/${adminDbName}`;

  const adminPool = new Pool({
    connectionString: adminUrl.toString(),
    max: 1,
    connectionTimeoutMillis: env.getDbConnectionTimeoutMs(),
    query_timeout: env.getDbQueryTimeoutMs(),
  });

  try {
    await applyRoleTimeouts(adminPool);
    const exists = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      targetDbName,
    ]);
    if (exists.rowCount && exists.rowCount > 0) {
      return;
    }

    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(targetDbName)}`);
    console.log(`Created database: ${targetDbName}`);
  } finally {
    await adminPool.end();
  }
};

const run = async () => {
  await withRetry('Database setup', setUpDatabase);
  await withRetry('Database readiness check', async () => {
    await pool.query('SELECT 1');
  });
  await migrate(db, { migrationsFolder: 'drizzle' });
  const runtimeRole = process.env.DB_RUNTIME_ROLE?.trim();
  if (runtimeRole) {
    const role = quoteIdentifier(runtimeRole);
    const database = quoteIdentifier(new URL(env.getDatabaseUrl()).pathname.replace(/^\//, ''));
    await pool.query(`GRANT USAGE ON SCHEMA soba TO ${role}`);
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA soba TO ${role}`,
    );
    await pool.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA soba TO ${role}`);
    await pool.query(
      `ALTER ROLE ${role} IN DATABASE ${database} SET statement_timeout = ${env.getDbStatementTimeoutMs()}`,
    );
    await pool.query(
      `ALTER ROLE ${role} IN DATABASE ${database} SET lock_timeout = ${env.getDbLockTimeoutMs()}`,
    );
  }
  console.log('Migrations complete.');
  await pool.end();
};
// Pipeline performance fix: Revert if needed.

run().catch(async (error) => {
  console.error('Migration failed', error);
  await pool.end();
  process.exit(1);
});
