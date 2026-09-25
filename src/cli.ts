#!/usr/bin/env node
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import pkg from '../package.json' with { type: 'json' };
import { listDevices } from './drivers/android/devices.js';
import { key, swipe, tap, text, type Target } from './drivers/android/input.js';
import { screenshot } from './drivers/android/screenshot.js';
import { uiTree } from './drivers/android/ui-tree.js';
import { KaragozError } from './errors.js';

// Every command option takes a value, so a command receives its options as strings. args names the positional
// arguments a command takes, in order; run gets exactly that many, or none when argsOptional is set.
type Command = {
  options: Record<string, { type: 'string' }>;
  args: readonly string[];
  // tap can name its target with --text or --id instead of <x> <y>.
  argsOptional?: true;
  run: (values: Record<string, string | undefined>, args: string[]) => Promise<unknown>;
};

// Screen pixels, decimals allowed: a bounds center can be a half, and input reads floats (K25). A minus sign never gets
// here, parseArgs reads -5 as an option.
function decimal(label: string, value = ''): number {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new KaragozError('INVALID_ARGS', `${label} must be a non-negative number (got '${value}')`);
  }
  return Number(value);
}

// Nine digits at most: input.ts adds the value to adb's TIMEOUT_MS, and an execFile timeout above 2^31-1 ms overflows
// Node's timer, which then fires after 1 ms.
function integer(label: string, value = ''): number {
  if (!/^\d{1,9}$/.test(value)) {
    throw new KaragozError('INVALID_ARGS', `${label} must be a whole number of milliseconds (got '${value}')`);
  }
  return Number(value);
}

const commands: Record<string, Command> = {
  devices: { options: {}, args: [], run: async () => ({ devices: await listDevices() }) },
  screenshot: {
    options: { device: { type: 'string' }, out: { type: 'string' } },
    args: [],
    run: ({ device, out }) => screenshot(device, out),
  },
  'ui-tree': { options: { device: { type: 'string' } }, args: [], run: ({ device }) => uiTree(device) },
  key: {
    options: { device: { type: 'string' } },
    args: ['key'],
    run: ({ device }, [value = '']) => key(device, value),
  },
  tap: {
    options: {
      device: { type: 'string' },
      duration: { type: 'string' },
      text: { type: 'string' },
      id: { type: 'string' },
      timeout: { type: 'string' },
    },
    args: ['x', 'y'],
    argsOptional: true,
    run: ({ device, duration, text: label, id: resourceId, timeout }, [x, y]) => {
      if ([x, label, resourceId].filter((form) => form !== undefined).length !== 1) {
        throw new KaragozError('INVALID_ARGS', "'tap' takes <x> <y>, --text or --id");
      }
      const target: Target =
        label !== undefined
          ? { kind: 'text', label }
          : resourceId !== undefined
            ? { kind: 'id', id: resourceId }
            : { kind: 'point', x: decimal('<x>', x), y: decimal('<y>', y) };
      if (target.kind === 'point' && timeout !== undefined) {
        throw new KaragozError('INVALID_ARGS', '--timeout needs --text or --id');
      }
      return tap(
        device,
        target,
        duration === undefined ? undefined : integer('--duration', duration),
        timeout === undefined ? 0 : integer('--timeout', timeout),
      );
    },
  },
  swipe: {
    options: { device: { type: 'string' }, duration: { type: 'string' } },
    args: ['x1', 'y1', 'x2', 'y2'],
    run: ({ device, duration }, [x1, y1, x2, y2]) =>
      swipe(
        device,
        decimal('<x1>', x1),
        decimal('<y1>', y1),
        decimal('<x2>', x2),
        decimal('<y2>', y2),
        duration === undefined ? undefined : integer('--duration', duration),
      ),
  },
  text: {
    options: { device: { type: 'string' } },
    args: ['text'],
    // A text that starts with - goes after --, where parseArgs stops reading options: karagoz text -- -5.
    run: ({ device }, [value]) => {
      if (!value) throw new KaragozError('INVALID_ARGS', "'text' needs <text>");
      return text(device, value);
    },
  },
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
    if (rest.length > command.args.length) {
      throw new KaragozError('INVALID_ARGS', `unexpected argument '${rest[command.args.length]}'`);
    }
    if (rest.length < command.args.length && !(command.argsOptional && !rest.length)) {
      throw new KaragozError('INVALID_ARGS', `'${name}' needs ${command.args.map((arg) => `<${arg}>`).join(' ')}`);
    }
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
    process.stdout.write(`${JSON.stringify(await command.run(given, rest))}\n`);
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
