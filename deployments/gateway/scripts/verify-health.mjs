#!/usr/bin/env node
// No credentials: exercise the independent public gateway route.
const host = process.env.GATEWAY_HOSTNAME;
if (!host || host.length > 253 || !host.split('.').every((label) =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
  throw new Error('GATEWAY_HOSTNAME must be a DNS hostname without scheme, port, or path');
}
const url = `https://${host}${process.env.GATEWAY_ROUTE_PATH || '/'}health`;
try {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.status !== 'OK' || typeof body.timestamp !== 'string' ||
      !Number.isFinite(Date.parse(body.timestamp))) {
    throw new Error('Response does not match the CHEFS2 health response');
  }
  console.log(`PASS ${url} CHEFS2 status=OK, timestamp=${body.timestamp}`);
} catch (error) {
  console.error(`FAIL ${url}: ${error.message}`);
  process.exitCode = 1;
}
