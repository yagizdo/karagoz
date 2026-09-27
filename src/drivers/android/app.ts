import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { KaragozError } from '../../errors.js';
import { adb, TIMEOUT_MS } from './adb.js';
import { resolveTarget } from './devices.js';

// am start -W has no bound of its own; Android gives up after 10 s for a process to attach and 10 s idle after
// resume (K28).
const LAUNCH_TIMEOUT_MS = 30_000;

// Android's package-name alphabet. The value reaches a device shell (K28).
export function checkPackage(value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/.test(value)) {
    throw new KaragozError('INVALID_ARGS', `'${value}' is not a package name`);
  }
}

// Device commands go through exec-out, which quotes every argument itself and exits 0 whatever the command did, so
// their output is the result, as screencap's bytes are (K22, K28). Never pre-quote: the quotes would arrive.
// pm path is the one clean signal: force-stop is silent for a package that is not installed (K28).
async function checkInstalled(id: string, pkg: string): Promise<void> {
  const out = (await adb(['-s', id, 'exec-out', 'pm', 'path', pkg])).trim();
  if (!out) throw new KaragozError('APP_NOT_FOUND', `package '${pkg}' is not installed on ${id}`);
  if (!out.startsWith('package:')) throw new KaragozError('ADB_FAILED', out);
}

// The first MAIN activity with this category, as pkg/cls, or undefined when there is none.
async function firstActivity(id: string, pkg: string, category: string): Promise<string | undefined> {
  const query = ['query-activities', '--components', '-a', 'android.intent.action.MAIN', '-c', category, pkg];
  const out = (await adb(['-s', id, 'exec-out', 'cmd', 'package', ...query])).trim();
  if (out === 'No activities found') return undefined;
  const lines = out.split('\n').map((line) => line.trim());
  if (!out || !lines.every((line) => /^\S+\/\S+$/.test(line))) {
    throw new KaragozError('ADB_FAILED', out || 'cmd package query-activities printed nothing');
  }
  return lines[0];
}

export async function install(device: string | undefined, apk: string) {
  const path = resolve(apk);
  if (!path.toLowerCase().endsWith('.apk')) throw new KaragozError('INVALID_ARGS', `'${path}' is not an .apk file`);
  // Missing, a path through a file, no permission: the caller fixes each the same way, so the cause is dropped.
  const info = await stat(path).catch(() => undefined);
  if (!info) throw new KaragozError('INVALID_ARGS', `no file at '${path}'`);
  if (!info.isFile()) throw new KaragozError('INVALID_ARGS', `'${path}' is not a file`);
  const id = await resolveTarget(device);
  try {
    // --no-incremental: next to an .idsig adb installs incrementally through an `adb inc-server` that keeps stderr
    // open, and the call does not return until it exits. -r is implied since Android 9, kept for older devices (K28).
    // One more second per started MB, as input.ts adds a gesture's duration (K19 note, K28).
    await adb(
      ['-s', id, 'install', '-r', '--no-incremental', path],
      TIMEOUT_MS + Math.ceil(info.size / 1_000_000) * 1000,
    );
  } catch (err) {
    if (!(err instanceof KaragozError) || err.code !== 'ADB_FAILED') throw err;
    const reason = /Failure \[([A-Z0-9_]+)/.exec(err.message)?.[1];
    if (!reason) throw err;
    throw new KaragozError('INSTALL_FAILED', err.message, reason);
  }
  return { device: id, path };
}

export async function launch(device: string | undefined, pkg: string) {
  checkPackage(pkg);
  const id = await resolveTarget(device);
  // getLaunchIntentForPackage's rule: MAIN+INFO first, then MAIN+LAUNCHER, the first result (K28).
  for (const category of ['android.intent.category.INFO', 'android.intent.category.LAUNCHER']) {
    const component = await firstActivity(id, pkg, category);
    if (!component) continue;
    // 0x10200000 = NEW_TASK | RESET_TASK_IF_NEEDED, what a launcher sends: a running task comes to the front as it is.
    const intent = ['-a', 'android.intent.action.MAIN', '-c', category, '-f', '0x10200000', '-n', component];
    const out = await adb(['-s', id, 'exec-out', 'am', 'start', '-W', ...intent], LAUNCH_TIMEOUT_MS);
    const lines = out.split('\n').map((line) => line.trim());
    if (!lines.some((line) => line.startsWith('Status:'))) {
      // With -W, am writes its errors to stdout.
      const error = lines.find((line) => line.startsWith('Error:')) ?? (out.trim() || 'am start printed nothing');
      throw new KaragozError('ADB_FAILED', error);
    }
    const activity = lines.find((line) => line.startsWith('Activity: '))?.slice('Activity: '.length) ?? null;
    return { device: id, package: pkg, activity };
  }
  await checkInstalled(id, pkg);
  throw new KaragozError('APP_NOT_LAUNCHABLE', `package '${pkg}' has no launcher activity`);
}

export async function terminate(device: string | undefined, pkg: string) {
  checkPackage(pkg);
  const id = await resolveTarget(device);
  await checkInstalled(id, pkg);
  const out = (await adb(['-s', id, 'exec-out', 'am', 'force-stop', pkg])).trim();
  if (out) throw new KaragozError('ADB_FAILED', out);
  return { device: id, package: pkg };
}

export async function uninstall(device: string | undefined, pkg: string) {
  checkPackage(pkg);
  const id = await resolveTarget(device);
  await checkInstalled(id, pkg);
  // What adb uninstall runs. A missing package would say DELETE_FAILED_INTERNAL_ERROR, as a protected one does (K28).
  const out = (await adb(['-s', id, 'exec-out', 'cmd', 'package', 'uninstall', pkg])).trim();
  if (out === 'Success') return { device: id, package: pkg };
  const reason = /Failure \[([A-Z0-9_]+)/.exec(out)?.[1];
  if (reason) throw new KaragozError('UNINSTALL_FAILED', out, reason);
  throw new KaragozError('ADB_FAILED', out || 'cmd package uninstall printed nothing');
}
