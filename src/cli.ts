#!/usr/bin/env node
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import pkg from '../package.json' with { type: 'json' };
import { listDevices } from './drivers/android/devices.js';
import { screenshot } from './drivers/android/screenshot.js';
import { uiTree } from './drivers/android/ui-tree.js';
import { KaragozError } from './errors.js';

// Every command option takes a value, so a command receives its options as strings.
type Command = {
  options: Record<string, { type: 'string' }>;
  run: (values: Record<string, string | undefined>) => Promise<unknown>;
};

const commands: Record<string, Command> = {
  devices: { options: {}, run: async () => ({ devices: await listDevices() }) },
  screenshot: {
    options: { device: { type: 'string' }, out: { type: 'string' } },
    run: ({ device, out }) => screenshot(device, out),
  },
  'ui-tree': { options: { device: { type: 'string' } }, run: ({ device }) => uiTree(device) },
};

try {
  // One strict parse over the options of every command, so --version and parseArgs' own errors (a missing value)
  // stay the same for all of them. Which options a command takes is checked after the lookup.
  const options: ParseArgsOptionsConfig = { version: { type: 'boolean' } };
  for (const command of Object.values(commands)) Object.assign(options, command.options);
  const { values, positionals } = parseArgs({ options, allowPositionals: true });
  if (values.version) {
    process.stdout.write(`${pkg.version}\n`);
  } else {
    const [name, ...rest] = positionals;
    if (!name) throw new KaragozError('NO_COMMAND', `no command given. Commands: ${Object.keys(commands).join(', ')}`);
    // hasOwn: a plain object also answers 'constructor', 'toString' and the rest of Object.prototype.
    const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
    if (!command) throw new KaragozError('UNKNOWN_COMMAND', `unknown command '${name}'`);
    if (rest.length) throw new KaragozError('INVALID_ARGS', `unexpected argument '${rest[0]}'`);
    const given: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!Object.hasOwn(command.options, key)) {
        throw new KaragozError('INVALID_ARGS', `'${name}' does not take the option '--${key}'`);
      }
      // parseArgs rejects a missing value but accepts an empty one (--out=).
      if (typeof value !== 'string' || !value) {
        throw new KaragozError('INVALID_ARGS', `option '--${key}' needs a value`);
      }
      given[key] = value;
    }
    process.stdout.write(`${JSON.stringify(await command.run(given))}\n`);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const raw = err instanceof Error && 'code' in err ? err.code : undefined;
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
