# Karagöz

Device automation for mobile apps. One tool for four targets: Android emulator, Android physical device, iOS simulator, iOS physical device. It is a CLI today; an MCP server over the same core is planned so an AI agent can drive it.

> **Status: early development.** Eleven commands work on the Android emulator. The other three targets, logs and the MCP server are not written yet. Nothing is published to npm. See [Status](#status).

## Contents

- [Status](#status)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Concepts](#concepts)
  - [Device selection](#device-selection)
  - [Coordinates](#coordinates)
  - [Accessibility tree first](#accessibility-tree-first)
- [Output and errors](#output-and-errors)
  - [Arguments](#arguments)
  - [Error codes](#error-codes)
- [Commands](#commands)
  - [devices](#devices)
  - [screenshot](#screenshot)
  - [ui-tree](#ui-tree)
  - [tap](#tap)
  - [swipe](#swipe)
  - [text](#text)
  - [key](#key)
  - [install](#install-1)
  - [launch](#launch)
  - [terminate](#terminate)
  - [uninstall](#uninstall)
- [Scope](#scope)
- [Development](#development)
- [Name](#name)
- [License](#license)

## Status

| Command | Android emulator | Android device | iOS simulator | iOS device |
| --- | --- | --- | --- | --- |
| [`devices`](#devices) | done | planned | planned | planned |
| [`screenshot`](#screenshot) | done | planned | planned | planned |
| [`ui-tree`](#ui-tree) | done | planned | planned | planned |
| [`tap`](#tap) | done | planned | planned | planned |
| [`swipe`](#swipe) | done | planned | planned | planned |
| [`text`](#text) | done | planned | planned | planned |
| [`key`](#key) | done | planned | planned | planned |
| [`install`](#install-1) | done | planned | planned | planned |
| [`launch`](#launch) | done | planned | planned | planned |
| [`terminate`](#terminate) | done | planned | planned | planned |
| [`uninstall`](#uninstall) | done | planned | planned | planned |
| `logs` | planned | planned | planned | planned |
| MCP server | planned | | | |

"Done" means tested against a live emulator: macOS, an API 36 image (Android 16), 1080x2400 at 420 dpi. Physical Android devices go through the same `adb` calls, but no command has been tested on one yet. Windows and Linux have not been run.

## Requirements

- **Node 22 or newer.**
- **`adb`** from Android platform-tools, for Android targets. karagoz does not bundle it; it looks for it on every run, in this order:
  1. `$ANDROID_HOME/platform-tools/adb`
  2. `$ANDROID_SDK_ROOT/platform-tools/adb`
  3. `adb` on `PATH`
  4. Android Studio's default SDK: `~/Library/Android/sdk` on macOS, `~/Android/Sdk` on Linux, `%LOCALAPPDATA%\Android\Sdk` on Windows

  An empty variable is skipped. The first `adb` that starts is used for the rest of the run, so a broken `adb` under `ANDROID_HOME` does not fall back to `PATH`. When none is found:

  ```json
  {"error":{"code":"ADB_NOT_FOUND","message":"adb not found (tried ..., PATH). Install platform-tools (brew install --cask android-platform-tools, or download https://developer.android.com/tools/releases/platform-tools and add it to PATH) or set ANDROID_HOME to your Android SDK."}}
  ```

- **A running emulator** (`emulator -avd <name>`) in state `device`. karagoz installs nothing on it by itself; `install` installs only the APK you pass it.
- For the `smoke/1.5-app-lifecycle.sh` script only: a JDK and Android SDK build-tools with one platform. The smoke builds its own test APK, `dev.karagoz.smoke`, and removes it at the end. See [Development](#development).
- For `ui-tree` and `tap --text` / `--id`: the screen is on, and no other UiAutomation client is connected (Appium, Maestro, `uiautomator events`). For input to reach apps, the screen is also unlocked.

## Install

Not on npm yet. From source:

```sh
git clone https://github.com/yagizdo/karagoz.git
cd karagoz
npm install
npm run build          # writes dist/cli.js
node dist/cli.js devices
```

`npm link` puts `karagoz` on your `PATH`. The examples below use `karagoz`.

## Quick start

```sh
$ karagoz devices
{"devices":[{"id":"emulator-5554","platform":"android","kind":"emulator","state":"device","name":"Medium_Phone_API_36.1"}]}

$ karagoz tap --text Chrome
{"device":"emulator-5554","x":667.5,"y":2002.5,"element":{"class":"android.widget.TextView","text":"Chrome","contentDesc":"Chrome","clickable":true,"longClickable":true,"focusable":true,"bounds":[581,1905,754,2100]}}

$ karagoz key HOME
{"device":"emulator-5554","key":"KEYCODE_HOME","code":3}

$ karagoz screenshot --out home.png
{"path":"/Users/me/home.png","device":"emulator-5554","pixels":{"width":1080,"height":2400},"logical":{"width":411.42857142857144,"height":914.2857142857143},"scale":2.625,"safeArea":{"top":63,"right":0,"bottom":63,"left":0},"rotation":0}
```

`karagoz ui-tree` prints the screen's accessibility tree; `tap --text` above found its target in that tree.

## Concepts

### Device selection

Every command except `devices` works on one device, picked in this order:

1. `--device <id>`
2. the `ANDROID_SERIAL` environment variable (ignored when `--device` is given; empty counts as unset)
3. the only listed device

The value is matched against adb serials first (`emulator-5554`), exactly. If no serial matches, it is matched against the AVD names of running emulators (`Medium_Phone_API_36.1`), exactly and case-sensitively.

| Situation | Error |
| --- | --- |
| A value is given and nothing matches | `DEVICE_NOT_FOUND`, listing what is connected |
| No value, nothing connected | `NO_DEVICE` |
| No value and two or more devices listed (in any state), or an AVD name that matches two emulators | `DEVICE_AMBIGUOUS` |
| The picked device is not in state `device` (`offline`, `unauthorized`, ...) | `DEVICE_NOT_READY` |

karagoz never guesses between devices. There is no config file and no other environment variable.

An emulator attached with `adb connect`, and Genymotion, list as `physical` and can only be picked by serial.

### Coordinates

`screenshot` pixels, `ui-tree` bounds and the `tap` / `swipe` coordinates share one space: physical pixels of the current screen orientation, origin top left. A node's `bounds` of `[581,1905,754,2100]` can be tapped at its center, `(667.5, 2002.5)`, and that point is the same pixel in the screenshot. Decimals are allowed.

`screenshot` reports `scale` (physical pixels per density-independent pixel) and `logical` size so a caller can convert to dp.

### Accessibility tree first

To see the screen, read `ui-tree` before taking a screenshot. The tree is text a program can search, costs a few hundred to a few thousand tokens, and gives the bounds needed to tap. A screenshot is written to disk and returned as a path; the CLI never prints the image.

## Output and errors

Every command prints exactly one line of JSON on stdout and exits.

- **Success:** the command's result object, exit code `0`.
- **Failure:** an error object, exit code `1`:

  ```json
  {"error":{"code":"DEVICE_NOT_FOUND","message":"device 'nosuch' from --device matches no serial or AVD name. Listed: emulator-5554 (Medium_Phone_API_36.1)."}}
  ```

  The same message goes to stderr as `karagoz: <message>`. It can span more than one line when it quotes adb or Node output; the stdout line never does.

  `INSTALL_FAILED` and `UNINSTALL_FAILED` add a `reason` field with Android's own code for the failure:

  ```json
  {"error":{"code":"INSTALL_FAILED","message":"adb: failed to install /Users/me/app-v1.apk: Failure [INSTALL_FAILED_VERSION_DOWNGRADE: Downgrade detected: Update version code 1 is older than current 2]","reason":"INSTALL_FAILED_VERSION_DOWNGRADE"}}
  ```

  No other code has it.

Branch on `error.code`, not on the message. Messages are for people and can change.

stderr also carries adb's own notices on success, such as `* daemon started successfully` when the adb server was not running. That first call takes about 3 s longer.

`karagoz --version` prints the version as plain text (`0.0.0`) and exits `0`. It wins over any command: `karagoz devices --version` prints the version.

### Arguments

- Options can appear anywhere, before or after the command name. A repeated option keeps its last value.
- There are no short flags. A value that starts with `-` is read as an option: `--device=-x` passes it as a value, and a positional that starts with `-` goes after `--`, with options before it: `karagoz text --device emulator-5554 -- -5`.
- An empty value (`--out=`) is refused.
- An option the command does not take is refused: `'devices' does not take the option '--device'`.

All of these fail with `INVALID_ARGS` before any device is contacted.

### Error codes

The set is closed. Any failure without a code of its own is reported as `INTERNAL`.

| Code | Meaning | From |
| --- | --- | --- |
| `NO_COMMAND` | No command given. The message lists the commands. | all |
| `UNKNOWN_COMMAND` | The command name is not known. | all |
| `INVALID_ARGS` | Missing, extra, malformed or unknown arguments, an unknown key name, an APK path that is not an existing `.apk` file, or a malformed package name. | all |
| `ADB_NOT_FOUND` | No `adb` found. See [Requirements](#requirements). | all that reach adb |
| `ADB_TIMEOUT` | adb did not answer in time: 10 s per call, 20 s for a `ui-tree` read, 10 s plus the duration for a long press or swipe, 10 s plus 1 s per started MB for `install`, 30 s for the start in `launch`. The message suggests `adb kill-server`; for `ui-tree` the cause is more often a stuck dump. | all that reach adb |
| `ADB_FAILED` | adb exited with an error. The message is adb's stderr, or Node's error when adb printed nothing. For `launch`, `terminate` and `uninstall` it can also be the error the device command printed. A device that disconnects mid-command ends here. | all that reach adb |
| `NO_DEVICE` | No device connected and none named. | all but `devices` |
| `DEVICE_NOT_FOUND` | The named device is not connected. | all but `devices` |
| `DEVICE_AMBIGUOUS` | More than one device and none named. | all but `devices` |
| `DEVICE_NOT_READY` | The device is `offline`, `unauthorized` or similar. | all but `devices` |
| `CAPTURE_FAILED` | The screen could not be read: bad screenshot data, missing display info, or a uiautomator failure. The message says which. | `screenshot`, `ui-tree`, `tap --text/--id` |
| `AUTOMATION_BUSY` | Another UiAutomation client holds the device. | `ui-tree`, `tap --text/--id` |
| `WRITE_FAILED` | The screenshot file could not be written. | `screenshot` |
| `TEXT_UNSUPPORTED` | The text has a character Android's `input text` cannot type. | `text` |
| `ELEMENT_NOT_FOUND` | No node matches. | `tap --text/--id` |
| `ELEMENT_AMBIGUOUS` | More than one node matches. | `tap --text/--id` |
| `ELEMENT_COVERED` | The node's center is under the on-screen keyboard. | `tap --text/--id` |
| `INSTALL_FAILED` | Android refused the APK. `reason` is Android's code. | `install` |
| `UNINSTALL_FAILED` | Android refused to remove the app. `reason` is Android's code. | `uninstall` |
| `APP_NOT_FOUND` | The package is not installed. | `launch`, `terminate`, `uninstall` |
| `APP_NOT_LAUNCHABLE` | The package is installed but has no activity a launcher can start. | `launch` |
| `INTERNAL` | A bug in karagoz. Please report it with the message. | all |

## Commands

| Command | Does |
| --- | --- |
| [`devices`](#devices) | List connected devices |
| [`screenshot`](#screenshot) | Save a full-resolution PNG and return its path with scale metadata |
| [`ui-tree`](#ui-tree) | Return the accessibility tree of the focused window |
| [`tap`](#tap) | Tap or long-press a point, or a node found by text or id |
| [`swipe`](#swipe) | Swipe between two points |
| [`text`](#text) | Type text into the focused field |
| [`key`](#key) | Press a key |
| [`install`](#install-1) | Install or replace an app from an APK |
| [`launch`](#launch) | Start an app as its launcher icon does |
| [`terminate`](#terminate) | Stop every process of an app |
| [`uninstall`](#uninstall) | Remove an app |

### devices

```
karagoz devices
```

Lists what `adb devices` lists. Takes no options.

**Output**

```json
{"devices":[{"id":"emulator-5554","platform":"android","kind":"emulator","state":"device","name":"Medium_Phone_API_36.1"}]}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The adb serial. Pass it to `--device`. |
| `platform` | `"android"` | |
| `kind` | `"emulator"` or `"physical"` | `emulator` when the id is `emulator-<port>`. |
| `state` | string | adb's state, unchanged: `device`, `offline`, `unauthorized`, ... Only `device` can be used. |
| `name` | string or `null` | The AVD name for emulators, `null` otherwise or when the emulator does not answer. |

No devices is not an error: `{"devices":[]}`, exit `0`. Devices keep adb's order.

**Errors:** `INVALID_ARGS`, `ADB_NOT_FOUND`, `ADB_TIMEOUT`, `ADB_FAILED`.

**Notes**

- About 55 ms, plus about 50 ms per emulator for its name, asked in parallel.
- If an emulator's name comes back `null`, check that `HOME` points to your home directory; the emulator console reads a token from there.

### screenshot

```
karagoz screenshot [--out <path>] [--device <id>]
```

Saves the screen as a PNG at full device resolution, never scaled, and prints where it went with the metadata needed to measure against it.

| Option | Default | Meaning |
| --- | --- | --- |
| `--out <path>` | a new file under the temp directory | Where to write the PNG. |
| `--device <id>` | see [Device selection](#device-selection) | |

**Output**

```json
{"path":"/Users/me/home.png","device":"emulator-5554","pixels":{"width":1080,"height":2400},"logical":{"width":411.42857142857144,"height":914.2857142857143},"scale":2.625,"safeArea":{"top":63,"right":0,"bottom":63,"left":0},"rotation":0}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `path` | string | Absolute path of the PNG. |
| `device` | string | Serial of the device captured. |
| `pixels` | `{width, height}` | Size of the PNG, read from the file itself. |
| `logical` | `{width, height}` | `pixels / scale`, not rounded. |
| `scale` | number | Density / 160, using the override density if one is set (`adb shell wm density`). |
| `safeArea` | `{top, right, bottom, left}` | Pixels of this PNG covered by the status bar, navigation bar, caption bar or display cutout. A hidden bar counts as 0. The keyboard and gesture areas are not included. |
| `rotation` | `0`, `90`, `180` or `270` | Screen rotation in degrees. |

**File location**

- Without `--out`: `<temp dir>/karagoz/<device id>-<UTC timestamp>.png`, for example `/var/folders/.../T/karagoz/emulator-5554-20260926T101530123Z.png`. The temp directory follows `TMPDIR`. The `karagoz` directory is created private to your user (mode 0700) and must be a real directory you own; the file is created with mode 0600 and never overwrites. Characters other than letters, digits, `.`, `_` and `-` in the device id become `_`.
- With `--out`: relative paths resolve against the current directory, missing parent directories are created, and an existing file is overwritten. The name is not checked, so use `.png`.
- karagoz never deletes screenshots. One 1080x2400 capture is about 1.4 MB.

**Errors**

- `CAPTURE_FAILED`: screencap returned something other than a whole PNG (its message is included); the density, display size, rotation or insets could not be read (`cannot read <value> from <command>`); or the screen rotated or resized during the capture (`display is WxH but the screenshot is WxH`). With more than one display, screencap's warning comes back as `CAPTURE_FAILED`.
- `WRITE_FAILED`: the file could not be written, or the default directory is not yours (`pass --out`). Two captures of one device in the same millisecond without `--out`: the second fails.
- Plus the [device selection](#device-selection) errors, `INVALID_ARGS` and the adb errors.

**Notes**

- About 1 s.
- A screen that is off, or an app that sets `FLAG_SECURE`, gives a black PNG and exit `0`.
- If the density changes during a capture, `scale` and `safeArea` can disagree for that one capture.

### ui-tree

```
karagoz ui-tree [--device <id>]
```

Returns the accessibility tree of the focused window, read with `uiautomator dump`.

**Output** (children cut short here; the real tree nests the Chrome icon several levels deep)

```json
{"device":"emulator-5554","rotation":0,"root":{"class":"android.widget.FrameLayout","package":"com.google.android.apps.nexuslauncher","bounds":[0,0,1080,2400],"children":[...]}}
```

A node from the same tree:

```json
{"class":"android.widget.TextView","text":"Chrome","contentDesc":"Chrome","clickable":true,"longClickable":true,"focusable":true,"bounds":[581,1905,754,2100]}
```

| Field | Present | Meaning |
| --- | --- | --- |
| `device` | always | Serial. |
| `rotation` | always | `0`, `90`, `180` or `270`. |
| `root` | always | The top node. |

Node fields, in this order:

| Field | Present | Meaning |
| --- | --- | --- |
| `class` | always | Android class, e.g. `android.widget.Button`. Can be empty. |
| `package` | on the root, and on any node whose package differs from its parent's | App package. |
| `text`, `contentDesc`, `resourceId`, `hint` | when not empty | `resourceId` is the full form, `com.example:id/save`. `hint` exists only from API 36. |
| `checkable`, `checked`, `clickable`, `longClickable`, `focusable`, `focused`, `scrollable`, `selected`, `password` | only when `true` | |
| `enabled` | only when `false` | |
| `bounds` | always | `[left, top, right, bottom]` in [screen pixels](#coordinates). Can be negative for nodes partly off screen. |
| `children` | when the node has any | Nodes, same shape. |

Other attributes that uiautomator prints (`index`, `drawing-order`, `NAF`) are dropped. Every node uiautomator returns is kept; there is no filtering.

What the tree covers is what uiautomator covers: the focused window, and nodes visible to the user. Where a framework puts its labels differs: Jetpack Compose puts text in `text`, Flutter puts it in `contentDesc`.

**WebView:** a WebView's content often arrives only on the second read. When the tree has a WebView with no children, karagoz reads once more and returns the second tree, or the first if the second read fails.

**Errors**

- `CAPTURE_FAILED`, with the reason in the message:
  - the screen kept changing for uiautomator's 10 s idle wait (an animation or live content);
  - no focused window (the screen is off, or an app is still starting);
  - uiautomator was killed (the message names `adb -s <id> logcat -b crash`); a lone UTF-16 surrogate in on-screen text does this;
  - the output could not be parsed.
- `AUTOMATION_BUSY`: another UiAutomation client is connected. Only one can be at a time.
- `ADB_TIMEOUT` after 20 s.
- Plus the [device selection](#device-selection) errors, `INVALID_ARGS` and the adb errors.

**Notes**

- One read takes 2.4 to 3.3 s; a screen with a fresh WebView about 5.3 s. The idle failure arrives after about 12 s.
- Output size on real screens was 560 to 3,900 tokens.
- While a read runs, accessibility services such as TalkBack are unbound, and apps see accessibility as enabled.

### tap

```
karagoz tap <x> <y> [--duration <ms>] [--device <id>]
karagoz tap --text <label> [--timeout <ms>] [--duration <ms>] [--device <id>]
karagoz tap --id <resource-id> [--timeout <ms>] [--duration <ms>] [--device <id>]
```

Taps a point, or finds one node in the [tree](#ui-tree) and taps its center. Give exactly one of `<x> <y>`, `--text` or `--id`.

| Option | Default | Meaning |
| --- | --- | --- |
| `<x> <y>` | | A point in [screen pixels](#coordinates). Non-negative, decimals allowed (`12`, `12.5`). |
| `--text <label>` | | A node whose `text` or `contentDesc` equals the label: whole string, case-sensitive, no trimming. |
| `--id <resource-id>` | | A node whose `resourceId` equals the value, or ends with `:id/<value>`. `--id save` matches `com.example:id/save`. |
| `--duration <ms>` | none | Hold for this long (a long press). Whole milliseconds, 0 to 999999999. |
| `--timeout <ms>` | `0` | Keep reading the tree until a node matches or this much time has passed. Only with `--text` or `--id`. |
| `--device <id>` | see [Device selection](#device-selection) | |

**Output**

Point:

```json
{"device":"emulator-5554","x":540,"y":1200}
```

With `--duration 10` a `"duration":10` field follows `y`. Node:

```json
{"device":"emulator-5554","x":667.5,"y":2002.5,"element":{"class":"android.widget.TextView","text":"Chrome","contentDesc":"Chrome","clickable":true,"longClickable":true,"focusable":true,"bounds":[581,1905,754,2100]}}
```

`element` is the matched node as [`ui-tree`](#ui-tree) returns it, without `children`. `x` and `y` are its center.

**How a node is found**

- The tap goes to the center of the node that matched, not to a clickable parent. Measured on View, Compose and Flutter test apps, the center of the matched node receives the click.
- A parent and a child that both match are two matches: `ELEMENT_AMBIGUOUS`. Pick one and tap its coordinates.
- Nodes with zero-size bounds never match.
- If the keyboard is visible and the node's center is inside it, the tap is refused with `ELEMENT_COVERED`. Close the keyboard with `karagoz key BACK`. Only the keyboard is checked; bubbles and picture-in-picture windows are not.
- With `--timeout`, only "no match" triggers another read, and it starts right away. The last read can end up to one read (about 3 s) past the timeout. The tap itself is never repeated.
- The screen can change between the read and the tap; the tap then lands on the old point.
- A long press with `--duration` is sent as a swipe that does not move. Long-press thresholds measured: 400 ms on View and Compose, 500 ms on Flutter.

**Errors**

- `INVALID_ARGS`: no target or more than one (`'tap' takes <x> <y>, --text or --id`), a single coordinate (`'tap' needs <x> <y>`), `--timeout` with a point, or a malformed number.
- `ELEMENT_NOT_FOUND`: `no node with text or contentDesc 'Save' in com.example (1 read in 2.6 s)`.
- `ELEMENT_AMBIGUOUS`: lists up to five matches with class and bounds.
- `ELEMENT_COVERED`: the node is under the keyboard.
- Node taps also get every [`ui-tree`](#ui-tree) error. A point tap does not read the tree, so it works while another UiAutomation client is connected.
- Plus the [device selection](#device-selection) errors and the adb errors.

**Notes**

- A point tap takes about 0.2 s. A node tap adds one tree read, 2.5 to 3.3 s.
- Points are not checked against the screen size.
- Exit `0` means Android accepted the event, not that the app reacted to it. Read the tree again to check.

### swipe

```
karagoz swipe <x1> <y1> <x2> <y2> [--duration <ms>] [--device <id>]
```

Moves one finger from `(x1, y1)` to `(x2, y2)`.

| Option | Default | Meaning |
| --- | --- | --- |
| `<x1> <y1> <x2> <y2>` | | [Screen pixels](#coordinates), same rules as `tap`. |
| `--duration <ms>` | `300` | Time from start to end. Whole milliseconds, 0 to 999999999. |
| `--device <id>` | see [Device selection](#device-selection) | |

**Output**

```json
{"device":"emulator-5554","x1":540,"y1":1800,"x2":540,"y2":600,"duration":300}
```

`duration` is always present, including the default.

**Duration matters.** A fast swipe flings a list and a slow one drags it. Measured on a 1200 px drag: 300 ms scrolled a further 1059 px after the finger lifted, 1000 ms scrolled 131 px further, 3000 ms 19 px.

**Errors:** `INVALID_ARGS`, the [device selection](#device-selection) errors and the adb errors.

### text

```
karagoz text <text> [--device <id>]
karagoz text [--device <id>] -- <text starting with ->
```

Types into whatever has focus, as Android's `input text` does.

**Output**

```json
{"device":"emulator-5554","text":"hello"}
```

**Characters.** Printable ASCII, newline (sent as Enter), tab (sent as Tab), `ç`, `Ç` and `ß`. Anything else fails before anything is typed:

```json
{"error":{"code":"TEXT_UNSUPPORTED","message":"cannot type 'ü' (U+00FC): Android's input text types only printable ASCII, newline, tab, ç, Ç and ß; nothing was typed"}}
```

Quotes, spaces and `%s` are typed as they are; karagoz handles the escaping.

**Errors**

- `INVALID_ARGS`: empty text.
- `TEXT_UNSUPPORTED`: see above.
- Long text is sent in pieces of up to 100 characters. If a piece fails, the error keeps its code and the message ends with `; <n> of <total> characters were typed before this`.
- Plus the [device selection](#device-selection) errors and the adb errors.

**Notes**

- Characters typed right after a field appears can be lost. Waiting about 2 s after the field shows up fixed it in testing.
- 100 characters take about 0.9 s.

### key

```
karagoz key <key> [--device <id>]
```

Presses one key.

`<key>` is an Android [KeyEvent](https://developer.android.com/reference/android/view/KeyEvent) name or code:

- A name, case-insensitive, with or without `KEYCODE_`: `HOME`, `back`, `KEYCODE_ENTER`, `VOLUME_UP`.
- A number from 1 to 340 is a key code: `key 3` is `HOME`. To press the digit 7, use `KEYCODE_7`, because `key 7` is code 7, which is `KEYCODE_0`.

**Output**

```json
{"device":"emulator-5554","key":"KEYCODE_HOME","code":3}
```

`key` is the resolved name and `code` its number.

**Errors**

- `INVALID_ARGS`: `unknown key 'FOO'; use a KeyEvent name such as HOME, BACK or ENTER, or a code from 1 to 340`. Checked before any device call.
- Plus the [device selection](#device-selection) errors and the adb errors.

**Notes**

- Codes 338 to 340 exist in the name table but Android 16 sends them as `KEYCODE_UNKNOWN`, still with exit `0`.
- Some keys act on the whole device: code 312 opens Recents, 318 saves a screenshot.
- Exit `0` means Android accepted the key, not that the app reacted to it.

### install

```
karagoz install <apk> [--device <id>]
```

Installs an app from one APK file, or replaces the installed version of the same app.

| Option | Default | Meaning |
| --- | --- | --- |
| `<apk>` | | Path to an `.apk` file. A relative path is resolved against the current directory. |
| `--device <id>` | see [Device selection](#device-selection) | |

**Output**

```json
{"device":"emulator-5554","path":"/Users/me/app/build/outputs/apk/debug/app-debug.apk"}
```

`path` is the absolute path of the APK, as given (symlinks are not followed). The package name is not reported.

**Errors**

- `INVALID_ARGS`: `'<path>' is not an .apk file`, `no file at '<path>'` or `'<path>' is not a file`. Checked before any device call.
- `INSTALL_FAILED`: Android refused the APK. The message is adb's, and `reason` is Android's code, as in the [example above](#output-and-errors). Codes seen on the emulator: `INSTALL_FAILED_VERSION_DOWNGRADE` (a lower `versionCode` than the installed app), `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (signed with another key), `INSTALL_PARSE_FAILED_NOT_APK`, `INSTALL_FAILED_DEPRECATED_SDK_VERSION` (`targetSdkVersion` below 24 on Android 16).
- A failure without an Android code, such as `Error: device is still booting.`, stays `ADB_FAILED`.
- `ADB_TIMEOUT` after 10 s plus 1 s for every started MB of the APK.
- Plus the [device selection](#device-selection) errors and the adb errors.

**Notes**

- Runs `adb install -r --no-incremental`. Since Android 9 a reinstall replaces the app without `-r`; it stays for older devices. `--no-incremental` matters when an `.idsig` file sits next to the APK (`apksigner` writes one by default): adb would then install incrementally, through a background `adb inc-server` process.
- One `.apk` only. Split APKs, `.apks` and `.aab` are not supported. There is no way to pass `-g` (grant runtime permissions), `-d` (allow a downgrade) or `-t`: an APK marked `testOnly`, which Android Studio's Run button can produce, fails with `INSTALL_FAILED_TEST_ONLY`.
- An 8.5 KB APK took 0.7 s, a 100 MB one 2.5 to 3.4 s.

### launch

```
karagoz launch <package> [--device <id>]
```

Starts an app the way tapping its launcher icon does.

| Option | Default | Meaning |
| --- | --- | --- |
| `<package>` | | The package name, such as `com.android.settings`. |
| `--device <id>` | see [Device selection](#device-selection) | |

**Output**

```json
{"device":"emulator-5554","package":"com.android.settings","activity":"com.android.settings/.homepage.SettingsHomepageActivity"}
```

`activity` is the activity Android reports as started, in its `package/.Class` short form, or `null` when Android names none. It is not always the launcher activity:

- Settings' launcher activity `.Settings` hands off to `.homepage.SettingsHomepageActivity`, and that one is reported.
- If the app's task is already running, it comes to the front as it is, and its top activity is reported, even one from another package. With the Settings search open, `launch com.android.settings` reports `com.google.android.settings.intelligence/.modules.search.activity.SearchActivity`.

**Which activity is started.** Android's own rule for launch intents: the first activity with the `MAIN` action and the `INFO` category, otherwise the first with `MAIN` and `LAUNCHER`. With two launcher activities the first one Android lists is started; no chooser appears.

**Errors**

- `INVALID_ARGS`: `'<value>' is not a package name`. A package name is letters, digits and `_`, in dot-separated parts that each start with a letter. Checked before any device call.
- `APP_NOT_FOUND`: `package 'dev.karagoz.nope' is not installed on emulator-5554`.
- `APP_NOT_LAUNCHABLE`: `package 'com.android.shell' has no launcher activity`.
- `ADB_FAILED`: Android refused the start. The message is Android's `Error:` line, such as `Error: Activity class {com.example/com.example.Main} does not exist.`
- `ADB_TIMEOUT` after 30 s. Android itself gives up after 10 s for a process to start and 10 s for the activity to settle.
- Plus the [device selection](#device-selection) errors and the adb errors.

**Notes**

- Exit `0` means Android started the activity, not that the app is up. An app that crashes at start, and a start with the screen off, also exit `0`. Read the [tree](#ui-tree) to check.
- Nothing is restarted or cleared. For a fresh start, run [`terminate`](#terminate) first.
- A cold start of a small app took 1.7 to 2.0 s.

### terminate

```
karagoz terminate <package> [--device <id>]
```

Stops an app with `am force-stop`: every process of the package is killed before the command returns, and Android removes its alarms, scheduled jobs and notifications.

| Option | Default | Meaning |
| --- | --- | --- |
| `<package>` | | The package name. |
| `--device <id>` | see [Device selection](#device-selection) | |

**Output**

```json
{"device":"emulator-5554","package":"com.android.settings"}
```

An app that is installed but not running gives the same output.

**Errors**

- `INVALID_ARGS`: `'<value>' is not a package name`, as for [`launch`](#launch).
- `APP_NOT_FOUND`: the package is not installed. `am force-stop` alone says nothing in that case, so karagoz checks first.
- `ADB_FAILED`: `am force-stop` printed an error; the message is that error.
- Plus the [device selection](#device-selection) errors and the adb errors.

**Notes**

- Only the package's own processes stop. An activity from another package in the same task stays on screen: after `terminate com.android.settings` with the Settings search open, the search is still in front.
- Took 0.8 to 1.3 s.

### uninstall

```
karagoz uninstall <package> [--device <id>]
```

Removes an app and its data.

| Option | Default | Meaning |
| --- | --- | --- |
| `<package>` | | The package name. |
| `--device <id>` | see [Device selection](#device-selection) | |

**Output**

```json
{"device":"emulator-5554","package":"dev.karagoz.smoke"}
```

**Errors**

- `INVALID_ARGS`: `'<value>' is not a package name`, as for [`launch`](#launch).
- `APP_NOT_FOUND`: the package is not installed. Checked first, because Android answers a missing package with `DELETE_FAILED_INTERNAL_ERROR`, the same code it gives for a package it will not remove.
- `UNINSTALL_FAILED`: Android refused. The message is Android's `Failure [...]` line and `reason` its code, such as `DELETE_FAILED_INTERNAL_ERROR` for a system app with no updates.
- Plus the [device selection](#device-selection) errors and the adb errors.

**Notes**

- A system app with installed updates goes back to its factory version. Android reports that as success, and so does karagoz.
- The app's data is always removed; `adb uninstall -k` (keep data) is not offered.
- Took 0.6 to 0.8 s.

## Scope

karagoz is the primitive layer. Each command does one thing and exits.

- **Not a test framework.** No assertions, no test runner, no recorded flows, no retry policy, no reports. `tap --timeout` waits for a node to appear; it never repeats an action.
- **Not a design comparison tool.** Figma diffing, measurement and reporting belong a layer above. karagoz produces the raw input, and the metadata to measure it with, but does not interpret it.

## Development

```sh
npm run build       # bundle to dist/cli.js
npm run typecheck
npm run lint        # oxlint and the Prettier check; npm run format fixes formatting
```

Each step has one smoke script in `smoke/`. Each builds first and needs a running emulator; the header of each script lists its preconditions:

```sh
sh smoke/1.4-input.sh
```

`smoke/1.5-app-lifecycle.sh` also builds a test APK on every run, from the manifest in `smoke/fixtures/app-lifecycle/`, and installs and removes it as `dev.karagoz.smoke`. No APK is kept in the repository. It needs a JDK (`java` and `keytool` on `PATH`) and, from the Android SDK, build-tools with `aapt2` and `apksigner` plus one platform. The SDK is the first of `$ANDROID_HOME`, `$ANDROID_SDK_ROOT`, `~/Library/Android/sdk` and `~/Android/Sdk` that has both `build-tools/` and `platforms/`. When something is missing the smoke fails and says what, rather than skipping.

## Name

Karagöz is Turkish shadow puppet theatre. Figures are driven with rods from behind a lit screen while the audience watches the movement on the screen. That is what this tool does.

## License

MIT
