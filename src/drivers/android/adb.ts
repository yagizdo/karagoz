import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { KaragozError } from '../../errors.js';

const run = promisify(execFile);

// adb blocks forever when something holds the server port and never answers.
// A cold server start takes ~3.2 s: the server waits up to 3 s for its device scan.
const TIMEOUT_MS = 10_000;

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
  return [...at(process.env.ANDROID_HOME), ...at(process.env.ANDROID_SDK_ROOT), 'adb', ...at(defaultSdk[process.platform])];
}

let resolved: string | undefined;

// Runs adb and returns its stdout. adb's own stderr (e.g. "* daemon started successfully") is passed through.
export async function adb(args: string[]): Promise<string> {
  const tried = resolved ? [resolved] : candidates();
  for (const bin of tried) {
    try {
      const { stdout, stderr } = await run(bin, args, { timeout: TIMEOUT_MS });
      resolved = bin;
      process.stderr.write(stderr);
      return stdout;
    } catch (e) {
      const err = e as { code?: unknown; killed?: boolean; stderr?: string; message: string };
      if (err.code === 'ENOENT') continue;
      resolved = bin;
      if (err.killed) {
        throw new KaragozError(
          'ADB_TIMEOUT',
          `adb did not answer within ${TIMEOUT_MS / 1000}s. Another process may hold the adb server port, or the server is stuck; try \`adb kill-server\`.`,
        );
      }
      throw new KaragozError('ADB_FAILED', err.stderr?.trim() || err.message);
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
