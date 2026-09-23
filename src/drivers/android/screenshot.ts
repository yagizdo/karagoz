import { lstat, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { KaragozError } from '../../errors.js';
import { adb, adbBytes } from './adb.js';
import { resolveTarget } from './devices.js';

// PNG layout (https://www.w3.org/TR/png/): the 8-byte signature, then the IHDR chunk header (length 13, type IHDR)
// with width and height as big-endian uint32 at bytes 16 and 20, and the 12-byte IEND chunk last.
const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const IHDR = Buffer.from('0000000d49484452', 'hex');
const IEND = Buffer.from('0000000049454e44ae426082', 'hex');

// The Android counterpart of iOS safeAreaInsets: systemBars() | displayCutout() (K23). The IME and the gesture
// areas are left out, as iOS leaves out the keyboard.
const SAFE_AREA_TYPES = new Set(['statusBars', 'navigationBars', 'captionBar', 'displayCutout']);

const DUMP = "'dumpsys window displays'";

// Four numbers from consecutive capture groups, starting at group `at`.
function rect(match: RegExpMatchArray, at: number) {
  return { l: Number(match[at]), t: Number(match[at + 1]), r: Number(match[at + 2]), b: Number(match[at + 3]) };
}

function unreadable(value: string, command: string, missing: string) {
  return new KaragozError('CAPTURE_FAILED', `cannot read ${value} from ${command} (no ${missing})`);
}

// The override density is what apps lay out with (measured: a 24 dp status bar at both 420 and 560 dpi).
function parseDensity(text: string): number {
  const physical = /Physical density: (\d+)/.exec(text);
  if (!physical) throw unreadable('density', "'wm density'", 'Physical density: line');
  return Number((/Override density: (\d+)/.exec(text) ?? physical)[1]);
}

// Display 0 of `dumpsys window displays`, text format verified on API 36 only (K23). No `$` anchors: `shell`
// writes text mode on Windows, so lines may end in \r.
function parseDisplay(text: string) {
  const start = /Display: mDisplayId=0(?!\d)/.exec(text);
  if (!start) throw unreadable('display 0', DUMP, 'Display: mDisplayId=0 section');
  const after = text.slice(start.index + start[0].length);
  const next = after.indexOf('Display: mDisplayId=');
  const section = next === -1 ? after : after.slice(0, next);

  const cur = /\bcur=(\d+)x(\d+)/.exec(section);
  if (!cur) throw unreadable('display size', DUMP, 'cur= value');
  const rotation = /^\s*mRotation=([0-3])\b/m.exec(section);
  if (!rotation) throw unreadable('rotation', DUMP, 'mRotation= line');
  const controller = section.indexOf('WindowInsetsStateController');
  if (controller === -1) throw unreadable('safe area', DUMP, 'WindowInsetsStateController section');
  const insets = section.slice(controller);
  const frameLine = /mDisplayFrame=Rect\((-?\d+), (-?\d+) - (-?\d+), (-?\d+)\)/.exec(insets);
  if (!frameLine) throw unreadable('safe area', DUMP, 'mDisplayFrame= line');
  const frame = rect(frameLine, 1);

  // Only lines that start with `InsetsSource `: the same sources come again as `mSource=InsetsSource` under
  // InsetsSourceProviders and as `InsetsSourceControl:` under the control map (measured).
  const sources = [
    ...insets.matchAll(
      /^\s*InsetsSource \S+ type=(\w+) frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\] visible=(true|false)/gm,
    ),
  ];
  if (!sources.length) throw unreadable('safe area', DUMP, 'InsetsSource line');

  // Each source's edge comes from its geometry against the display frame, not from sideHint (K23).
  const safeArea = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const source of sources) {
    const { l, t, r, b } = rect(source, 2);
    if (!SAFE_AREA_TYPES.has(source[1] ?? '') || source[6] !== 'true' || r <= l || b <= t) continue;
    const fullWidth = l === frame.l && r === frame.r;
    const fullHeight = t === frame.t && b === frame.b;
    if (fullWidth && t === frame.t) safeArea.top = Math.max(safeArea.top, b - frame.t);
    else if (fullWidth && b === frame.b) safeArea.bottom = Math.max(safeArea.bottom, frame.b - t);
    else if (fullHeight && l === frame.l) safeArea.left = Math.max(safeArea.left, r - frame.l);
    else if (fullHeight && r === frame.r) safeArea.right = Math.max(safeArea.right, frame.r - l);
  }
  return { width: Number(cur[1]), height: Number(cur[2]), rotation: Number(rotation[1]) * 90, safeArea };
}

