#!/bin/sh
# Step 2.2: `screenshot` reads the Android 14 `dumpsys window displays` format (fake adb, always), and captures a
# physical device by serial and by model name with K6 metadata that matches the device's own `wm size` and
# `wm density` (when one is listed).
# Precondition: the build only; a phone with USB debugging on is optional, and no emulator is needed.
# Nothing here writes to a phone: the only calls that reach one are `adb devices`, the getprop that `devices` and name
# matching make, screencap, `wm size`, `wm density` and `dumpsys window displays`. The adb server on the default port is
# never stopped or restarted.
set -e
cd "$(dirname "$0")/.."
npm run --silent build

tmp=$(mktemp -d)
serial=
# set +e: errexit stays on inside the trap.
trap 'set +e; rm -rf "$tmp"' EXIT
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
# Prints FAIL: and exits 1, with the phone's serial replaced by <phone> (CLAUDE.md, Device data). A literal replace,
# not sed: a serial such as 192.168.1.5:5555 holds regex characters.
fail() {
  if [ -z "$serial" ]; then
    printf 'FAIL: %s\n' "$1"
  else
    printf 'FAIL: %s\n' "$1" | node -e '
      process.stdout.write(require("fs").readFileSync(0, "utf8").split(process.argv[1]).join("<phone>"));
    ' "$serial"
  fi
  exit 1
}

