import { KaragozError } from '../../errors.js';
import { pngSize } from '../../png.js';
import { simctlBytes, simctl } from './simctl.js';

// ponytail: the 12 mini and 13 mini render 375 pt wide and downsample to a 1080x2340 panel; UIKit gives apps
// nativeScale 2.88, simctl's SIMULATOR_MAINSCREEN_SCALE says 3 (Apple forum reply, not measured here, K33). No other
// iPhone or iPad has this panel. The limit lifts when a runtime source of the scale arrives (3.3).
const MINI = { width: 1080, height: 2340, scale: 1080 / 375 };

// The image is always the panel in portrait, and neither the interface orientation nor the safe area can be read
// from outside the simulator (measured on Xcode 26.2), so both are null rather than a guess (K6 3.2 note, K33).
export async function capture(udid: string) {
  const [png, scaleText] = await Promise.all([
    // --mask=ignored keeps the square framebuffer; simctl's help states no default (K33).
    simctlBytes(['io', udid, 'screenshot', '--mask=ignored', '-']),
    simctl(['getenv', udid, 'SIMULATOR_MAINSCREEN_SCALE']),
  ]);
  const pixels = pngSize(png);
  if (!pixels) {
    throw new KaragozError(
      'CAPTURE_FAILED',
      png.toString('utf8').trim().slice(0, 300) || 'simctl returned no image data',
    );
  }
  const reported = Number(scaleText.trim());
  if (!Number.isFinite(reported) || reported <= 0) {
    throw new KaragozError(
      'CAPTURE_FAILED',
      `cannot read scale from 'simctl getenv' (got '${scaleText.trim().slice(0, 100)}')`,
    );
  }
  const mini = pixels.width === MINI.width && pixels.height === MINI.height;
  return { png, pixels, scale: mini ? MINI.scale : reported, safeArea: null, rotation: null };
}