export async function screenshot(device: string | undefined, out: string | undefined) {
  const id = await resolveTarget(device);
  // The metadata calls take ~65 ms each against a ~700 ms capture (measured), so in parallel they add nothing.
  const [png, density, dump] = await Promise.all([
    adbBytes(['-s', id, 'exec-out', 'screencap', '-p']),
    adb(['-s', id, 'shell', 'wm', 'density']),
    adb(['-s', id, 'shell', 'dumpsys', 'window', 'displays']),
  ]);
  // exec-out exits 0 when screencap fails and merges its stderr into stdout (adb source), so the bytes are the
  // only failure signal: a whole PNG or screencap's own text.
  // ponytail: with several displays screencap prints its warning lines ahead of the PNG, and this check fails on
  // purpose, since which display it picks "is not guaranteed to be consistent across captures"; the metadata is
  // read from display 0 as well. The limit lifts when a multi-display device comes into scope and -d is added.
  const whole =
    png.subarray(0, 8).equals(SIGNATURE) && png.subarray(8, 16).equals(IHDR) && png.subarray(-12).equals(IEND);
  if (!whole) {
    throw new KaragozError('CAPTURE_FAILED', png.toString('utf8').trim().slice(0, 300) || 'screencap returned no data');
  }
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const scale = parseDensity(density) / 160;
  const display = parseDisplay(dump);
  // The metadata and the capture run at the same time: a rotation between them would pair a landscape PNG with
  // portrait insets.
  if (display.width !== width || display.height !== height) {
    throw new KaragozError(
      'CAPTURE_FAILED',
      `display is ${display.width}x${display.height} but the screenshot is ${width}x${height}; the screen rotated or resized during capture`,
    );
  }
  // ':' is invalid in Windows file names, and `adb connect` serials contain it (127.0.0.1:5555).
  const safeId = id.replace(/[^A-Za-z0-9._-]/g, '_');
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const path = out === undefined ? join(tmpdir(), 'karagoz', `${safeId}-${stamp}.png`) : resolve(out);
  try {
    const dir = dirname(path);
    if (out === undefined) {
      // On Linux tmpdir() is the shared /tmp: another user could create karagoz/ first, or plant a symlink at the
      // predictable file name. The directory must be the caller's own, and the write refuses anything already at
      // the path. --out is left alone, the caller picked it.
      // ponytail: two captures of one device in the same millisecond collide, and the second gets WRITE_FAILED.
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const info = await lstat(dir);
      if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid())) {
        throw new Error(`${dir} is not a directory owned by the current user; pass --out`);
      }
      await writeFile(path, png, { flag: 'wx', mode: 0o600 });
    } else {
      await mkdir(dir, { recursive: true });
      await writeFile(path, png);
    }
  } catch (err) {
    if (!(err instanceof Error)) throw err;
    throw new KaragozError('WRITE_FAILED', err.message);
  }
  return {
    path,
    device: id,
    pixels: { width, height },
    // Not rounded: derived from pixels and scale, and a rounded copy would disagree with them.
    logical: { width: width / scale, height: height / scale },
    scale,
    safeArea: display.safeArea,
    rotation: display.rotation,
  };
}
