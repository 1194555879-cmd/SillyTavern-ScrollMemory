const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('ui-layout.js', 'utf8');
const nodes = new Map();

class Element {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.textContent = '';
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.className = '';
    this.clickCount = 0;
  }
  getAttribute(key) { return this.attrs[key] ?? null; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  querySelector() { return null; }
  click() { this.clickCount += 1; }
  remove() { nodes.delete(this.id); }
}

const ignore = new Element('ksm-wand-ignore-last');
const launcherToggle = new Element('ksm-wand-launcher-toggle');
launcherToggle.setAttribute('aria-pressed', 'true');
const launcher = new Element('ksm-launcher');
launcher.style.display = '';
const panelLeafA = new Element();
panelLeafA.textContent = 'Memory archive · v0.3.17';
const panelLeafB = new Element();
panelLeafB.textContent = '当前 v0.3.18 · 已是最新版本';

const document = {
  getElementById(id) { return nodes.get(id) || null; },
  querySelectorAll(selector) {
    return selector === '#ksm-panel *' ? [panelLeafA, panelLeafB] : [];
  },
};
nodes.set(ignore.id, ignore);
nodes.set(launcherToggle.id, launcherToggle);
nodes.set(launcher.id, launcher);

const sandbox = {
  console,
  document,
  globalThis: null,
  __KSM_V0319_TEST_MODE__: true,
  setTimeout,
  queueMicrotask,
};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'ui-layout.js' });

const api = sandbox.__KSM_V0319_TEST__;
assert(api, 'test API should be exposed');
assert.strictEqual(api.detachSecondaryWandItems(), true);
assert.strictEqual(document.getElementById(ignore.id), null, 'ignore action must leave the wand menu DOM');
assert.strictEqual(document.getElementById(launcherToggle.id), null, 'launcher action must leave the wand menu DOM');
assert.strictEqual(api.wandItem('ignore'), ignore, 'detached ignore control must remain callable');
assert.strictEqual(api.wandItem('launcher'), launcherToggle, 'detached launcher control must remain callable');
api.triggerWandAction('ignore');
api.triggerWandAction('launcher');
assert.strictEqual(ignore.clickCount, 1, 'panel ignore action must trigger original handler control');
assert.strictEqual(launcherToggle.clickCount, 1, 'panel launcher action must trigger original handler control');
assert.strictEqual(api.launcherVisible(), true);
launcher.style.display = 'none';
assert.strictEqual(api.launcherVisible(), false, 'launcher state must use the real floating button after detach');
api.patchVersionText();
assert.strictEqual(panelLeafA.textContent, 'Memory archive · v0.3.19');
assert.strictEqual(panelLeafB.textContent, '当前 v0.3.19 · 已是最新版本');
assert.strictEqual(api.setTextIfChanged(panelLeafA, panelLeafA.textContent), false);

console.log('v0.3.19 UI layout tests passed');
