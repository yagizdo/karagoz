# Karagöz

Device automation for mobile apps. One tool, four targets: Android emulator, Android physical device, iOS simulator, iOS physical device. Works as a CLI, and as an MCP server when you want an AI agent driving it.

> **Status: early development.** Nothing works yet. The design is settled, the code is not written.

## What it does

Drive a device, observe the screen, touch it, capture what you see.

```
devices                       list and select a device
screenshot                    full resolution, with scale metadata
ui-tree                       accessibility tree, elements and bounding boxes
tap / swipe / text / key      interaction
install / launch / terminate  app lifecycle
logs                          device logs
```

Same commands across all four targets. One interface, four drivers.

## What it is not

- **Not a test framework.** No assertions, no test runner, no recorded flows, no retry policy, no reports.
- **Not a design comparison tool.** Figma diffing, measurement and reporting belong a layer above. Karagöz produces the raw input; it does not interpret it.

It is the primitive layer. Each command does one thing and exits.

## Name

Karagöz is Turkish shadow puppet theatre. Figures are driven with rods from behind a lit screen while the audience watches the movement on the screen. That is what this tool does.

## Targets

| Target | Transport |
| --- | --- |
| Android emulator | `adb` |
| Android device | `adb` over USB or Wi-Fi |
| iOS simulator | `xcrun simctl` plus an accessibility bridge |
| iOS device | tunnel plus WebDriverAgent / XCTest |

Android comes first, iOS follows.

## Requirements

Node 22 or newer. Platform tools are detected at runtime, not bundled: `adb` for Android, Xcode command line tools for iOS.

## License

MIT
