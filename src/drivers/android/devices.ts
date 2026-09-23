import { KaragozError } from '../../errors.js';
import { adb } from './adb.js';

type Entry = { id: string; state: string };

// ponytail: the prefix is adb's own emulator classification. Emulators attached with `adb connect`
// and Genymotion read as physical and cannot be picked by AVD name; step 2.1 probes getprop for those.
const isEmulator = (id: string) => /^emulator-\d+$/.test(id);

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
      const emulator = isEmulator(id);
      return {
        id,
        platform: 'android',
        kind: emulator ? 'emulator' : 'physical',
        state,
        name: emulator ? await avdName(id) : null,
      };
    }),
  );
}

// A serial match wins. AVD names cost one console call per emulator, so they are fetched only when no serial
// matches. adb itself does not accept an AVD name after -s (measured).
async function match(listed: Entry[], wanted: string, from: '--device' | 'ANDROID_SERIAL'): Promise<Entry[]> {
  const bySerial = listed.filter(({ id }) => id === wanted);
  if (bySerial.length) return bySerial;
  const named = await Promise.all(
    listed.map(async (entry) => ({ ...entry, name: isEmulator(entry.id) ? await avdName(entry.id) : null })),
  );
  const byName = named.filter(({ name }) => name === wanted);
  if (byName.length) return byName;
  const ids = named.map(({ id, name }) => (name ? `${id} (${name})` : id));
  const listing = ids.length ? `Listed: ${ids.join(', ')}.` : 'No device is listed.';
  throw new KaragozError(
    'DEVICE_NOT_FOUND',
    `device '${wanted}' from ${from} matches no serial or AVD name. ${listing}`,
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
  if (!target) throw new KaragozError('NO_DEVICE', 'no device found. Start an emulator: emulator -avd <name>');
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
