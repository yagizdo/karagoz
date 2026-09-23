#!/bin/sh
# Step 1.2: `screenshot` captures a running emulator by serial or AVD name as a whole, full-resolution PNG, and
# every capture carries the K6 metadata read with it (logical size, scale, safe area, rotation);
# an unknown target and an option the command does not declare fail with the JSON envelope.
# Precondition: an emulator is running (emulator -avd <name>). Nothing here boots, stops, rotates or restarts
# anything, and the adb server on the default port is never touched.
set -e
cd "$(dirname "$0")/.."
npm run --silent build

tmp=$(mktemp -d)
shot=
# set +e: errexit stays on inside the trap, and a failing rm would skip the next one.
trap 'set +e; [ -z "$shot" ] || rm -f "$shot"; rm -rf "$tmp"' EXIT
# Prints .error.code, or not-json. The envelope must be exactly one line (K5).
code_of() { node -e '
  const out = require("fs").readFileSync(0, "utf8").trimEnd();
  try { console.log(out.includes("\n") ? "not-one-line" : JSON.parse(out).error.code) } catch { console.log("not-json") }
'; }
# Prints one field of a success result (a dotted key such as pixels.width). Fails unless stdout is one JSON line.
field() { node -e '
  const out = require("fs").readFileSync(0, "utf8").trimEnd();
  if (out.includes("\n")) process.exit(1);
  let value = JSON.parse(out);
  for (const key of process.argv[1].split(".")) value = value?.[key];
  if (value === undefined) process.exit(1);
  console.log(value);
' "$1"; }
# Passes when the file is a whole PNG of the given size: signature, IHDR first, the IEND chunk last.
png_ok() { node -e '
  const [file, width, height] = process.argv.slice(1);
  const png = require("fs").readFileSync(file);
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const iend = Buffer.from("0000000049454e44ae426082", "hex");
  const whole = png.subarray(0, 8).equals(signature) && png.toString("latin1", 12, 16) === "IHDR" && png.subarray(-12).equals(iend);
  process.exit(whole && png.readUInt32BE(16) === Number(width) && png.readUInt32BE(20) === Number(height) ? 0 : 1);
' "$1" "$2" "$3"; }

# 2. A ready, named emulator to aim at.
list=$(node dist/cli.js devices) || { echo "FAIL: devices exited non-zero: $list"; exit 1; }
emu=$(printf '%s' "$list" | node -e '
  const found = JSON.parse(require("fs").readFileSync(0, "utf8")).devices.find((d) => d.kind === "emulator" && d.state === "device" && d.name);
  if (!found) process.exit(1);
  console.log(found.id, found.name);
') || { echo "FAIL: no ready, named emulator in: $list (is one running? emulator -avd <name>)"; exit 1; }
id=${emu% *}
name=${emu#* }

# 3. By serial, to an explicit path whose parent directory does not exist yet.
out=$(node dist/cli.js screenshot --device "$id" --out "$tmp/sub/shot.png") \
  || { echo "FAIL: screenshot by serial exited non-zero: $out"; exit 1; }
path=$(printf '%s' "$out" | field path) || { echo "FAIL: screenshot by serial did not print one JSON line with path: $out"; exit 1; }
[ "$path" = "$tmp/sub/shot.png" ] || { echo "FAIL: path is '$path', expected '$tmp/sub/shot.png'"; exit 1; }
[ "$(printf '%s' "$out" | field device)" = "$id" ] || { echo "FAIL: device is not $id: $out"; exit 1; }
png_ok "$path" "$(printf '%s' "$out" | field pixels.width)" "$(printf '%s' "$out" | field pixels.height)" \
  || { echo "FAIL: $path is not a whole PNG of the reported size: $out"; exit 1; }

# 3b. The K6 metadata of that capture, against the density adb reports (the override when one is set).
density=$(adb -s "$id" shell wm density) || { echo "FAIL: adb -s $id shell wm density failed (is adb on PATH?)"; exit 1; }
why=$(printf '%s' "$out" | node -e '
  const out = require("fs").readFileSync(0, "utf8").trimEnd();
  const fail = (reason) => { console.log(reason); process.exit(1); };
  if (out.includes("\n")) fail("stdout is not one line");
  const { pixels, logical, scale, safeArea, rotation } = JSON.parse(out);
  if (!logical || scale === undefined || !safeArea || rotation === undefined) fail("logical, scale, safeArea or rotation missing");
  const density = (name) => process.argv[1].match(new RegExp(`${name} density: (\\d+)`))?.[1];
  const dpi = density("Override") ?? density("Physical");
  if (dpi === undefined) fail(`no density in: ${process.argv[1]}`);
  if (scale !== Number(dpi) / 160) fail(`scale is not ${dpi}/160`);
  for (const axis of ["width", "height"]) {
    if (Math.abs(logical[axis] * scale - pixels[axis]) >= 1e-6) fail(`logical.${axis} * scale is not pixels.${axis}`);
  }
  if (![0, 90, 180, 270].includes(rotation)) fail("rotation is not 0, 90, 180 or 270");
  if (Object.keys(safeArea).join() !== "top,right,bottom,left") fail("safeArea keys are not top, right, bottom, left");
  const limit = { top: pixels.height, bottom: pixels.height, left: pixels.width, right: pixels.width };
  for (const [edge, value] of Object.entries(safeArea)) {
    if (!Number.isInteger(value) || value < 0 || value >= limit[edge]) fail(`safeArea.${edge} is not an integer in [0, ${limit[edge]})`);
  }
' "$density") || { echo "FAIL: $why: $out"; exit 1; }

# 4. By AVD name, to the default path. The path is kept before any check on the file, so the trap removes it.
res=$(node dist/cli.js screenshot --device "$name") || { echo "FAIL: screenshot by AVD name exited non-zero: $res"; exit 1; }
shot=$(printf '%s' "$res" | field path) || { echo "FAIL: screenshot by AVD name did not print one JSON line with path: $res"; exit 1; }
[ "$(printf '%s' "$res" | field device)" = "$id" ] || { echo "FAIL: AVD name $name did not resolve to $id: $res"; exit 1; }
dir="$(node -p 'require("os").tmpdir()')/karagoz/"
case $shot in "$dir$id"-*.png) ;; *) echo "FAIL: default path '$shot' is not $dir$id-<time>.png"; exit 1 ;; esac
png_ok "$shot" "$(printf '%s' "$res" | field pixels.width)" "$(printf '%s' "$res" | field pixels.height)" \
  || { echo "FAIL: $shot is not a whole PNG of the reported size: $res"; exit 1; }

# 5. An unknown target.
if miss=$(node dist/cli.js screenshot --device nope 2>/dev/null); then echo "FAIL: unknown device exited 0"; exit 1; fi
[ "$(printf '%s' "$miss" | code_of)" = DEVICE_NOT_FOUND ] || { echo "FAIL: expected DEVICE_NOT_FOUND, got: $miss"; exit 1; }

# 6. devices declares no options.
if bad=$(node dist/cli.js devices --device x 2>/dev/null); then echo "FAIL: devices --device exited 0"; exit 1; fi
[ "$(printf '%s' "$bad" | code_of)" = INVALID_ARGS ] || { echo "FAIL: expected INVALID_ARGS, got: $bad"; exit 1; }

echo "ok: $out"
