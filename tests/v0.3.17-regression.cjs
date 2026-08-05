const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('entry.js', 'utf8');
const sandbox = {
  console,
  URL,
  Headers,
  Response,
  Request,
  Promise,
  Date,
  Math,
  JSON,
  String,
  Number,
  Boolean,
  Array,
  Set,
  Map,
  RegExp,
  Object,
  Reflect,
  globalThis: null,
  __KSM_V0317_TEST_MODE__: true,
  setTimeout,
  clearTimeout,
};
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: 'entry.js' });
const api = sandbox.__KSM_V0317_TEST__;
assert(api, 'test API should be exposed');

function capture(label) {
  return { short: [label], long: [], facts: [] };
}

function assistant(mes, swipes, swipeId, stored = null) {
  const message = {
    is_user: false,
    is_system: false,
    name: '角色',
    mes,
    swipes,
    swipe_id: swipeId,
    extra: {},
    swipe_info: swipes.map(() => ({ extra: {} })),
  };
  if (stored) {
    message.extra.krystalScrollMemoryCapture = stored;
    message.swipe_info[swipeId].extra.krystalScrollMemoryCapture = stored;
  }
  return message;
}

const chat = [
  { is_user: true, is_system: false, name: '用户', mes: '第一问' },
  assistant('旧回复A', ['旧回复A', '旧回复B'], 1),
  { is_user: true, is_system: false, name: '用户', mes: '第二问' },
  assistant('最新回复', ['最新回复'], 0),
];
const ctx = {
  chat,
  name1: '用户',
  name2: '角色',
  extensionSettings: { krystalScrollMemory: { sensitiveAbstraction: false } },
};

const oldTurnUsingSwipeA = api.formatTurn(ctx, 1, '旧回复A');
const body = {
  messages: [
    { role: 'system', content: '你是独立的剧情记忆整理器' },
    { role: 'user', content: `【本轮对话】\n${oldTurnUsingSwipeA}\n\n【前文参考】\n无` },
  ],
};
assert.strictEqual(api.resolveRequestAssistantIndex(body, ctx), 1, 'old-floor repair must resolve old assistant floor');
const rewritten = api.rewriteMemoryRequest(body, ctx);
const rewrittenText = rewritten.messages[1].content;
assert(rewrittenText.includes('旧回复B'), 'rewrite must use currently selected swipe');
assert(!rewrittenText.includes('最新回复'), 'rewrite must never substitute latest floor');

const unmatched = {
  messages: [
    { role: 'system', content: '你是独立的剧情记忆整理器' },
    { role: 'user', content: '【本轮对话】\n完全无法匹配\n\n【前文参考】\n无' },
  ],
};
assert.deepStrictEqual(api.rewriteMemoryRequest(unmatched, ctx), unmatched, 'unmatched request must remain unchanged');

const stored = capture('old');
const currentOnly = assistant('A', ['A', 'B'], 1, stored);
currentOnly.swipe_info[0].extra.krystalScrollMemoryCapture = capture('preserve');
assert.strictEqual(api.clearMessageCapture(currentOnly, false), true);
assert.strictEqual(currentOnly.extra.krystalScrollMemoryCapture, undefined);
assert.strictEqual(currentOnly.swipe_info[1].extra.krystalScrollMemoryCapture, undefined);
assert(currentOnly.swipe_info[0].extra.krystalScrollMemoryCapture, 'reroll must preserve other swipe capture');

const all = assistant('A', ['A', 'B'], 0, stored);
all.swipe_info[1].extra.krystalScrollMemoryCapture = capture('stale');
api.clearMessageCapture(all, true);
assert.strictEqual(all.extra.krystalScrollMemoryCapture, undefined);
assert.strictEqual(all.swipe_info[0].extra.krystalScrollMemoryCapture, undefined);
assert.strictEqual(all.swipe_info[1].extra.krystalScrollMemoryCapture, undefined, 'user edit must clear all next-AI swipe captures');

