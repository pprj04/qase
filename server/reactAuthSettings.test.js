import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('phase 3: auth gate covers login/register/pilot/show-password', () => {
  const gate = read('src/components/AuthGate.tsx');
  // endpoints via authStore
  const store = read('src/state/authStore.tsx');
  assert.match(store, /\/auth\/login/);
  assert.match(store, /\/auth\/register/);
  assert.match(store, /\/auth\/logout/);
  assert.match(store, /\/auth\/me/);
  assert.match(store, /\/pilot-status/);
  // 404 → unavailable (legacy embedded-host fallback)
  assert.match(store, /code === 404/);
  assert.match(store, /'unavailable'/);
  // login/register must flip status to signed-in so the gate clears in place
  assert.match(store, /setStatus\('signed-in'\)/);
  // gate mechanics
  assert.match(gate, /auth-show-password/);
  assert.match(gate, /auth-invite/);
  assert.match(gate, /new-password/);
  assert.match(gate, /current-password/);
  assert.match(gate, /minLength=\{registerMode \? 12 : 1\}/);
  assert.match(gate, /I already have an account/);
  assert.match(gate, /Create an account/);
  // error surfaced with role=alert
  assert.match(gate, /role="alert"/);
});

test('phase 3: settings dialog — no datalist, custom model escape hatch', () => {
  const settings = read('src/components/SettingsDialog.tsx');
  assert.ok(!/<datalist[\s>]/i.test(settings), 'no datalist element (modelSelectorUi constraint)');
  assert.match(settings, /Custom model ID…/);
  assert.match(settings, /z-ai\/glm-5\.2/);
  assert.match(settings, /CUSTOM_MODEL_VALUE/);
  assert.match(settings, /BASE_URL_REQUIRED/);
  assert.match(settings, /azureOpenAI/);
  // API key never pre-filled; leave-blank-to-keep semantics
  assert.match(settings, /leave blank to keep/);
  assert.ok(!/value=\{.*apiKeyHint/.test(settings), 'key hint never echoed as value');
  // probe + save use the same endpoints as legacy
  assert.match(settings, /\/config\/test/);
  assert.match(settings, /api<ModelConfig.*>\('\/config',/);
  // runsKeepingOldSettings toast parity
  assert.match(settings, /run\(s\) already going keep the old settings/);
});

test('phase 3: profile dialog — memory CRUD + password change', () => {
  const profile = read('src/components/ProfileDialog.tsx');
  assert.match(profile, /\/profile/);
  assert.match(profile, /\/memory/);
  assert.match(profile, /method: 'DELETE'/);
  assert.match(profile, /\/auth\/password/);
  assert.match(profile, /minLength=\{12\}/);
  assert.match(profile, /No saved memory yet/);
});

test('phase 3: toast system parity with legacy lifetimes', () => {
  const toasts = read('src/state/toastStore.tsx');
  assert.match(toasts, /kind === 'bad' \? 6000 : 3600/);
  assert.match(toasts, /role=\{item\.kind === 'bad' \? 'alert' : 'status'\}/);
});

test('phase 3: app wires auth + toasts + dialogs', () => {
  const app = read('src/App.tsx');
  assert.match(app, /<AuthProvider>/);
  assert.match(app, /<ToastProvider>/);
  assert.match(app, /<AuthGate \/>/);
  assert.match(app, /<SettingsDialog/);
  assert.match(app, /<ProfileDialog/);
  assert.match(app, /open-settings/);
  assert.match(app, /open-profile/);
  assert.match(app, /sign-out/);
});
