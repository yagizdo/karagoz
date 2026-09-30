import { KaragozError } from '../../errors.js';
import { adb } from './adb.js';

type Entry = { id: string; state: string };
type Described = { kind: 'emulator' | 'physical'; name: string | null };

// ponytail: other serials are checked with getprop, which answers only in state `device`. Genymotion (no verified
// property) and those serials in any other state read as physical.
const isEmulator = (id: string) => /^emulator-\d+$/.test(id);

// One chained call prints one line per property, an empty line when unset, in about the time of a single getprop
// (K18). `getprop a b` would read b as a's default value. Images from before 2021 keep the AVD name under
// ro.kernel.qemu, hence the last one.
const PROPS =
  'getprop ro.product.model; getprop ro.boot.qemu; getprop ro.kernel.qemu; getprop ro.hardware; getprop ro.boot.qemu.avd_name; getprop ro.kernel.qemu.avd_name';

// The AVD name comes from the emulator console, which answers even while the device is still offline.
// Prints "<name>\r\nOK\r\n". Any failure leaves the name unknown rather than failing the listing.
async function avdName(id: string): Promise<string | null> {
  try {
    const first = (await adb(['-s', id, 'emu', 'avd', 'name'])).split('\n')[0]?.trim();
    return first && first !== 'OK' ? first : null;
  } catch {
    return null;
  }
}

// The qemu flags are compared by value: a Samsung phone has ro.kernel.qemu=0 (K18).
async function probe(id: string): Promise<Described | null> {
  let out: string;
  try {
    out = await adb(['-s', id, 'shell', PROPS]);
  } catch {
    // A device that does not answer keeps the serial rule rather than failing the listing, as in avdName().
    return null;
  }
  // Six newline-terminated lines split into seven parts. trim drops the \r of devices without shell protocol v2.
  const lines = out.split('\n').map((line) => line.trim());
  if (lines.length < 7) return null;
  const [model, bootQemu, kernelQemu, hardware, avd, oldAvd] = lines;
  const emulator = bootQemu === '1' || kernelQemu === '1' || hardware === 'ranchu' || hardware === 'goldfish';
  return { kind: emulator ? 'emulator' : 'physical', name: (emulator ? avd || oldAvd : model) || null };
}

// emulator-<port> keeps the console name, which answers while the emulator is still offline (K18).
async function describe({ id, state }: Entry): Promise<Described> {
  if (isEmulator(id)) return { kind: 'emulator', name: await avdName(id) };
  return (state === 'device' && (await probe(id))) || { kind: 'physical', name: null };
}

// Short form is "serial\tstate" per line: a single tab, so spaces in either field cannot break the split.
async function entries(): Promise<Entry[]> {
  return (await adb(['devices']))
    .split('\n')
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const tab = line.indexOf('\t');
      return { id: line.slice(0, tab), state: line.slice(tab + 1).trim() };
    });
}

export async function listDevices() {
  return Promise.all(
    (await entries()).map(async ({ id, state }) => {
      const { kind, name } = await describe({ id, state });
      return { id, platform: 'android', kind, state, name };
    }),
  );
}

// A serial match wins. Names cost one adb call per entry, so they are fetched only when no serial matches, through
// the same describe() that devices prints (K21). adb itself does not accept an AVD name after -s (measured).
async function match(listed: Entry[], wanted: string, from: '--device' | 'ANDROID_SERIAL'): Promise<Entry[]> {
  const bySerial = listed.filter(({ id }) => id === wanted);
  if (bySerial.length) return bySerial;
  const named = await Promise.all(listed.map(async (entry) => ({ ...entry, name: (await describe(entry)).name })));
  const byName = named.filter(({ name }) => name === wanted);
  if (byName.length) return byName;
  const ids = named.map(({ id, name }) => (name ? `${id} (${name})` : id));
  const listing = ids.length ? `Listed: ${ids.join(', ')}.` : 'No device is listed.';
  throw new KaragozError(
    'DEVICE_NOT_FOUND',
    `device '${wanted}' from ${from} matches no serial or device name. ${listing}`,
  );
}

// Target order: --device, then ANDROID_SERIAL, then the only listed device. karagoz passes -s <id> on every
// later call, so adb's own ANDROID_SERIAL handling never applies and is reproduced here instead.
// With several devices and none named, karagoz refuses as adb does: an agent on the wrong device is worse.
export async function resolveTarget(device: string | undefined): Promise<string> {
  const listed = await entries();
  // An empty ANDROID_SERIAL counts as unset.
  const wanted = device ?? (process.env.ANDROID_SERIAL || undefined);
  const found =
    wanted === undefined ? listed : await match(listed, wanted, device === undefined ? 'ANDROID_SERIAL' : '--device');
  // match() throws when nothing matches, so an empty result means nothing is listed and nothing was wanted.
  const [target, ...others] = found;
  if (!target) {
    throw new KaragozError(
      'NO_DEVICE',
      'no device found. Start an emulator (emulator -avd <name>) or connect a phone with USB debugging on.',
    );
  }
  if (others.length) {
    const ids = found.map(({ id }) => id).join(', ');
    throw new KaragozError(
      'DEVICE_AMBIGUOUS',
      `more than one device: ${ids}. Pick one with --device <id> or ANDROID_SERIAL.`,
    );
  }
  if (target.state !== 'device') {
    const hint = target.state === 'unauthorized' ? ' Accept the USB debugging prompt on the device.' : '';
    throw new KaragozError('DEVICE_NOT_READY', `device ${target.id} is not ready (state: ${target.state}).${hint}`);
  }
  return target.id;
}