const handlers = new Map();
const emitted = [];
let saveCount = 0;
const guardedChat = [
  { is_user: true, is_system: false, mes: 'edited user' },
  assistant('AI', ['AI', 'AI alt'], 0, capture('stale')),
];
guardedChat[1].swipe_info[1].extra.krystalScrollMemoryCapture = capture('stale alt');
const guardedCtx = {
  chatId: 'chat-1',
  chat: guardedChat,
  eventTypes: {
    GENERATION_AFTER_COMMANDS: 'gen',
    MESSAGE_EDITED: 'edit',
    MESSAGE_DELETED: 'delete',
    MESSAGE_RECEIVED: 'received',
    CHAT_CHANGED: 'chatChanged',
    MESSAGE_UPDATED: 'updated',
  },
  eventSource: {
    on(name, fn) { handlers.set(name, fn); },
    emit(name, index) { emitted.push([name, index]); return Promise.resolve(); },
  },
  saveChat() { saveCount += 1; return Promise.resolve(); },
  extensionSettings: { krystalScrollMemory: {} },
};
sandbox.SillyTavern = { getContext: () => guardedCtx };
assert.strictEqual(api.installCaptureGuards(), true);
handlers.get('edit')(0);
assert.strictEqual(guardedChat[1].extra.krystalScrollMemoryCapture, undefined, 'editing user must clear next AI capture');
assert.strictEqual(guardedChat[1].swipe_info[1].extra.krystalScrollMemoryCapture, undefined, 'editing user must clear stale alternate swipes');

guardedChat[1].extra.krystalScrollMemoryCapture = capture('replacement inherited');
guardedChat[1].swipe_info[0].extra.krystalScrollMemoryCapture = capture('replacement inherited');
handlers.get('received')(1, 'normal');
assert.strictEqual(guardedChat[1].extra.krystalScrollMemoryCapture, undefined);
assert.strictEqual(guardedChat[1].swipe_info[0].extra.krystalScrollMemoryCapture, undefined);

handlers.get('delete')();
handlers.get('chatChanged')();
guardedChat.push(assistant('new AI', ['new AI'], 0, capture('inherited')));
handlers.get('received')(2, 'normal');
assert.strictEqual(guardedChat[2].extra.krystalScrollMemoryCapture, undefined, 'new floor after delete must not inherit capture');

guardedChat[2].swipes = ['old', 'new'];
guardedChat[2].swipe_info = [
  { extra: { krystalScrollMemoryCapture: capture('old preserved') } },
  { extra: { krystalScrollMemoryCapture: capture('current stale') } },
];
guardedChat[2].swipe_id = 1;
guardedChat[2].extra.krystalScrollMemoryCapture = capture('current stale');
handlers.get('gen')('swipe', {}, false);
assert.strictEqual(guardedChat[2].extra.krystalScrollMemoryCapture, undefined);
assert.strictEqual(guardedChat[2].swipe_info[1].extra.krystalScrollMemoryCapture, undefined);
assert(guardedChat[2].swipe_info[0].extra.krystalScrollMemoryCapture, 'old swipe capture should survive reroll');
guardedChat[2].extra.krystalScrollMemoryCapture = capture('replacement inherited');
guardedChat[2].swipe_info[1].extra.krystalScrollMemoryCapture = capture('replacement inherited');
handlers.get('received')(2, 'swipe');
assert.strictEqual(guardedChat[2].extra.krystalScrollMemoryCapture, undefined);
assert.strictEqual(guardedChat[2].swipe_info[1].extra.krystalScrollMemoryCapture, undefined);

assert(saveCount >= 4, 'capture invalidations must persist');
assert(emitted.some(([name]) => name === 'updated'), 'capture invalidations must emit message update');

const leaf = { textContent: 'same' };
assert.strictEqual(api.setTextIfChanged(leaf, 'same'), false, 'same UI text must not write and retrigger observer');
assert.strictEqual(api.setTextIfChanged(leaf, 'new'), true);
assert.strictEqual(leaf.textContent, 'new');

console.log('v0.3.17 regression tests passed');
