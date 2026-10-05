import { listDevices } from './drivers/android/devices.js';
import { listSimulators } from './drivers/ios/devices.js';
import { KaragozError } from './errors.js';

type Platform = 'android' | 'ios';
type Row = { id: string; platform: string; kind: string; state: string; name: string | null };
type Listing = { platform: Platform; rows: Row[] } | { platform: Platform; error: KaragozError };

// A missing or broken tool becomes an errors entry instead of hiding the other platform's devices (K18 3.1 note).
// Anything else, a bug or a cancelled MCP call, still fails the command.
async function attempt(platform: Platform, list: () => Promise<Row[]>): Promise<Listing> {
  try {
    return { platform, rows: await list() };
  } catch (err) {
    if (!(err instanceof KaragozError)) throw err;
    return { platform, error: err };
  }
}

// iOS simulators exist only on macOS. When every platform tried fails, Android's error is the envelope, as before 3.1.
export async function listAll() {
  const listings = await Promise.all([
    attempt('android', listDevices),
    ...(process.platform === 'darwin' ? [attempt('ios', listSimulators)] : []),
  ]);
  const failed = listings.flatMap((listing) => ('error' in listing ? [listing] : []));
  const [first] = failed;
  if (first && failed.length === listings.length) throw first.error;
  const devices = listings.flatMap((listing) => ('rows' in listing ? listing.rows : []));
  if (!failed.length) return { devices };
  return {
    devices,
    errors: failed.map(({ platform, error }) => ({ platform, code: error.code, message: error.message })),
  };
}