# 1. Android 14 through a fake adb on an otherwise empty PATH. The fake sets its own PATH: without it cat is not
# found, and karagoz reports that screencap returned no data.
mkdir "$tmp/fake"
cat > "$tmp/fake/adb" <<'EOF'
#!/bin/sh
PATH=/usr/bin:/bin
here=${0%/*}
case "$*" in
  devices) printf 'List of devices attached\nfake-api34\tdevice\n\n' ;;
  '-s fake-api34 exec-out screencap -p') cat "$here/screen.png" ;;
  '-s fake-api34 shell wm density') printf 'Physical density: 450\n' ;;
  '-s fake-api34 shell dumpsys window displays') cat "$here/displays.txt" ;;
  *) echo "fake adb: unexpected call: $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$tmp/fake/adb"
# A 1080x2316 PNG with only IHDR and IEND, from hex: zlib.crc32 needs Node 22.2 and engines says >=22.
node -e 'require("fs").writeFileSync(process.argv[1], Buffer.from(process.argv[2], "hex"))' "$tmp/fake/screen.png" \
  89504e470d0a1a0a0000000d49484452000004380000090c0806000000122c48f40000000049454e44ae426082
# The Android 14 shape, written by hand in the AOSP 14 format (K23): the (organized) header, base= before cur=,
# mUserRotation= next to mRotation=, the insetsRoundedCornerFrame= tail, an ime line with visibleFrame=.
cat > "$tmp/fake/displays.txt" <<'EOF'
WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)
  Display: mDisplayId=0 (organized)
    init=1440x3088 600dpi base=1080x2316 450dpi cur=1080x2316 app=1080x2106
    mRotation=0 mDeferredRotationPauseCount=0
    mUserRotationMode=USER_ROTATION_FREE mUserRotation=ROTATION_0
  WindowInsetsStateController
    InsetsState
      mDisplayFrame=Rect(0, 0 - 1080, 2316)
        InsetsSource id=3 type=ime frame=[0,0][0,0] visibleFrame=[0,1307][1080,2316] visible=false flags= insetsRoundedCornerFrame=false
        InsetsSource id=27 type=displayCutout frame=[0,0][1080,75] visible=true flags= insetsRoundedCornerFrame=false
        InsetsSource id=a0000 type=statusBars frame=[0,0][1080,75] visible=true flags= insetsRoundedCornerFrame=false
        InsetsSource id=b0001 type=navigationBars frame=[0,2181][1080,2316] visible=true flags= insetsRoundedCornerFrame=false
        InsetsSource id=b0004 type=systemGestures frame=[0,0][0,0] visible=true flags= insetsRoundedCornerFrame=false
EOF
# An exact compare: a wrong density still exits 0 with a self-consistent scale.
out=$(env -i HOME="$tmp" PATH="$tmp/fake" "$(command -v node)" dist/cli.js screenshot --device fake-api34 --out "$tmp/api34.png" 2>"$tmp/err") \
  || fail "screenshot on the fake adb exited non-zero: $out $(cat "$tmp/err")"
want="{\"path\":\"$tmp/api34.png\",\"device\":\"fake-api34\",\"pixels\":{\"width\":1080,\"height\":2316},\"logical\":{\"width\":384,\"height\":823.4666666666667},\"scale\":2.8125,\"safeArea\":{\"top\":75,\"right\":0,\"bottom\":135,\"left\":0},\"rotation\":0}"
[ "$out" = "$want" ] || fail "the Android 14 fixture gave $out, expected $want"

# 2. A physical device on the default server, if one is listed. Every failure goes through fail, which masks the serial.
list=$(node dist/cli.js devices) || fail "devices exited non-zero: $list"
phone=$(printf '%s' "$list" | node -e '
  const { devices } = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const found = devices.find((d) => d.kind === "physical" && d.state === "device");
  if (found) console.log(JSON.stringify({ ...found, named: found.name ? devices.filter((d) => d.name === found.name).length : 0 }));
')
if [ -z "$phone" ]; then
  echo "SKIP: no physical device"
  physical="physical skipped"
else
  serial=$(printf '%s' "$phone" | field id)
  name=$(printf '%s' "$phone" | field name)
  named=$(printf '%s' "$phone" | field named)

  out=$(node dist/cli.js screenshot --device "$serial" --out "$tmp/phone.png" 2>"$tmp/err") \
    || fail "screenshot by serial exited non-zero: $out $(cat "$tmp/err")"
  [ "$(printf '%s' "$out" | field path)" = "$tmp/phone.png" ] || fail "path is not $tmp/phone.png: $out"
  [ "$(printf '%s' "$out" | field device)" = "$serial" ] || fail "device is not $serial: $out"
  png_ok "$tmp/phone.png" "$(printf '%s' "$out" | field pixels.width)" "$(printf '%s' "$out" | field pixels.height)" \
    || fail "$tmp/phone.png is not a whole PNG of the reported size: $out"

  # The K6 metadata against the device's own values, the override when one is set. No $ anchors: adb shell ends lines
  # with \r.
  size=$(adb -s "$serial" shell wm size 2>&1) || fail "adb -s $serial shell wm size failed: $size"
  density=$(adb -s "$serial" shell wm density 2>&1) || fail "adb -s $serial shell wm density failed: $density"
  why=$(printf '%s' "$out" | node -e '
    const out = require("fs").readFileSync(0, "utf8").trimEnd();
    const fail = (reason) => { console.log(reason); process.exit(1); };
    if (out.includes("\n")) fail("stdout is not one line");
    const { pixels, logical, scale, safeArea, rotation } = JSON.parse(out);
    const [size, density] = process.argv.slice(1);
    const read = (text, pattern) => text.match(new RegExp(`Override ${pattern}`)) ?? text.match(new RegExp(`Physical ${pattern}`));
    const wh = read(size, "size: (\\d+)x(\\d+)");
    if (!wh) fail(`no size in: ${size}`);
    const [width, height] = [90, 270].includes(rotation) ? [wh[2], wh[1]] : [wh[1], wh[2]];
    if (pixels.width !== Number(width) || pixels.height !== Number(height)) fail(`pixels are not ${width}x${height} (wm size)`);
    const dpi = read(density, "density: (\\d+)")?.[1];
    if (dpi === undefined) fail(`no density in: ${density}`);
    if (scale !== Number(dpi) / 160) fail(`scale is not ${dpi}/160`);
    for (const axis of ["width", "height"]) {
      if (Math.abs(logical[axis] * scale - pixels[axis]) >= 1e-6) fail(`logical.${axis} * scale is not pixels.${axis}`);
    }
    if (![0, 90, 180, 270].includes(rotation)) fail("rotation is not 0, 90, 180 or 270");
    for (const [edge, value] of Object.entries(safeArea)) {
      if (!Number.isInteger(value) || value < 0) fail(`safeArea.${edge} is not a non-negative integer`);
    }
    if (safeArea.top + safeArea.bottom >= pixels.height || safeArea.left + safeArea.right >= pixels.width) fail("safeArea covers the screen");
  ' "$size" "$density" 2>"$tmp/err") || fail "$why: $out $(cat "$tmp/err")"

  if [ "$named" = 1 ]; then
    res=$(node dist/cli.js screenshot --device "$name" --out "$tmp/byname.png" 2>"$tmp/err") \
      || fail "screenshot by model name $name exited non-zero: $res $(cat "$tmp/err")"
    [ "$(printf '%s' "$res" | field device)" = "$serial" ] || fail "model name $name did not resolve to $serial: $res"
  else
    echo "note: by-name step skipped, $named entries named $name"
  fi
  physical="physical $name $(printf '%s' "$out" | field pixels.width)x$(printf '%s' "$out" | field pixels.height)"
  physical="$physical scale $(printf '%s' "$out" | field scale) rotation $(printf '%s' "$out" | field rotation)"
fi

echo "ok: api34-fixture, $physical"
