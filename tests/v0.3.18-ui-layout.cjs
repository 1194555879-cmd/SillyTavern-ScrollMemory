const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('ui-layout.js', 'utf8');

class Element {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.textContent = '';
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.className = '';
  }
  getAttribute(key) { return this.attrs[key] ?? null; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  querySelector() { return null; }
}

const nodes = new Map();
const ignore = new Element('ksm-wand-ignore-last');
const launcherToggle = new Element('ksm-wand-launcher-toggle');
launcherToggle.setAttribute('aria-pressed', 'true');
const panelLeaf = new Element();
panelLeaf.textContent = 'Memory archive · v0.3.17';

const document = {
  getElementById(id) { return nodes.get(id) || null; },
  querySelectorAll(selector) { return selector === '#ksm-panel *' ? [panelLeaf] : []; },
};
nodes.set(ignore.id, ignore);
nodes.set(launcherToggle.id, launcherToggle);

const sandbox = {
  console,
  document,
  globalThis: null,
  __KSM_V0318_TEST_MODE__: true,
};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'ui-layout.js' });

const api = sandbox.__KSM_V0318_TEST__;
assert(api, 'test API should be exposed');
api.tidyWandMenu();
assert.strictEqual(ignore.hidden, true);
assert.strictEqual(launcherToggle.hidden, true);
assert.strictEqual(api.launcherVisible(), true);
launcherToggle.setAttribute('aria-pressed', 'false');
assert.strictEqual(api.launcherVisible(), false);
api.patchVersionText();
assert.strictEqual(panelLeaf.textContent, 'Memory archive · v0.3.18');
assert.strictEqual(api.setTextIfChanged(panelLeaf, panelLeaf.textContent), false);

console.log('v0.3.18 UI layout tests passed');
