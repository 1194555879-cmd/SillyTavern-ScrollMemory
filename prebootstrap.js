/**
 * Krystal Scroll Memory v0.3.15 pre-bootstrap regression guards.
 *
 * This entry point runs before bootstrap.js so a memory request can be tied
 * back to the assistant floor it was built from. It also preserves stale
 * capture invalidation across user edits, rerolls and floor deletion.
 */

const MEMORY_ENDPOINT = '/api/backends/chat-completions/generate';
const MESSAGE_META_KEY = 'krystalScrollMemoryCapture';
const SETTINGS_KEY = 'krystalScrollMemory';
const MEMORY_BLOCK_RE = /【长期记忆条目】[\s\S]*?【长期记忆完】|【记忆条目】[\s\S]*?【记忆完】|【细节记忆】[\s\S]*?【细节记忆完】/g;

let activeRequestTarget = null;
let pendingAssistantCaptureInvalidation = null;
let requestGuardInstalled = false;
let captureGuardsInstalled = false;

function rawContext() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input?.url || '';
}

function parseRequestBody(init) {
    if (typeof init?.body !== 'string') return null;
    try {
        return JSON.parse(init.body);
    } catch {
        return null;
    }
}

function isMemoryCaptureRequest(url, body) {
    if (!String(url).includes(MEMORY_ENDPOINT) || !body || !Array.isArray(body.messages)) return false;
    return body.messages.some(message => {
        const content = String(message?.content || '');
        return content.includes('你是独立的剧情记忆整理器')
            || content.includes('【记忆总结要求】')
            || content.includes('【待归档短期记忆】');
    });
}

function selectedMessageText(message) {
    const swipeId = Number(message?.swipe_id);
    const swipeText = Number.isInteger(swipeId) && Array.isArray(message?.swipes)
        ? message.swipes[swipeId]
        : undefined;
    return typeof swipeText === 'string' ? swipeText : String(message?.mes || '');
}

function stripMemoryBlocks(text) {
    MEMORY_BLOCK_RE.lastIndex = 0;
    return String(text || '').replace(MEMORY_BLOCK_RE, '').trim();
}

function abstractSensitiveSource(value) {
    let text = String(value || '');
    const sensitivePattern = /(性行为|性爱|亲热|做爱|性交|插入|抽插|射精|内射|射入|射了|高潮|阴茎|龟头|阴道|阴蒂|乳头|精液|爱液|口交|肛交|自慰|勃起|湿透|体液|下体|性器官|肉棒|阳具|蜜穴|花穴|后穴|淫液|深喉|舔舐|吮吸|含弄|吞咽|抽送|挺入|顶入|泄出|orgasm|cum|ejaculat|blowjob|handjob|penetrat|cock|dick|pussy|anal sex|oral sex|fuck)/i;
    if (!sensitivePattern.test(text)) return text;
    const replacements = [
        [/(内射|射入(?:体内|里面)?|射在(?:体内|里面))/gi, '亲密行为结束且存在体内遗留风险'],
        [/(射精|射了|高潮|泄出|orgasm|ejaculat(?:e|ed|ion)?|\bcum\b)/gi, '达到高潮'],
        [/(插入|抽插|性交|做爱|性行为|性爱|penetrat(?:e|ed|ion)?|\bfuck(?:ing|ed)?\b)/gi, '发生亲密行为'],
        [/(口交|肛交|自慰|深喉|blowjob|handjob|anal sex|oral sex)/gi, '特定亲密行为'],
        [/(阴茎|龟头|阴道|阴蒂|乳头|下体|性器官|肉棒|阳具|蜜穴|花穴|后穴|cock|dick|pussy)/gi, '私密部位'],
        [/(精液|爱液|淫液|体液)/gi, '身体分泌物'],
        [/(勃起|湿透)/gi, '出现明确生理反应'],
        [/(舔舐|吮吸|含弄|吞咽|抽送|挺入|顶入)/gi, '进行亲密接触'],
    ];
    for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
    return text;
}

