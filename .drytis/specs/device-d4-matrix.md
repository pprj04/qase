# Phase D4 — Device & Environment Matrix (cross-platform, honest states)

## Goal
Replace Apple-only matrix with Device & Environment Matrix: ALL / APPLE / ANDROID / WINDOWS.

## Changes
- Rename all "Apple Device Matrix" UI copy to "Device & Environment Matrix" (`deviceMatrixView.js`, drawer, docs/help).
- Catalog: Apple (iPhone, iPad incl. mini/Air/Pro 11/Pro 13, Mac), Android (Samsung, Google Pixel, OnePlus, Motorola, Xiaomi, Redmi, OPPO, Vivo, Realme, Nothing, Android tablets), Windows (Windows 10, Windows 11). Each device tagged PHONE / TABLET / DESKTOP.
- Matrix columns: Device, Manufacturer, Model, OS, OS Version, Browser, Browser Version, Resolution, Orientation, Execution, Capabilities, Availability, Last Tested, Last Result.
- Availability semantics: NOT SUPPORTED (combination cannot execute), NOT AVAILABLE (supported, runtime not connected), NOT TESTED (supported, never run), TESTED (has result). Never hide a browser that cannot execute — show why.
- iOS engine honesty: on iOS, browsers other than Safari are represented with their true engine capability (WebKit-based), each with Supported/Not supported/Not available/Not tested — no fake independent-engine combinations.

## Files
server/environmentCatalog.js, server/deviceCatalogSeed.js, migrations, public/deviceMatrixView.js, public/deviceDrawer.js, public/deviceRuntimeUi.js.

## Acceptance
- [ ] Matrix titled "Device & Environment Matrix" with ALL/APPLE/ANDROID/WINDOWS tabs
- [ ] All listed manufacturers present; each device labeled PHONE/TABLET/DESKTOP
- [ ] All 14 matrix columns render; unavailable devices show NOT AVAILABLE, unsupported combos NOT SUPPORTED, never silently removed
- [ ] Tablets listed separately (iPad mini/Air/Pro 11/Pro 13 + Android tablets)

## Tests
Unit: catalog coverage + support-state classification. E2E: tabs filter correctly; unsupported combo shows NOT SUPPORTED.
