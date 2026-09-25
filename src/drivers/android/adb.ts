import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { KaragozError } from '../../errors.js';

const run = promisify(execFile);

// adb blocks forever when something holds the server port and never answers.
// A cold server start takes ~3.2 s: the server waits up to 3 s for its device scan.
// The default for every call: the dump passes a longer one, and input.ts adds a gesture's duration (K19 note).
export const TIMEOUT_MS = 10_000;

// Above the 33 MB of uncompressed RGBA for a 3840x2160 display. Node's 1 MB default failed a 1.37 MB
// screenshot PNG with ERR_CHILD_PROCESS_STDIO_MAXBUFFER (measured).
const MAX_BUFFER = 64 * 1024 * 1024;

const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';

const INSTALL: Record<string, string> = {
  darwin: 'brew install --cask android-platform-tools',
  win32: 'winget install Google.PlatformTools',
};

// Explicit SDK config first, then PATH, then Android Studio's default SDK location.
function candidates(): string[] {
  const at = (sdk: string | undefined) => (sdk ? [join(sdk, 'platform-tools', exe)] : []);
  const local = process.env.LOCALAPPDATA;
  const defaultSdk: Record<string, string | undefined> = {
    darwin: join(homedir(), 'Library', 'Android', 'sdk'),
    linux: join(homedir(), 'Android', 'Sdk'),
    win32: local && join(local, 'Android', 'Sdk'),
  };
  return [
    ...at(process.env.ANDROID_HOME),
    ...at(process.env.ANDROID_SDK_ROOT),
    'adb',
    ...at(defaultSdk[process.platform]),
  ];
}

// The 'adb' candidate. On Windows libuv looks a bare name up in the current directory before PATH,
// so an adb.exe in the directory karagoz runs from would win. PATH is walked here instead, absolute
// entries only: libuv resolves relative ones against the current directory too.
function onPath(): string | undefined {
  if (process.platform !== 'win32') return 'adb';
  return (process.env.PATH ?? '')
    .split(delimiter)
    .map((dir) => dir.replaceAll('"', ''))
    .filter((dir) => isAbsolute(dir))
    .map((dir) => join(dir, exe))
    .find((bin) => existsSync(bin));
}

let resolved: string | undefined;

// Runs adb and returns its stdout. adb's own stderr (e.g. "* daemon started successfully") is passed through.
// The bytes form exists because a screenshot PNG must not pass through a text decode; adb() below decodes the
// same result, so both share this one candidate loop, timeout and error mapping.
export async function adbBytes(args: string[], timeout = TIMEOUT_MS): Promise<Buffer> {
  const tried = resolved ? [resolved] : candidates();
  for (const candidate of tried) {
    const bin = candidate === 'adb' ? onPath() : candidate;
    if (!bin) continue;
    try {
      const { stdout, stderr } = await run(bin, args, {
        timeout,
        encoding: 'buffer',
        maxBuffer: MAX_BUFFER,
      });
      resolved = bin;
      process.stderr.write(stderr);
      return stdout;
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      if ('code' in err && err.code === 'ENOENT') continue;
      resolved = bin;
      if ('killed' in err && err.killed) {
        throw new KaragozError(
          'ADB_TIMEOUT',
          `adb did not answer within ${timeout / 1000}s. Another process may hold the adb server port, or the server is stuck; try \`adb kill-server\`.`,
        );
      }
      const stderr = 'stderr' in err && Buffer.isBuffer(err.stderr) ? err.stderr.toString('utf8').trim() : '';
      throw new KaragozError('ADB_FAILED', stderr || err.message);
    }
  }
  const where = tried.map((bin) => (bin === 'adb' ? 'PATH' : bin)).join(', ');
  // Printed, never run: the package manager may not be there, so the official download is always offered too.
  const download = 'download https://developer.android.com/tools/releases/platform-tools and add it to PATH';
  const manager = INSTALL[process.platform];
  const install = manager ? `${manager}, or ${download}` : download;
  throw new KaragozError(
    'ADB_NOT_FOUND',
    `adb not found (tried ${where}). Install platform-tools (${install}) or set ANDROID_HOME to your Android SDK.`,
  );
}

export async function adb(args: string[], timeout = TIMEOUT_MS): Promise<string> {
  return (await adbBytes(args, timeout)).toString('utf8');
}