function normalizeTurnText(value) {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function pluginSettings(ctx) {
    return ctx?.extensionSettings?.[SETTINGS_KEY] || {};
}

function messageSpeaker(ctx, message) {
    if (message?.name) return message.name;
    return message?.is_user ? (ctx?.name1 || 'user') : (ctx?.name2 || 'char');
}

function turnStartIndex(chat, assistantIndex) {
    let turnStart = 0;
    for (let index = assistantIndex - 1; index >= 0; index--) {
        const candidate = chat[index];
        if (candidate && !candidate.is_user && !candidate.is_system) {
            turnStart = index + 1;
            break;
        }
    }
    return turnStart;
}

function formatTurn(ctx, assistantIndex, assistantText) {
    const chat = ctx?.chat;
    if (!Array.isArray(chat) || !chat[assistantIndex]) return '';
    const turnStart = turnStartIndex(chat, assistantIndex);
    const sensitive = pluginSettings(ctx).sensitiveAbstraction !== false;
    return chat
        .slice(turnStart, assistantIndex + 1)
        .filter(message => message && !message.is_system)
        .map((message, offset) => {
            const messageIndex = turnStart + offset;
            const role = message.is_user ? 'user' : 'assistant';
            const sourceText = messageIndex === assistantIndex && typeof assistantText === 'string'
                ? assistantText
                : selectedMessageText(message);
            const source = stripMemoryBlocks(sourceText).slice(-16000);
            const content = sensitive ? abstractSensitiveSource(source) : source;
            return `【${role}｜${messageSpeaker(ctx, message)}】\n${content}`;
        })
        .join('\n\n');
}

function requestCurrentTurn(body) {
    for (const message of body?.messages || []) {
        if (message?.role !== 'user') continue;
        const match = String(message.content || '').match(
            /【本轮对话】\n([\s\S]*?)\n\n【前文参考/,
        );
        if (match) return normalizeTurnText(match[1]);
    }
    return '';
}

function assistantSourceVariants(message) {
    const variants = [String(message?.mes || ''), selectedMessageText(message)];
    if (Array.isArray(message?.swipes)) variants.push(...message.swipes);
    return [...new Set(variants.filter(value => typeof value === 'string'))];
}

function requestedAssistantText(turnText) {
    const matches = [...String(turnText || '').matchAll(
        /【assistant｜[^】]+】\n([\s\S]*?)(?=\n\n【(?:user|assistant)｜|$)/g,
    )];
    return normalizeTurnText(matches.at(-1)?.[1] || '');
}

function normalizedAssistantSource(ctx, value) {
    const sensitive = pluginSettings(ctx).sensitiveAbstraction !== false;
    const source = stripMemoryBlocks(value).slice(-16000);
    return normalizeTurnText(sensitive ? abstractSensitiveSource(source) : source);
}

function resolveRequestAssistantIndex(body, ctx = rawContext()) {
    const requestedTurn = requestCurrentTurn(body);
    if (!Array.isArray(ctx?.chat) || !requestedTurn || requestedTurn === '无') return -1;

    const exactMatches = new Set();
    for (let index = 0; index < ctx.chat.length; index++) {
        const message = ctx.chat[index];
        if (!message || message.is_user || message.is_system) continue;
        for (const variant of assistantSourceVariants(message)) {
            if (normalizeTurnText(formatTurn(ctx, index, variant)) === requestedTurn) {
                exactMatches.add(index);
            }
        }
    }
    if (exactMatches.size === 1) return [...exactMatches][0];
    if (exactMatches.size > 1) return -1;

    const requestedAssistant = requestedAssistantText(requestedTurn);
    if (!requestedAssistant) return -1;
    const sourceMatches = new Set();
    for (let index = 0; index < ctx.chat.length; index++) {
        const message = ctx.chat[index];
        if (!message || message.is_user || message.is_system) continue;
        if (assistantSourceVariants(message).some(
            variant => normalizedAssistantSource(ctx, variant) === requestedAssistant,
        )) {
            sourceMatches.add(index);
        }
    }
    return sourceMatches.size === 1 ? [...sourceMatches][0] : -1;
}

function contextForTarget(ctx, targetIndex) {
    if (!ctx || targetIndex === null) return ctx;
    const chat = targetIndex >= 0 && Array.isArray(ctx.chat)
        ? ctx.chat.slice(0, targetIndex + 1)
        : [];
    return new Proxy(ctx, {
        get(target, property) {
            if (property === 'chat') return chat;
            return Reflect.get(target, property, target);
        },
    });
}

function installRequestTargetGuard() {
    if (requestGuardInstalled || globalThis.__KSM_V0315_REQUEST_TARGET_GUARD__) return true;
    const sillyTavern = globalThis.SillyTavern;
    if (!sillyTavern?.getContext || typeof globalThis.fetch !== 'function') return false;

    const originalGetContext = sillyTavern.getContext.bind(sillyTavern);
    const guardedGetContext = () => contextForTarget(originalGetContext(), activeRequestTarget);
    try {
        sillyTavern.getContext = guardedGetContext;
    } catch {
        Object.defineProperty(sillyTavern, 'getContext', {
            configurable: true,
            value: guardedGetContext,
        });
    }

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    let currentFetch = globalThis.fetch;
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() {
            return currentFetch;
        },
        set(nextFetch) {
            if (typeof nextFetch !== 'function') {
                currentFetch = nextFetch;
                return;
            }
            currentFetch = function guardedFetch(input, init = {}) {
                const body = parseRequestBody(init);
                if (!isMemoryCaptureRequest(requestUrl(input), body)) {
                    return nextFetch.call(this, input, init);
                }
                const ctx = originalGetContext();
                activeRequestTarget = resolveRequestAssistantIndex(body, ctx);
                try {
                    return nextFetch.call(this, input, init);
                } finally {
                    activeRequestTarget = null;
                }
            };
        },
    });

    globalThis.__KSM_V0315_REQUEST_TARGET_GUARD__ = true;
    requestGuardInstalled = true;
    return true;
}

