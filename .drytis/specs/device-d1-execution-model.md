# Phase D1 — Execution Type Model & Catalog Metadata

## Goal
Strict execution vocabulary and complete device/environment metadata everywhere.

## Changes
- Rename `VIRTUALIZED` → `VIRTUAL_DEVICE` across `server/deviceRuntime/provider.js`, manager, providers, UI (`deviceRuntimeUi.js`), DB values where stored (`runtime_facts`, artifacts, runs). Accept legacy value on read (map to VIRTUAL_DEVICE), never emit it.
- Ensure every environment/catalog row exposes the full field set: execution_type, device_id, device_manufacturer, device_model, hardware_identifier, os, os_version, browser, browser_version, resolution, device_pixel_ratio, orientation, touch_support, camera_support, microphone_support, screen_capture_support, gps_support, network_profile, availability, runtime_session_id, runtime_status, last_tested, last_result. Add DB columns/migration for any missing (DPR, hardware_identifier, network_profile, last_tested/last_result).
- API responses (`/api/environments`, `/api/devices`, `/api/device-runtime/*`, `/api/catalog/*`) return these fields; no provider-specific keys.

## Files
server/deviceRuntime/*, server/postgres/migrations/0XX_execution_metadata.sql, server/postgres/deviceCatalogRepository.js, server/environmentService.js, public/deviceRuntimeUi.js, public/deviceMatrixView.js

## Acceptance
- [ ] Every environment in the UI/API shows one of exactly REAL DEVICE / VIRTUAL DEVICE / SIMULATED
- [ ] No `VIRTUALIZED` string appears in any API response or UI text
- [ ] Environment detail shows all metadata fields listed above

## Tests
- Unit: level rename mapping, metadata completeness for one Apple, one Android, one Windows env.
