/**
 * Krystal Scroll Memory v0.3.17 compatibility entry.
 *
 * Keeps the stable v0.3.14 core while adding:
 * - source-floor-safe memory request rewriting;
 * - current-swipe capture requests;
 * - stale capture invalidation after reroll, edits and deletions;
 * - truncation repair for direct memory requests;
 * - a TT-safe wand menu and launcher toggle.
 */

const COMPAT_VERSION = '0.3.17';
const CORE_VERSION = '0.3.14';
const SETTINGS_KEY = 'krystalScrollMemory';
const MESSAGE_META_KEY = 'krystalScrollMemoryCapture';
const REMOTE_MANIFEST_PART = '/1194555879-cmd/SillyTavern-ScrollMemory/main/manifest.json';
const MIN_MEMORY_OUTPUT_TOKENS = 4000;
const MEMORY_BLOCK_RE = /【长期记忆条目】[\s\S]*?【长期记忆完】|【记忆条目】[\s\S]*?【记忆完】|【细节记忆】[\s\S]*?【细节记忆完】/g;

let requestGuardInstalled = false;
let captureGuardsInstalled = false;
let pendingAssistantCaptureInvalidation = null;
let uiObserver = null;
let uiRefreshScheduled = false;

function rawContext() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

function toast(type, message) {
    const api = globalThis.toastr;
    if (api && typeof api[type] === 'function') api[type](message);
}