function chatIdentity(ctx = rawContext()) {
    return String(ctx?.chatId ?? ctx?.chat_id ?? '');
}

function latestAssistantMessageIndex(ctx = rawContext()) {
    if (!Array.isArray(ctx?.chat)) return -1;
    for (let index = ctx.chat.length - 1; index >= 0; index--) {
        const message = ctx.chat[index];
        if (message && !message.is_user && !message.is_system) return index;
    }
    return -1;
}

function resolveAssistantMessageIndex(messageIndex, ctx = rawContext()) {
    const numeric = Number(messageIndex);
    if (Number.isInteger(numeric)) {
        const candidate = ctx?.chat?.[numeric];
        if (candidate && !candidate.is_user && !candidate.is_system) return numeric;
    }
    return latestAssistantMessageIndex(ctx);
}

function nextAssistantMessageIndex(userIndex, ctx = rawContext()) {
    if (!Array.isArray(ctx?.chat)) return -1;
    for (let index = Number(userIndex) + 1; index < ctx.chat.length; index++) {
        const message = ctx.chat[index];
        if (!message) continue;
        if (message.is_user) break;
        if (!message.is_system) return index;
    }
    return -1;
}

function clearMessageCapture(message) {
    if (!message) return false;
    let changed = false;
    if (message.extra?.[MESSAGE_META_KEY]) {
        delete message.extra[MESSAGE_META_KEY];
        changed = true;
    }
    const swipeId = Number(message.swipe_id);
    if (Number.isInteger(swipeId) && message.swipe_info?.[swipeId]?.extra?.[MESSAGE_META_KEY]) {
        delete message.swipe_info[swipeId].extra[MESSAGE_META_KEY];
        changed = true;
    }
    return changed;
}

