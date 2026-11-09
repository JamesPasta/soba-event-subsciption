#!/usr/bin/env node

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const help = `Render the SOBA gateway configuration for gwa publish-gateway without publishing it.

Usage:
  node deployments/gateway/scripts/generate-gateway-config.mjs [--output FILE]

Required environment variables:
  GATEWAY_ID             Gateway ID, e.g. gw-e1890
  GATEWAY_QUALIFIER      Qualifier passed to gwa publish-gateway, e.g. proxy-proof-soba-pr-173
  GATEWAY_SERVICE_NAME   Gateway service and route name
  GATEWAY_HOSTNAME       Route hostname, without scheme or path
  GATEWAY_ROUTE_PATH     Route path prefix, ending in /
  BACKEND_HOST           Backend Service DNS name, without scheme, port, or path

Writes YAML to stdout unless --output is supplied. Uses only Node.js built-ins.
`;

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function hostname(name, value) {
  required(name, value);
  if (
    value.length > 253 ||
    !value.split('.').every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) {
    throw new Error(`${name} must be a DNS hostname without scheme, port, or path`);
  }
  return value;
}

async function main() {
  const { values } = parseArgs({
    options: {
      output: { type: 'string', short: 'o' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(help);
    return;
  }

  const env = process.env;
  const qualifier = required('GATEWAY_QUALIFIER', env.GATEWAY_QUALIFIER);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(qualifier)) {
    throw new Error('GATEWAY_QUALIFIER must contain lowercase letters, digits, or hyphens');
  }
  const gateway = required('GATEWAY_ID', env.GATEWAY_ID);
  if (!/^gw-[a-z0-9-]+$/.test(gateway)) {
    throw new Error('GATEWAY_ID must start with gw- and contain lowercase letters, digits, or hyphens');
  }
  const service = required('GATEWAY_SERVICE_NAME', env.GATEWAY_SERVICE_NAME);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(service)) {
    throw new Error('GATEWAY_SERVICE_NAME must contain lowercase letters, digits, underscores, or hyphens');
  }

  const substitutions = {
    GATEWAY_SERVICE_NAME: service,
    CONFIG_TAG: `ns.${gateway}.${qualifier}`,
    BACKEND_HOST: hostname('BACKEND_HOST', env.BACKEND_HOST),
    GATEWAY_HOSTNAME: hostname('GATEWAY_HOSTNAME', env.GATEWAY_HOSTNAME),
    GATEWAY_ROUTE_PATH: required('GATEWAY_ROUTE_PATH', env.GATEWAY_ROUTE_PATH),
    GATEWAY_STRIP_PATH: env.GATEWAY_ROUTE_PATH !== '/',
  };
  const template = await readFile(new URL('../service.template.yaml', import.meta.url), 'utf8');
  const rendered = template.replace(/\$\{([^}]+)\}/g, (_, name) => {
    if (!Object.hasOwn(substitutions, name)) {
      throw new Error(`Unknown template variable: ${name}`);
    }
    // JSON string quoting is valid YAML and prevents values changing its structure.
    return JSON.stringify(substitutions[name]);
  });
  if (rendered.includes('${')) throw new Error('Unresolved template placeholder');

  if (values.output !== undefined) {
    if (!values.output.trim()) throw new Error('--output must be a nonempty file path');
    const output = resolve(values.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, rendered);
    process.stderr.write(`Generated ${output}\n`);
  } else {
    process.stdout.write(rendered);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
