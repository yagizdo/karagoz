import { adb } from './adb.js';

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
export async function listDevices() {
  const lines = (await adb(['devices'])).split('\n').filter((line) => line.includes('\t'));
  return Promise.all(
    lines.map(async (line) => {
      const tab = line.indexOf('\t');
      const id = line.slice(0, tab);
      // ponytail: the prefix is adb's own emulator classification. Emulators attached with `adb connect`
      // and Genymotion read as physical; step 2.1 probes getprop for those.
      const emulator = /^emulator-\d+$/.test(id);
      return {
        id,
        platform: 'android',
        kind: emulator ? 'emulator' : 'physical',
        state: line.slice(tab + 1).trim(),
        name: emulator ? await avdName(id) : null,
      };
    }),
  );
}