function persistCaptureInvalidation(index) {
    const ctx = rawContext();
    const changed = clearMessageCapture(ctx?.chat?.[index]);
    if (!changed) return false;
    const events = ctx?.eventTypes || ctx?.event_types;
    if (events?.MESSAGE_UPDATED && typeof ctx?.eventSource?.emit === 'function') {
        void ctx.eventSource.emit(events.MESSAGE_UPDATED, index).catch?.(() => null);
    }
    void ctx?.saveChat?.().catch?.(() => null);
    return true;
}

function armAssistantCaptureInvalidation(reason) {
    pendingAssistantCaptureInvalidation = {
        chatId: chatIdentity(),
        reason: String(reason || 'unknown'),
    };
}

function installCaptureGuards() {
    if (captureGuardsInstalled || globalThis.__KSM_V0315_CAPTURE_GUARDS__) return true;
    const ctx = rawContext();
    const events = ctx?.eventTypes || ctx?.event_types;
    if (!ctx?.eventSource || !events) return false;

    if (events.GENERATION_AFTER_COMMANDS) {
        ctx.eventSource.on(events.GENERATION_AFTER_COMMANDS, (generationType, _options, dryRun) => {
            if (dryRun || !['swipe', 'regenerate'].includes(String(generationType))) return;
            const index = latestAssistantMessageIndex();
            if (index >= 0) persistCaptureInvalidation(index);
            armAssistantCaptureInvalidation(generationType);
        });
    }

    if (events.MESSAGE_EDITED) {
        ctx.eventSource.on(events.MESSAGE_EDITED, messageIndex => {
            const current = rawContext();
            const index = Number(messageIndex);
            const edited = current?.chat?.[index];
            const target = edited?.is_user ? nextAssistantMessageIndex(index, current) : index;
            if (target >= 0) persistCaptureInvalidation(target);
            if (edited?.is_user) armAssistantCaptureInvalidation('user-edit');
        });
    }

    if (events.MESSAGE_DELETED) {
        ctx.eventSource.on(events.MESSAGE_DELETED, () => {
            armAssistantCaptureInvalidation('message-delete');
        });
    }

    if (events.MESSAGE_RECEIVED) {
        ctx.eventSource.on(events.MESSAGE_RECEIVED, (messageIndex, generationType) => {
            const pending = pendingAssistantCaptureInvalidation;
            if (!pending) return;
            const current = rawContext();
            const currentChatId = chatIdentity(current);
            if (pending.chatId && currentChatId && pending.chatId !== currentChatId) {
                pendingAssistantCaptureInvalidation = null;
                return;
            }
            if (generationType === 'first_message') {
                pendingAssistantCaptureInvalidation = null;
                return;
            }
            const index = resolveAssistantMessageIndex(messageIndex, current);
            if (index >= 0) persistCaptureInvalidation(index);
            pendingAssistantCaptureInvalidation = null;
        });
    }

    if (events.CHAT_CHANGED) {
        ctx.eventSource.on(events.CHAT_CHANGED, () => {
            if (!pendingAssistantCaptureInvalidation) return;
            const currentChatId = chatIdentity();
            if (pendingAssistantCaptureInvalidation.chatId
                && currentChatId
                && pendingAssistantCaptureInvalidation.chatId !== currentChatId) {
                pendingAssistantCaptureInvalidation = null;
            }
        });
    }

    globalThis.__KSM_V0315_CAPTURE_GUARDS__ = true;
    captureGuardsInstalled = true;
    return true;
}

async function waitForContext(timeoutMs = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (rawContext()) return true;
        await new Promise(resolve => globalThis.setTimeout(resolve, 50));
    }
    return false;
}

async function load() {
    installRequestTargetGuard();
    await waitForContext();
    installCaptureGuards();
    await import('./bootstrap.js');
}

if (globalThis.__KSM_V0315_TEST_MODE__) {
    globalThis.__KSM_V0315_TEST__ = {
        formatTurn,
        installCaptureGuards,
        installRequestTargetGuard,
        resolveRequestAssistantIndex,
    };
} else {
    void load();
}
