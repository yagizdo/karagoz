#!/bin/sh
# Step 1.5: install, launch, terminate and uninstall each print one JSON line, and bad arguments fail with the JSON
# envelope before any device call. A fake adb covers failures a live device cannot produce.
# Precondition: an emulator is running with state device; a JDK (java, keytool) and Android SDK build-tools and a
# platform are on this machine. The smoke builds its own APK and installs and removes only dev.karagoz.smoke.
set -e
cd "$(dirname "$0")/.."
npm run --silent build

tmp=$(mktemp -d)
id=
# set +e: errexit stays on inside the trap, and a failing adb call would skip the rest.
trap 'set +e; if [ -n "$id" ]; then adb -s "$id" uninstall dev.karagoz.smoke; adb -s "$id" shell input keyevent HOME; fi >/dev/null 2>&1; rm -rf "$tmp"' EXIT
# Prints .error.code, or not-json. The envelope must be exactly one line (K5).
code_of() { node -e '
  const out = require("fs").readFileSync(0, "utf8").trimEnd();
  try { console.log(out.includes("\n") ? "not-one-line" : JSON.parse(out).error.code) } catch { console.log("not-json") }
'; }
# Prints .error.message of a one-line envelope, or not-json.
message_of() { node -e '
  const out = require("fs").readFileSync(0, "utf8").trimEnd();
  try { console.log(out.includes("\n") ? "not-one-line" : JSON.parse(out).error.message) } catch { console.log("not-json") }
'; }
# Prints .error.reason of a one-line envelope, none when it has no reason, or not-json.
reason_of() { node -e '
  const out = require("fs").readFileSync(0, "utf8").trimEnd();
  try { console.log(out.includes("\n") ? "not-one-line" : (JSON.parse(out).error.reason ?? "none")) } catch { console.log("not-json") }
'; }
# Prints one field of a success result. Fails unless stdout is one JSON line.
field() { node -e '
  const out = require("fs").readFileSync(0, "utf8").trimEnd();
  if (out.includes("\n")) process.exit(1);
  const value = JSON.parse(out)[process.argv[1]];
  if (value === undefined) process.exit(1);
  console.log(value);
' "$1"; }
# Fails unless `node dist/cli.js` with the arguments after $2 exits non-zero with a one-line envelope whose code is $1
# and, when $2 is not empty, whose message is exactly $2. Leaves the envelope in $got.
refuses() {
  want=$1 msg=$2
  shift 2
  if got=$(node dist/cli.js "$@" 2>/dev/null); then echo "FAIL: $* exited 0: $got"; exit 1; fi
  [ "$(printf '%s' "$got" | code_of)" = "$want" ] || { echo "FAIL: $*: expected $want, got: $got"; exit 1; }
  [ -z "$msg" ] || [ "$(printf '%s' "$got" | message_of)" = "$msg" ] \
    || { echo "FAIL: $*: expected the message '$msg', got: $got"; exit 1; }
}

# 1. Arguments. Each fails before any device call.
: > "$tmp/x.txt"
mkdir "$tmp/dir.apk"
refuses INVALID_ARGS "'install' needs <apk>" install
refuses INVALID_ARGS "'$tmp/x.txt' is not an .apk file" install "$tmp/x.txt"
refuses INVALID_ARGS "no file at '$tmp/nope.apk'" install "$tmp/nope.apk"
refuses INVALID_ARGS "'$tmp/dir.apk' is not a file" install "$tmp/dir.apk"
for verb in launch terminate uninstall; do
  refuses INVALID_ARGS "'$verb' needs <package>" "$verb"
  refuses INVALID_ARGS "'a;b' is not a package name" "$verb" 'a;b'
done

# 2. Tools. The newest build-tools and platform on this machine; no version is pinned here.
sdk=
looked=
for dir in "$ANDROID_HOME" "$ANDROID_SDK_ROOT" "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
  [ -n "$dir" ] || continue
  if [ -d "$dir/build-tools" ] && [ -d "$dir/platforms" ]; then sdk=$dir; break; fi
  looked="$looked $dir"
done
[ -n "$sdk" ] || { echo "FAIL: no Android SDK with build-tools/ and platforms/ (looked in:$looked)"; exit 1; }
# sort -V ranks 37.0.0-rc1 above 37.0.0, so only x.y.z names, sorted by number.
bt=$(ls "$sdk/build-tools" | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
[ -n "$bt" ] && [ -x "$sdk/build-tools/$bt/aapt2" ] && [ -x "$sdk/build-tools/$bt/apksigner" ] \
  || { echo "FAIL: no build-tools x.y.z with aapt2 and apksigner in $sdk/build-tools"; exit 1; }
bt=$sdk/build-tools/$bt
# API 37 ships only as android-37.0, .1 and .2.
api=$(ls "$sdk/platforms" | sed -n 's/^android-\([0-9][0-9]*\(\.[0-9][0-9]*\)\{0,1\}\)$/\1/p' | sort -t. -k1,1n -k2,2n | tail -n 1)
[ -n "$api" ] && [ -f "$sdk/platforms/android-$api/android.jar" ] \
  || { echo "FAIL: no platforms/android-N/android.jar in $sdk/platforms"; exit 1; }
command -v java >/dev/null || { echo "FAIL: java is not on PATH; apksigner runs it"; exit 1; }
command -v keytool >/dev/null || { echo "FAIL: keytool is not on PATH; it comes with the JDK"; exit 1; }

# 3. The APK: manifest only, no code (K28). Without --v4-signing-enabled false apksigner writes an .idsig, and adb
# installs incrementally next to one. apksigner's stderr holds JDK 24+ warnings; its exit code decides.
"$bt/aapt2" link -o "$tmp/u.apk" -I "$sdk/platforms/android-$api/android.jar" \
  --manifest smoke/fixtures/app-lifecycle/AndroidManifest.xml --min-sdk-version 24 --target-sdk-version "${api%%.*}" \
  || { echo "FAIL: aapt2 failed"; exit 1; }
keytool -genkeypair -keystore "$tmp/k.jks" -storepass android -keypass android -alias k -keyalg RSA -keysize 2048 \
  -validity 1 -dname CN=karagoz-smoke >/dev/null 2>&1 || { echo "FAIL: keytool failed"; exit 1; }
"$bt/apksigner" sign --ks "$tmp/k.jks" --ks-pass pass:android --v4-signing-enabled false --out "$tmp/smoke.apk" \
  "$tmp/u.apk" 2>/dev/null || { echo "FAIL: apksigner failed"; exit 1; }

# 4. The first ready emulator. Every live call names it, so a second device cannot cause DEVICE_AMBIGUOUS. A leftover
# from an interrupted run is removed.
list=$(node dist/cli.js devices) || { echo "FAIL: devices exited non-zero: $list"; exit 1; }
id=$(printf '%s' "$list" | node -e '
  const found = JSON.parse(require("fs").readFileSync(0, "utf8")).devices.find((d) => d.kind === "emulator" && d.state === "device");
  if (!found) process.exit(1);
  console.log(found.id);
') || { echo "FAIL: no ready emulator in: $list (is one running? emulator -avd <name>)"; exit 1; }
adb -s "$id" uninstall dev.karagoz.smoke >/dev/null 2>&1 || true

# 5. install.
out=$(node dist/cli.js install "$tmp/smoke.apk" --device "$id") || { echo "FAIL: install exited non-zero: $out"; exit 1; }
want="{\"device\":\"$id\",\"path\":\"$tmp/smoke.apk\"}"
[ "$out" = "$want" ] || { echo "FAIL: install printed $out, expected $want"; exit 1; }
adb -s "$id" shell pm path dev.karagoz.smoke >/dev/null || { echo "FAIL: pm path finds no dev.karagoz.smoke after install"; exit 1; }

# 6. A file that is not an APK: Android's code arrives as the reason.
printf x > "$tmp/bad.apk"
refuses INSTALL_FAILED '' install "$tmp/bad.apk" --device "$id"
[ "$(printf '%s' "$got" | reason_of)" = INSTALL_PARSE_FAILED_NOT_APK ] \
  || { echo "FAIL: install bad.apk: expected the reason INSTALL_PARSE_FAILED_NOT_APK, got: $got"; exit 1; }
case $(printf '%s' "$got" | message_of) in
  "adb: failed to install $tmp/bad.apk: Failure [INSTALL_PARSE_FAILED_NOT_APK"*) ;;
  *) echo "FAIL: install bad.apk: the message is not adb's stderr: $got"; exit 1 ;;
esac

# 7. launch.
out=$(node dist/cli.js launch dev.karagoz.smoke --device "$id") || { echo "FAIL: launch exited non-zero: $out"; exit 1; }
want="{\"device\":\"$id\",\"package\":\"dev.karagoz.smoke\",\"activity\":\"dev.karagoz.smoke/android.app.Activity\"}"
[ "$out" = "$want" ] || { echo "FAIL: launch printed $out, expected $want"; exit 1; }
adb -s "$id" shell pidof dev.karagoz.smoke >/dev/null || { echo "FAIL: no dev.karagoz.smoke process after launch"; exit 1; }

# 8. terminate, twice: a package that is installed but not running succeeds too.
want="{\"device\":\"$id\",\"package\":\"dev.karagoz.smoke\"}"
out=$(node dist/cli.js terminate dev.karagoz.smoke --device "$id") || { echo "FAIL: terminate exited non-zero: $out"; exit 1; }
[ "$out" = "$want" ] || { echo "FAIL: terminate printed $out, expected $want"; exit 1; }
if adb -s "$id" shell pidof dev.karagoz.smoke >/dev/null; then echo "FAIL: dev.karagoz.smoke still runs after terminate"; exit 1; fi
out=$(node dist/cli.js terminate dev.karagoz.smoke --device "$id") || { echo "FAIL: a second terminate exited non-zero: $out"; exit 1; }

# 9. Settings: the queried .Settings is a trampoline, and activity names the activity that reported. Its search runs in
# the Settings task from another package and would report instead (K25), so it is stopped first.
adb -s "$id" shell am force-stop com.google.android.settings.intelligence
out=$(node dist/cli.js launch com.android.settings --device "$id") || { echo "FAIL: launch Settings exited non-zero: $out"; exit 1; }
activity=$(printf '%s' "$out" | field activity) || { echo "FAIL: launch Settings printed no activity: $out"; exit 1; }
case $activity in
  com.android.settings/.Settings) echo "FAIL: launch Settings reported the trampoline: $out"; exit 1 ;;
  com.android.settings/*) ;;
  *) echo "FAIL: launch Settings reported another package: $out"; exit 1 ;;
esac
node dist/cli.js terminate com.android.settings --device "$id" >/dev/null

# 10. An installed package with no launcher activity, and one that is not installed.
refuses APP_NOT_LAUNCHABLE "package 'com.android.shell' has no launcher activity" launch com.android.shell --device "$id"
refuses APP_NOT_FOUND "package 'dev.karagoz.nope' is not installed on $id" launch dev.karagoz.nope --device "$id"

# 11. uninstall, then every verb that takes a package finds it gone.
out=$(node dist/cli.js uninstall dev.karagoz.smoke --device "$id") || { echo "FAIL: uninstall exited non-zero: $out"; exit 1; }
want="{\"device\":\"$id\",\"package\":\"dev.karagoz.smoke\"}"
[ "$out" = "$want" ] || { echo "FAIL: uninstall printed $out, expected $want"; exit 1; }
if adb -s "$id" shell pm path dev.karagoz.smoke >/dev/null; then echo "FAIL: pm path still finds dev.karagoz.smoke"; exit 1; fi
for verb in uninstall launch terminate; do
  refuses APP_NOT_FOUND "package 'dev.karagoz.smoke' is not installed on $id" "$verb" dev.karagoz.smoke --device "$id"
done

# 12. Against a fake adb, for failures a live device gives only with a broken or protected package. ANDROID_HOME makes
# $tmp/sdk/platform-tools/adb karagoz's first adb candidate.
mkdir -p "$tmp/sdk/platform-tools"
cat > "$tmp/sdk/platform-tools/adb" <<'FAKE'
#!/bin/sh
# Fake adb for smoke 1.5: a device where dev.karagoz.x is installed and broken.
case "$*" in
  devices) printf 'List of devices attached\nemulator-5554\tdevice\n\n' ;;
  *'exec-out cmd package query-activities '*) echo 'dev.karagoz.x/.Main' ;;
  *'exec-out am start '*)
    printf '%s\n' 'Starting: Intent { cmp=dev.karagoz.x/.Main }' 'Error type 3' \
      'Error: Activity class {dev.karagoz.x/dev.karagoz.x.Main} does not exist.' ;;
  *'exec-out pm path dev.karagoz.x') echo 'package:/data/app/x/base.apk' ;;
  *'exec-out cmd package uninstall dev.karagoz.x') echo 'Failure [DELETE_FAILED_INTERNAL_ERROR]' ;;
  *'exec-out am force-stop dev.karagoz.x') echo "Exception occurred while executing 'force-stop':" ;;
  *) echo "fake adb: unexpected arguments: $*" >&2; exit 1 ;;
esac
FAKE
chmod +x "$tmp/sdk/platform-tools/adb"
# Sets $got. ANDROID_HOME is set inside the substitution: an assignment before a function call outlives the call in sh.
fake_run() { got=$(ANDROID_HOME="$tmp/sdk" node dist/cli.js "$@" 2>/dev/null); }
# Fails unless $got is a one-line envelope with code $2 and the message $3. $1: the fixture.
error_is() {
  [ "$(printf '%s' "$got" | code_of)" = "$2" ] || { echo "FAIL: fixture $1: expected $2, got: $got"; exit 1; }
  [ "$(printf '%s' "$got" | message_of)" = "$3" ] || { echo "FAIL: fixture $1: expected the message '$3', got: $got"; exit 1; }
}

# a. am start -W writes its errors to stdout: the Error: line is the message.
if fake_run launch dev.karagoz.x --device emulator-5554; then echo "FAIL: fixture a exited 0: $got"; exit 1; fi
error_is a ADB_FAILED 'Error: Activity class {dev.karagoz.x/dev.karagoz.x.Main} does not exist.'

# b. A protected package, or a system app with no update, refuses to go: Android's code arrives as the reason.
if fake_run uninstall dev.karagoz.x --device emulator-5554; then echo "FAIL: fixture b exited 0: $got"; exit 1; fi
error_is b UNINSTALL_FAILED 'Failure [DELETE_FAILED_INTERNAL_ERROR]'
[ "$(printf '%s' "$got" | reason_of)" = DELETE_FAILED_INTERNAL_ERROR ] \
  || { echo "FAIL: fixture b: expected the reason DELETE_FAILED_INTERNAL_ERROR, got: $got"; exit 1; }

# c. force-stop prints nothing when it works, so any output is its error.
if fake_run terminate dev.karagoz.x --device emulator-5554; then echo "FAIL: fixture c exited 0: $got"; exit 1; fi
error_is c ADB_FAILED "Exception occurred while executing 'force-stop':"

echo "ok: $id, install, launch, terminate, uninstall, fake adb"
