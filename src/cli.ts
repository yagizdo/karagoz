#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

try {
  const { values } = parseArgs({ options: { version: { type: 'boolean' } } });
  if (!values.version) throw Object.assign(new Error('no command given'), { code: 'NO_COMMAND' });
  // Resolved from dist/cli.js, where the bundle lives.
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  process.stdout.write(`${version}\n`);
} catch (err) {
  const { code = 'INTERNAL', message } = err as Error & { code?: string };
  process.stdout.write(`${JSON.stringify({ error: { code, message } })}\n`);
  process.stderr.write(`karagoz: ${message}\n`);
  process.exitCode = 1;
}
