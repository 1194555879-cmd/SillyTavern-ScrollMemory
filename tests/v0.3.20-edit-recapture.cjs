const assert = require('node:assert/strict');
const fs = require('node:fs');

const core = fs.readFileSync('index.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const entry = fs.readFileSync('entry.js', 'utf8');
const layout = fs.readFileSync('ui-layout.js', 'utf8');

assert.equal(manifest.version, '0.3.21');
assert.match(entry, /const COMPAT_VERSION = '0\.3\.21'/);
assert.match(layout, /const COMPAT_VERSION = '0\.3\.21'/);
assert.doesNotMatch(entry, /REMOTE_MANIFEST_PART/);
assert.match(core, /function currentPluginVersion\(\)/);
assert.match(core, /isNewerVersion\(latest, current\)/);
assert.match(core, /function missingCaptureIndices\(\)/);
assert.match(core, /async function backfillMissingCaptures\(\)/);
assert.match(core, /data-action="backfill-missing"/);
assert.match(core, /reason: 'backfill'/);
assert.match(core, /补建已暂停/);

const editHandler = core.match(
    /if \(events\.MESSAGE_EDITED\) \{[\s\S]*?\n    \}\n    if \(events\.MORE_MESSAGES_LOADED\)/,
)?.[0] || '';
assert.match(editHandler, /clearStoredCapture\(message\)/, 'edited AI capture must be invalidated');
assert.match(
    editHandler,
    /scheduleProfileCapture\(numericIndex, 'edit', EDIT_RECAPTURE_DELAY\)/,
    'edited AI floor must be automatically queued after the debounce',
);
assert.match(editHandler, /等待内容稳定后自动重新总结/);

const discardGuard = core.match(
    /const latest = context\(\);[\s\S]*?return false;\n        \}\n\n        const capture = captureFromApiResponse/,
)?.[0] || '';
assert.match(discardGuard, /canRecaptureCurrentVersion/);
assert.match(
    discardGuard,
    /scheduleProfileCapture\(messageIndex, 'content-change', EDIT_RECAPTURE_DELAY\)/,
    'a stale in-flight result must queue the current final content',
);

assert.match(core, /'edit',\n            'content-change'/, 'edit recaptures must force replacement');

console.log('v0.3.20 edit recapture regression tests passed');
