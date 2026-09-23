import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { KaragozError } from '../../errors.js';
import { adbBytes } from './adb.js';
import { resolveTarget } from './devices.js';

// PNG layout (https://www.w3.org/TR/png/): the 8-byte signature, then the IHDR chunk header (length 13, type IHDR)
// with width and height as big-endian uint32 at bytes 16 and 20, and the 12-byte IEND chunk last.
const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const IHDR = Buffer.from('0000000d49484452', 'hex');
const IEND = Buffer.from('0000000049454e44ae426082', 'hex');

export async function screenshot(device: string | undefined, out: string | undefined) {
  const id = await resolveTarget(device);
  const png = await adbBytes(['-s', id, 'exec-out', 'screencap', '-p']);
  // exec-out exits 0 when screencap fails and merges its stderr into stdout (adb source), so the bytes are the
  // only failure signal: a whole PNG or screencap's own text.
  // ponytail: with several displays screencap prints its warning lines ahead of the PNG, and this check fails on
  // purpose, since which display it picks "is not guaranteed to be consistent across captures". The limit lifts
  // when a multi-display device comes into scope and -d is added.
  const whole =
    png.subarray(0, 8).equals(SIGNATURE) && png.subarray(8, 16).equals(IHDR) && png.subarray(-12).equals(IEND);
  if (!whole) {
    throw new KaragozError('CAPTURE_FAILED', png.toString('utf8').trim().slice(0, 300) || 'screencap returned no data');
  }
  // ':' is invalid in Windows file names, and `adb connect` serials contain it (127.0.0.1:5555).
  const safeId = id.replace(/[^A-Za-z0-9._-]/g, '_');
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const path = out === undefined ? join(tmpdir(), 'karagoz', `${safeId}-${stamp}.png`) : resolve(out);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, png);
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    throw new KaragozError('WRITE_FAILED', err.message);
  }
  return { path, device: id, pixels: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } };
}