function requestUrl(input) {
    if (typeof input === 'string') return input;
    if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
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

function isMemoryCaptureRequest(body) {
    if (!body || !Array.isArray(body.messages)) return false;
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

function rewriteMemoryRequest(body, ctx = rawContext()) {
    const targetIndex = resolveRequestAssistantIndex(body, ctx);
    if (targetIndex < 0) return body;
    const target = ctx?.chat?.[targetIndex];
    const currentTurn = formatTurn(ctx, targetIndex, selectedMessageText(target));
    if (!currentTurn) return body;

    let changed = false;
    const messages = body.messages.map(message => {
        if (message?.role !== 'user' || !String(message.content || '').includes('【本轮对话】')) return message;
        const content = String(message.content || '');
        const replaced = content.replace(
            /【本轮对话】\n[\s\S]*?\n\n【前文参考/,
            `【本轮对话】\n${currentTurn}\n\n【前文参考`,
        );
        if (replaced === content) return message;
        changed = true;
        return { ...message, content: replaced };
    });
    return changed ? { ...body, messages } : body;
}

function responseText(data) {
    const content = data?.choices?.[0]?.message?.content
        ?? data?.choices?.[0]?.text
        ?? data?.candidates?.[0]?.content?.parts
        ?? data?.output?.[0]?.content
        ?? data?.output_text
        ?? data?.content
        ?? '';
    if (Array.isArray(content)) {
        return content.map(part => typeof part === 'string' ? part : (part?.text ?? part?.content ?? '')).join('');
    }
    return String(content || '');
}

function setResponseText(data, value) {
    if (data?.choices?.[0]?.message && 'content' in data.choices[0].message) {
        data.choices[0].message.content = value;
        return true;
    }
    if (data?.choices?.[0] && 'text' in data.choices[0]) {
        data.choices[0].text = value;
        return true;
    }
    if (data?.candidates?.[0]?.content?.parts) {
        data.candidates[0].content.parts = [{ text: value }];
        return true;
    }
    if ('output_text' in (data || {})) {
        data.output_text = value;
        return true;
    }
    if ('content' in (data || {})) {
        data.content = value;
        return true;
    }
    return false;
}

function finishReason(data) {
    return String(
        data?.choices?.[0]?.finish_reason
        ?? data?.choices?.[0]?.finishReason
        ?? data?.candidates?.[0]?.finishReason
        ?? '',
    ).toLowerCase();
}

function archiveRequired(body) {
    return body?.messages?.some(message => {
        const content = String(message?.content || '');
        return content.includes('【待归档短期记忆】')
            || content.includes('把“待归档短期记忆”中的 20 条')
            || content.includes('必须按顺序输出且只输出以下三个区块');
    });
}

function hasCompleteBlock(text, start, end) {
    const startIndex = text.indexOf(start);
    const endIndex = text.indexOf(end, Math.max(0, startIndex + start.length));
    return startIndex >= 0 && endIndex > startIndex;
}

function captureIsComplete(text, needsArchive) {
    if (!hasCompleteBlock(text, '【记忆条目】', '【记忆完】')) return false;
    if (!hasCompleteBlock(text, '【细节记忆】', '【细节记忆完】')) return false;
    if (needsArchive && !hasCompleteBlock(text, '【长期记忆条目】', '【长期记忆完】')) return false;
    return true;
}

function closePartialBlock(text, start, end) {
    const startIndex = text.indexOf(start);
    if (startIndex < 0 || text.indexOf(end, startIndex + start.length) >= 0) return text;
    const content = text.slice(startIndex + start.length).trim();
    return content ? `${text.trim()}\n${end}` : text;
}

function salvageCaptureText(text, needsArchive) {
    let repaired = String(text || '').trim();
    if (!repaired) return '';
    if (needsArchive) repaired = closePartialBlock(repaired, '【长期记忆条目】', '【长期记忆完】');
    repaired = closePartialBlock(repaired, '【记忆条目】', '【记忆完】');
    if (!repaired.includes('【细节记忆】')) {
        repaired += '\n【细节记忆】\n无\n【细节记忆完】';
    } else {
        repaired = closePartialBlock(repaired, '【细节记忆】', '【细节记忆完】');
    }
    return captureIsComplete(repaired, needsArchive) ? repaired : '';
}

function compactRetryMessage(needsArchive) {
    return `【格式修复重试】
上一份记忆输出被长度上限截断。请从原任务重新生成，不要续写或解释上一份输出。
必须只输出完整边界区块，所有起止标签都不得缺失：
${needsArchive ? '【长期记忆条目】…【长期记忆完】\n' : ''}【记忆条目】…【记忆完】
【细节记忆】…【细节记忆完】

强制压缩：短期记忆不超过 500 个中文字符；长期记忆不超过 1800 个中文字符；细节最多 20 行。保留人名、关系变化、承诺、日期、关键物品、地点、伤病、知情边界和未解线索，删除动作流水账与气氛描写。`;
}

function cloneJsonResponse(data, response) {
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

function installFetchGuard() {
    if (requestGuardInstalled || globalThis.__KSM_V0317_FETCH_GUARD__) return true;
    if (typeof globalThis.fetch !== 'function') return false;
    const originalFetch = globalThis.fetch.bind(globalThis);

    globalThis.fetch = async (input, init = {}) => {
        const url = requestUrl(input);
        if (String(url).includes(REMOTE_MANIFEST_PART)) {
            const response = await originalFetch(input, init);
            try {
                const data = await response.clone().json();
                data.version = CORE_VERSION;
                return cloneJsonResponse(data, response);
            } catch {
                return response;
            }
        }

        const parsedBody = parseRequestBody(init);
        if (!isMemoryCaptureRequest(parsedBody)) return originalFetch(input, init);

        const rewrittenBody = rewriteMemoryRequest(parsedBody);
        const guardedBody = {
            ...rewrittenBody,
            max_tokens: Math.max(Number(rewrittenBody.max_tokens) || 0, MIN_MEMORY_OUTPUT_TOKENS),
        };
        const guardedInit = { ...init, body: JSON.stringify(guardedBody) };
        const firstResponse = await originalFetch(input, guardedInit);
        if (!firstResponse.ok) return firstResponse;

        let firstData;
        try {
            firstData = await firstResponse.clone().json();
        } catch {
            return firstResponse;
        }

        const firstText = responseText(firstData);
        const needsArchive = archiveRequired(guardedBody);
        if (captureIsComplete(firstText, needsArchive)) return firstResponse;

        const reason = finishReason(firstData);
        const reasonHint = reason.includes('length') || reason.includes('max_token')
            ? '检测到输出达到长度上限。'
            : '检测到记忆边界标签不完整。';
        const approved = typeof globalThis.confirm === 'function' && globalThis.confirm(
            `${reasonHint}\n\n是否发送一次“压缩格式修复”请求？这可能产生第二次 API 计费。\n\n取消后不会再次请求，本轮会保留为捕获失败，之后可手动重试。`,
        );
        if (!approved) return firstResponse;

        toast('info', '正在进行一次压缩格式修复重试…');
        const retryBody = {
            ...guardedBody,
            messages: [...guardedBody.messages, { role: 'user', content: compactRetryMessage(needsArchive) }],
            max_tokens: MIN_MEMORY_OUTPUT_TOKENS,
            temperature: 0.1,
        };
        const retryResponse = await originalFetch(input, {
            ...guardedInit,
            body: JSON.stringify(retryBody),
        });
        if (!retryResponse.ok) return retryResponse;

        let retryData;
        try {
            retryData = await retryResponse.clone().json();
        } catch {
            return retryResponse;
        }
        const retryText = responseText(retryData);
        if (captureIsComplete(retryText, needsArchive)) {
            toast('success', '压缩格式修复成功，本轮记忆已交回插件保存');
            return retryResponse;
        }
        const salvaged = salvageCaptureText(retryText, needsArchive);
        if (salvaged && setResponseText(retryData, salvaged)) {
            toast('warning', '修复输出仍被截断，已安全闭合现有记忆标签；请稍后检查摘要内容');
            return cloneJsonResponse(retryData, retryResponse);
        }
        toast('error', '格式修复仍未得到完整记忆，请稍后点“重试本轮”');
        return retryResponse;
    };

    globalThis.__KSM_V0317_FETCH_GUARD__ = true;
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

function clearMessageCapture(message, allSwipes = false) {
    if (!message) return false;
    let changed = false;
    if (message.extra?.[MESSAGE_META_KEY]) {
        delete message.extra[MESSAGE_META_KEY];
        changed = true;
    }

    if (allSwipes && Array.isArray(message.swipe_info)) {
        for (const swipe of message.swipe_info) {
            if (swipe?.extra?.[MESSAGE_META_KEY]) {
                delete swipe.extra[MESSAGE_META_KEY];
                changed = true;
            }
        }
        return changed;
    }

    const swipeId = Number(message.swipe_id);
    if (Number.isInteger(swipeId) && message.swipe_info?.[swipeId]?.extra?.[MESSAGE_META_KEY]) {
        delete message.swipe_info[swipeId].extra[MESSAGE_META_KEY];
        changed = true;
    }
    return changed;
}

function persistCaptureInvalidation(index, allSwipes = false) {
    const ctx = rawContext();
    const changed = clearMessageCapture(ctx?.chat?.[index], allSwipes);
    if (!changed) return false;
    const events = ctx?.eventTypes || ctx?.event_types;
    if (events?.MESSAGE_UPDATED && typeof ctx?.eventSource?.emit === 'function') {
        void Promise.resolve(ctx.eventSource.emit(events.MESSAGE_UPDATED, index)).catch(() => null);
    }
    void Promise.resolve(ctx?.saveChat?.()).catch(() => null);
    return true;
}

function armAssistantCaptureInvalidation(reason, allSwipes = false) {
    pendingAssistantCaptureInvalidation = {
        chatId: chatIdentity(),
        reason: String(reason || 'unknown'),
        allSwipes: Boolean(allSwipes),
    };
}

function installCaptureGuards() {
    if (captureGuardsInstalled || globalThis.__KSM_V0317_CAPTURE_GUARDS__) return true;
    const ctx = rawContext();
    const events = ctx?.eventTypes || ctx?.event_types;
    if (!ctx?.eventSource || !events) return false;

    if (events.GENERATION_AFTER_COMMANDS) {
        ctx.eventSource.on(events.GENERATION_AFTER_COMMANDS, (generationType, _options, dryRun) => {
            if (dryRun || !['swipe', 'regenerate'].includes(String(generationType))) return;
            const index = latestAssistantMessageIndex();
            if (index >= 0) persistCaptureInvalidation(index, false);
            armAssistantCaptureInvalidation(generationType, false);
        });
    }

    if (events.MESSAGE_EDITED) {
        ctx.eventSource.on(events.MESSAGE_EDITED, messageIndex => {
            const current = rawContext();
            const index = Number(messageIndex);
            const edited = current?.chat?.[index];
            if (!edited) return;
            if (edited.is_user) {
                const target = nextAssistantMessageIndex(index, current);
                if (target >= 0) persistCaptureInvalidation(target, true);
                armAssistantCaptureInvalidation('user-edit', true);
                return;
            }
            persistCaptureInvalidation(index, false);
        });
    }

    if (events.MESSAGE_DELETED) {
        ctx.eventSource.on(events.MESSAGE_DELETED, () => {
            armAssistantCaptureInvalidation('message-delete', false);
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
            if (index >= 0) persistCaptureInvalidation(index, pending.allSwipes);
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

    globalThis.__KSM_V0317_CAPTURE_GUARDS__ = true;
    captureGuardsInstalled = true;
    return true;
}

function launcherIsVisible() {
    return pluginSettings(rawContext()).launcherVisible !== false;
}

function saveLauncherVisibility(visible) {
    const ctx = rawContext();
    if (!ctx?.extensionSettings) return;
    ctx.extensionSettings[SETTINGS_KEY] ??= {};
    ctx.extensionSettings[SETTINGS_KEY].launcherVisible = Boolean(visible);
    ctx.saveSettingsDebounced?.();
}

function setTextIfChanged(element, value) {
    if (!element || element.textContent === value) return false;
    element.textContent = value;
    return true;
}

function setAttributeIfChanged(element, name, value) {
    if (!element || element.getAttribute(name) === value) return false;
    element.setAttribute(name, value);
    return true;
}

function patchVersionText(root = document) {
    root.querySelectorAll?.('#ksm-panel *').forEach(element => {
        if (element.children.length) return;
        const text = String(element.textContent || '');
        if (!text.includes(`v${CORE_VERSION}`)) return;
        setTextIfChanged(element, text.replaceAll(`v${CORE_VERSION}`, `v${COMPAT_VERSION}`));
    });
}

function applyLauncherVisibility() {
    const launcher = document.getElementById('ksm-launcher');
    if (launcher) {
        const display = launcherIsVisible() ? '' : 'none';
        if (launcher.style.display !== display) launcher.style.display = display;
    }
    const toggle = document.getElementById('ksm-wand-launcher-toggle');
    if (!toggle) return;
    const visible = launcherIsVisible();
    setAttributeIfChanged(toggle, 'aria-pressed', String(visible));
    const icon = toggle.querySelector('.extensionsMenuExtensionButton');
    const iconClass = `fa-solid ${visible ? 'fa-eye' : 'fa-eye-slash'} extensionsMenuExtensionButton`;
    if (icon && icon.className !== iconClass) icon.className = iconClass;
    setTextIfChanged(toggle.querySelector('span'), `卷轴悬浮球：${visible ? '开' : '关'}`);
}

function closeWandMenu() {
    const menu = document.getElementById('extensionsMenu');
    if (menu) menu.style.display = 'none';
}

function openMemoryPanel() {
    const launcher = document.getElementById('ksm-launcher');
    if (!launcher) {
        toast('warning', '卷轴记忆界面尚未加载完成');
        return;
    }
    if (!launcherIsVisible()) {
        saveLauncherVisibility(true);
        applyLauncherVisibility();
    }
    launcher.click();
    closeWandMenu();
}

function toggleLauncher() {
    const visible = !launcherIsVisible();
    saveLauncherVisibility(visible);
    applyLauncherVisibility();
    toast('success', visible ? '卷轴记忆悬浮球已开启' : '卷轴记忆悬浮球已关闭，可从魔法棒菜单重新打开');
}

async function ignoreLatestCapture() {
    const index = latestAssistantMessageIndex();
    if (index < 0) {
        toast('warning', '当前聊天还没有可忽略的 AI 楼层');
        return;
    }
    if (persistCaptureInvalidation(index, false)) {
        toast('success', `已忽略最近一轮记忆（AI 楼层 ${index + 1}）`);
    } else {
        toast('info', '最近一轮本来就没有记忆底片');
    }
    closeWandMenu();
}

function bindActivation(element, handler) {
    if (!element) return;
    element.addEventListener('click', handler);
    element.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handler();
    });
}

function mountWandMenu() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById('ksm_wand_container')) return false;
    const container = document.createElement('div');
    container.id = 'ksm_wand_container';
    container.className = 'extension_container';
    container.innerHTML = `
        <div id="ksm-wand-open" class="list-group-item flex-container flexGap5 interactable" role="button" tabindex="0">
            <div class="fa-solid fa-scroll extensionsMenuExtensionButton"></div><span>卷轴记忆</span>
        </div>
        <div id="ksm-wand-ignore-last" class="list-group-item flex-container flexGap5 interactable" role="button" tabindex="0">
            <div class="fa-solid fa-comment-slash extensionsMenuExtensionButton"></div><span>忽略最近一轮记忆</span>
        </div>
        <div id="ksm-wand-launcher-toggle" class="list-group-item flex-container flexGap5 interactable" role="button" tabindex="0" aria-pressed="true">
            <div class="fa-solid fa-eye extensionsMenuExtensionButton"></div><span>卷轴悬浮球：开</span>
        </div>`;
    menu.append(container);
    bindActivation(container.querySelector('#ksm-wand-open'), openMemoryPanel);
    bindActivation(container.querySelector('#ksm-wand-ignore-last'), () => void ignoreLatestCapture());
    bindActivation(container.querySelector('#ksm-wand-launcher-toggle'), toggleLauncher);
    return true;
}

function observeUi() {
    if (!uiObserver || !document.body) return;
    uiObserver.observe(document.body, { childList: true, subtree: true });
}

function ensureUi() {
    if (!document.body) return;
    uiObserver?.disconnect();
    try {
        mountWandMenu();
        applyLauncherVisibility();
        patchVersionText();
    } finally {
        observeUi();
    }
}

function scheduleUiRefresh() {
    if (uiRefreshScheduled) return;
    uiRefreshScheduled = true;
    const schedule = globalThis.requestAnimationFrame || (callback => globalThis.setTimeout(callback, 16));
    schedule(() => {
        uiRefreshScheduled = false;
        ensureUi();
    });
}

function installUiEnhancements() {
    if (globalThis.__KSM_V0317_UI__) return;
    globalThis.__KSM_V0317_UI__ = true;
    uiObserver = new MutationObserver(scheduleUiRefresh);
    observeUi();
    ensureUi();
    [100, 400, 1000, 2500].forEach(delay => globalThis.setTimeout(ensureUi, delay));
    document.addEventListener('click', event => {
        if (event.target?.closest?.('#extensionsMenuButton')) scheduleUiRefresh();
    }, true);
}

function installClipboardVersionPatch() {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.writeText || globalThis.__KSM_V0317_CLIPBOARD__) return;
    globalThis.__KSM_V0317_CLIPBOARD__ = true;
    const originalWriteText = clipboard.writeText.bind(clipboard);
    try {
        clipboard.writeText = text => originalWriteText(
            String(text).startsWith('Krystal · 卷轴记忆')
                ? String(text).replaceAll(`v${CORE_VERSION}`, `v${COMPAT_VERSION}`)
                : text,
        );
    } catch {
        // Some WebViews expose a read-only clipboard object.
    }
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
    installFetchGuard();
    installClipboardVersionPatch();
    globalThis.__KSM_COMPAT_VERSION__ = COMPAT_VERSION;
    await waitForContext();
    installCaptureGuards();
    try {
        await import('./index.js');
        installUiEnhancements();
    } catch (error) {
        console.error('[Krystal Scroll Memory] Failed to load core module', error);
        toast('error', `卷轴记忆加载失败：${error.message}`);
    }
}

if (globalThis.__KSM_V0317_TEST_MODE__) {
    globalThis.__KSM_V0317_TEST__ = {
        clearMessageCapture,
        formatTurn,
        installCaptureGuards,
        resolveRequestAssistantIndex,
        rewriteMemoryRequest,
        setTextIfChanged,
    };
} else {
    void load();
}
