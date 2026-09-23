#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { listDevices } from './drivers/android/devices.js';
import { KaragozError } from './errors.js';

const commands: Record<string, () => Promise<unknown>> = {
  devices: async () => ({ devices: await listDevices() }),
};

try {
  const { values, positionals } = parseArgs({ options: { version: { type: 'boolean' } }, allowPositionals: true });
  if (values.version) {
    // Resolved from dist/cli.js, where the bundle lives.
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(`${version}\n`);
  } else {
    const [name, ...rest] = positionals;
    if (!name) throw new KaragozError('NO_COMMAND', `no command given. Commands: ${Object.keys(commands).join(', ')}`);
    // hasOwn: a plain object also answers 'constructor', 'toString' and the rest of Object.prototype.
    const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
    if (!command) throw new KaragozError('UNKNOWN_COMMAND', `unknown command '${name}'`);
    if (rest.length) throw new KaragozError('INVALID_ARGS', `unexpected argument '${rest[0]}'`);
    process.stdout.write(`${JSON.stringify(await command())}\n`);
  }
} catch (err) {
  const { message, code: raw } = err as Error & { code?: unknown };
  const code =
    err instanceof KaragozError
      ? err.code
      : typeof raw === 'string' && raw.startsWith('ERR_PARSE_ARGS')
        ? 'INVALID_ARGS'
        : 'INTERNAL';
  process.stdout.write(`${JSON.stringify({ error: { code, message } })}\n`);
  process.stderr.write(`karagoz: ${message}\n`);
  process.exitCode = 1;
}
