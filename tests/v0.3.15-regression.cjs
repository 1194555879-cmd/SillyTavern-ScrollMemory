const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
    const handlers = new Map();
    const eventSource = {
        on(name, handler) {
            const list = handlers.get(name) || [];
            list.push(handler);
            handlers.set(name, list);
        },
        async emit(name, ...args) {
            for (const handler of handlers.get(name) || []) await handler(...args);
        },
    };
    const eventTypes = {
        GENERATION_AFTER_COMMANDS: 'generation-after-commands',
        MESSAGE_EDITED: 'message-edited',
        MESSAGE_DELETED: 'message-deleted',
        MESSAGE_RECEIVED: 'message-received',
        MESSAGE_UPDATED: 'message-updated',
        CHAT_CHANGED: 'chat-changed',
    };
    let saves = 0;
    let ctx = {
        chatId: 'chat-a',
        name1: 'user',
        name2: 'char',
        chat: [],
        extensionSettings: { krystalScrollMemory: { sensitiveAbstraction: false } },
        eventTypes,
        eventSource,
        saveChat: async () => { saves += 1; },
    };
    const nativeFetch = async () => ({ ok: true });
    const sandbox = {
        console,
        URL,
        setTimeout,
        clearTimeout,
        structuredClone,
        fetch: nativeFetch,
        SillyTavern: { getContext: () => ctx },
        __KSM_V0315_TEST_MODE__: true,
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync('prebootstrap.js', 'utf8'), sandbox, {
        filename: 'prebootstrap.js',
    });
    const {
        formatTurn,
        installCaptureGuards,
        installRequestTargetGuard,
        resolveRequestAssistantIndex,
    } = sandbox.__KSM_V0315_TEST__;

    function capture(value) {
        return { short: [value], long: [], facts: [], capturedAt: Date.now() };
    }
    function user(mes) {
        return { is_user: true, is_system: false, mes, extra: {} };
    }
    function assistant(mes, swipes = [mes], swipeId = 0, stored = null) {
        const message = {
            is_user: false,
            is_system: false,
            mes,
            swipes,
            swipe_id: swipeId,
            extra: {},
            swipe_info: swipes.map(() => ({ extra: {} })),
        };
        if (stored) {
            message.extra.krystalScrollMemoryCapture = structuredClone(stored);
            message.swipe_info[swipeId].extra.krystalScrollMemoryCapture = structuredClone(stored);
        }
        return message;
    }
    function requestBody(turn) {
        return {
            messages: [
                { role: 'system', content: '你是独立的剧情记忆整理器' },
                {
                    role: 'user',
                    content: `【本轮对话】\n${turn}\n\n【前文参考，仅用于判断指代，禁止重复总结】\n无`,
                },
            ],
        };
    }

    // Old-floor repair must resolve the old assistant floor, not latest.
    ctx.chat = [
        user('旧用户楼'),
        assistant('旧楼原 swipe', ['旧楼原 swipe', '旧楼当前 swipe'], 1),
        user('最新用户楼'),
        assistant('最新 AI 楼'),
    ];
    const oldRequest = requestBody('【user｜user】\n旧用户楼\n\n【assistant｜char】\n旧楼原 swipe');
    assert.equal(resolveRequestAssistantIndex(oldRequest, ctx), 1);

    // Reroll request resolves the same floor and reads its selected swipe.
    assert.match(formatTurn(ctx, 1), /旧楼当前 swipe/);
    assert.doesNotMatch(formatTurn(ctx, 1), /旧楼原 swipe/);

    // Verify the pre-bootstrap fetch setter makes bootstrap see a truncated chat.
    assert.equal(installRequestTargetGuard(), true);
    let observedChatLength = -1;
    let observedLatest = '';
    sandbox.fetch = async () => {
        const guarded = sandbox.SillyTavern.getContext();
        observedChatLength = guarded.chat.length;
        observedLatest = guarded.chat.at(-1)?.swipes?.[guarded.chat.at(-1)?.swipe_id] || '';
        return { ok: true };
    };
    await sandbox.fetch('/api/backends/chat-completions/generate', {
        body: JSON.stringify(oldRequest),
    });
    assert.equal(observedChatLength, 2);
    assert.equal(observedLatest, '旧楼当前 swipe');

    // Ambiguous/unmatched repair requests suppress the buggy latest-floor fallback.
    observedChatLength = -1;
    await sandbox.fetch('/api/backends/chat-completions/generate', {
        body: JSON.stringify(requestBody('【user｜user】\n不存在\n\n【assistant｜char】\n不存在')),
    });
    assert.equal(observedChatLength, 0);

    assert.equal(installCaptureGuards(), true);

    // Editing a user floor clears the following assistant's stale capture.
    const editStored = capture('编辑前旧 capture');
    const nextAI = assistant('下一条 AI', ['下一条 AI'], 0, editStored);
    ctx.chat = [user('被编辑 user'), nextAI];
    await eventSource.emit(eventTypes.MESSAGE_EDITED, 0);
    assert.equal(nextAI.extra.krystalScrollMemoryCapture, undefined);
    assert.equal(nextAI.swipe_info[0].extra.krystalScrollMemoryCapture, undefined);

    // A replacement AI after the edit cannot inherit a stale capture.
    const inheritedAfterEdit = capture('错误继承');
    nextAI.extra.krystalScrollMemoryCapture = structuredClone(inheritedAfterEdit);
    nextAI.swipe_info[0].extra.krystalScrollMemoryCapture = structuredClone(inheritedAfterEdit);
    await eventSource.emit(eventTypes.MESSAGE_RECEIVED, 1, 'normal');
    assert.equal(nextAI.extra.krystalScrollMemoryCapture, undefined);
    assert.equal(nextAI.swipe_info[0].extra.krystalScrollMemoryCapture, undefined);

    // Delete may be followed by same-chat CHAT_CHANGED; pending invalidation must survive.
    ctx.chat = [user('删楼后剩余 user')];
    await eventSource.emit(eventTypes.MESSAGE_DELETED, 1);
    await eventSource.emit(eventTypes.CHAT_CHANGED);
    const inheritedAfterDelete = capture('删楼后错误继承');
    const newAI = assistant('删楼后的新 AI', ['删楼后的新 AI'], 0, inheritedAfterDelete);
    ctx.chat.push(newAI);
    await eventSource.emit(eventTypes.MESSAGE_RECEIVED, 1, 'normal');
    assert.equal(newAI.extra.krystalScrollMemoryCapture, undefined);
    assert.equal(newAI.swipe_info[0].extra.krystalScrollMemoryCapture, undefined);

    // Reroll invalidates the old selected capture and the replacement once received.
    const rerollStored = capture('重 roll 前 capture');
    const rerollAI = assistant('重 roll 前', ['重 roll 前'], 0, rerollStored);
    ctx.chat = [user('重 roll user'), rerollAI];
    await eventSource.emit(eventTypes.GENERATION_AFTER_COMMANDS, 'regenerate', {}, false);
    assert.equal(rerollAI.extra.krystalScrollMemoryCapture, undefined);
    const staleReplacement = capture('重 roll 错误继承');
    rerollAI.extra.krystalScrollMemoryCapture = structuredClone(staleReplacement);
    rerollAI.swipe_info[0].extra.krystalScrollMemoryCapture = structuredClone(staleReplacement);
    await eventSource.emit(eventTypes.MESSAGE_RECEIVED, 1, 'regenerate');
    assert.equal(rerollAI.extra.krystalScrollMemoryCapture, undefined);
    assert.ok(saves >= 5, 'invalidations should be persisted');

    console.log('v0.3.15 regression tests passed');
})();
