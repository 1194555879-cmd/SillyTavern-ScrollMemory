/**
 * Krystal Scroll Memory v0.3.15 compatibility bootstrap.
 *
 * Loads the v0.3.14 core behind four guards:
 * 1) incomplete/length-truncated memory output repair;
 * 2) always summarize the currently selected swipe text;
 * 3) stale capture cleanup after reroll, user edits and floor deletion;
 * 4) SillyTavern wand-menu access, launcher visibility and ignore-last-turn.
 */

const COMPAT_VERSION = '0.3.15';
const CORE_VERSION = '0.3.14';
const SETTINGS_KEY = 'krystalScrollMemory';
const MESSAGE_META_KEY = 'krystalScrollMemoryCapture';
const MEMORY_ENDPOINT = '/api/backends/chat-completions/generate';
const REMOTE_MANIFEST_PART = '/1194555879-cmd/SillyTavern-ScrollMemory/main/manifest.json';
const MIN_MEMORY_OUTPUT_TOKENS = 4000;
const MEMORY_BLOCK_RE = /【长期记忆条目】[\s\S]*?【长期记忆完】|【记忆条目】[\s\S]*?【记忆完】|【细节记忆】[\s\S]*?【细节记忆完】/g;

let invalidateNextAssistantCapture = false;
let chatGuardsInstalled = false;

function getContextSafe() {
    try {
        return globalThis.SillyTavern?.getContext?.() ?? null;
    } catch {
        return null;
    }
}

function getPluginSettings() {
    const ctx = getContextSafe();
    if (!ctx?.extensionSettings) return null;
    ctx.extensionSettings[SETTINGS_KEY] ??= {};
    return ctx.extensionSettings[SETTINGS_KEY];
}

function launcherIsVisible() {
    return getPluginSettings()?.launcherVisible !== false;
}

function saveLauncherVisibility(visible) {
    const ctx = getContextSafe();
    const settings = getPluginSettings();
    if (!ctx || !settings) return;
    settings.launcherVisible = Boolean(visible);
    ctx.saveSettingsDebounced?.();
}

function toast(type, message) {
    const api = globalThis.toastr;
    if (api && typeof api[type] === 'function') api[type](message);
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

function latestAssistantMessageIndex(ctx = getContextSafe()) {
    if (!ctx?.chat) return -1;
    for (let index = ctx.chat.length - 1; index >= 0; index--) {
        const message = ctx.chat[index];
        if (message && !message.is_user && !message.is_system) return index;
    }
    return -1;
}

function resolveAssistantMessageIndex(messageIndex, ctx = getContextSafe()) {
    const numeric = Number(messageIndex);
    if (Number.isInteger(numeric)) {
        const candidate = ctx?.chat?.[numeric];
        if (candidate && !candidate.is_user && !candidate.is_system) return numeric;
    }
    return latestAssistantMessageIndex(ctx);
}

function nextAssistantMessageIndex(userIndex, ctx = getContextSafe()) {
    if (!ctx?.chat) return -1;
    for (let index = Number(userIndex) + 1; index < ctx.chat.length; index++) {
        const message = ctx.chat[index];
        if (!message) continue;
        if (message.is_user) break;
        if (!message.is_system) return index;
    }
    return -1;
}

function currentTurnText(ctx, assistantIndex) {
    if (!ctx?.chat?.[assistantIndex]) return '';
    let turnStart = 0;
    for (let index = assistantIndex - 1; index >= 0; index--) {
        const candidate = ctx.chat[index];
        if (candidate && !candidate.is_user && !candidate.is_system) {
            turnStart = index + 1;
            break;
        }
    }
    const sensitive = getPluginSettings()?.sensitiveAbstraction !== false;
    return ctx.chat
        .slice(turnStart, assistantIndex + 1)
        .filter(message => message && !message.is_system)
        .map(message => {
            const role = message.is_user ? 'user' : 'assistant';
            const speaker = message.name || (message.is_user ? (ctx.name1 || 'user') : (ctx.name2 || 'char'));
            const source = stripMemoryBlocks(selectedMessageText(message)).slice(-16000);
            const content = sensitive ? abstractSensitiveSource(source) : source;
            return `【${role}｜${speaker}】\n${content}`;
        })
        .join('\n\n');
}

function rewriteRequestWithCurrentSwipe(body) {
    const ctx = getContextSafe();
    const assistantIndex = latestAssistantMessageIndex(ctx);
    const currentTurn = currentTurnText(ctx, assistantIndex);
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

function cloneResponse(data, response) {
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
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

async function emitMessageUpdated(index) {
    const ctx = getContextSafe();
    const events = ctx?.eventTypes || ctx?.event_types;
    if (events?.MESSAGE_UPDATED && typeof ctx?.eventSource?.emit === 'function') {
        await ctx.eventSource.emit(events.MESSAGE_UPDATED, index);
    }
}

function invalidateCaptureAt(index, persist = false) {
    const ctx = getContextSafe();
    const message = ctx?.chat?.[index];
    const changed = clearMessageCapture(message);
    if (changed) {
        void emitMessageUpdated(index).catch(() => null);
        if (persist) void ctx.saveChat?.().catch?.(() => null);
    }
    return changed;
}

async function ignoreLatestCapture() {
    const ctx = getContextSafe();
    const index = latestAssistantMessageIndex(ctx);
    if (index < 0) {
        toast('warning', '当前聊天还没有可忽略的 AI 楼层');
        return;
    }
    if (!invalidateCaptureAt(index, true)) {
        toast('info', '最近一轮本来就没有记忆底片');
    } else {
        toast('success', `已忽略最近一轮记忆（AI 楼层 ${index + 1}）`);
    }
    closeWandMenu();
}

function installChatGuards() {
    if (chatGuardsInstalled) return true;
    const ctx = getContextSafe();
    const events = ctx?.eventTypes || ctx?.event_types;
    if (!ctx?.eventSource || !events) return false;

    if (events.GENERATION_AFTER_COMMANDS) {
        ctx.eventSource.on(events.GENERATION_AFTER_COMMANDS, (generationType, _options, dryRun) => {
            if (dryRun) return;
            if (!['swipe', 'regenerate'].includes(String(generationType))) return;
            const index = latestAssistantMessageIndex();
            if (index >= 0) invalidateCaptureAt(index);
            invalidateNextAssistantCapture = true;
        });
    }

    if (events.MESSAGE_EDITED) {
        ctx.eventSource.on(events.MESSAGE_EDITED, messageIndex => {
            const current = getContextSafe();
            const index = Number(messageIndex);
            const edited = current?.chat?.[index];
            const target = edited?.is_user ? nextAssistantMessageIndex(index, current) : index;
            if (target >= 0) invalidateCaptureAt(target);
            if (edited?.is_user) invalidateNextAssistantCapture = true;
        });
    }

    if (events.MESSAGE_DELETED) {
        ctx.eventSource.on(events.MESSAGE_DELETED, () => {
            invalidateNextAssistantCapture = true;
        });
    }

    if (events.MESSAGE_RECEIVED) {
        ctx.eventSource.on(events.MESSAGE_RECEIVED, (messageIndex, generationType) => {
            if (!invalidateNextAssistantCapture || generationType === 'first_message') return;
            const current = getContextSafe();
            const index = resolveAssistantMessageIndex(messageIndex, current);
            if (index >= 0) invalidateCaptureAt(index);
            invalidateNextAssistantCapture = false;
        });
    }

    if (events.CHAT_CHANGED) {
        ctx.eventSource.on(events.CHAT_CHANGED, () => {
            invalidateNextAssistantCapture = false;
        });
    }

    chatGuardsInstalled = true;
    return true;
}

function patchVersionText(root = document) {
    root.querySelectorAll('#ksm-panel *').forEach(element => {
        if (element.children.length || !element.textContent?.includes(`v${CORE_VERSION}`)) return;
        element.textContent = element.textContent.replaceAll(`v${CORE_VERSION}`, `v${COMPAT_VERSION}`);
    });
}

function applyLauncherVisibility() {
    const launcher = document.getElementById('ksm-launcher');
    if (launcher) launcher.style.display = launcherIsVisible() ? '' : 'none';
    const toggle = document.getElementById('ksm-wand-launcher-toggle');
    if (!toggle) return;
    const visible = launcherIsVisible();
    toggle.setAttribute('aria-pressed', String(visible));
    const icon = toggle.querySelector('.extensionsMenuExtensionButton');
    if (icon) icon.className = `fa-solid ${visible ? 'fa-eye' : 'fa-eye-slash'} extensionsMenuExtensionButton`;
    const label = toggle.querySelector('span');
    if (label) label.textContent = `卷轴悬浮球：${visible ? '开' : '关'}`;
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
    const bindActivation = (element, handler) => {
        element.addEventListener('click', handler);
        element.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            handler();
        });
    };
    bindActivation(container.querySelector('#ksm-wand-open'), openMemoryPanel);
    bindActivation(container.querySelector('#ksm-wand-ignore-last'), () => void ignoreLatestCapture());
    bindActivation(container.querySelector('#ksm-wand-launcher-toggle'), toggleLauncher);
    applyLauncherVisibility();
    return true;
}

function installUiEnhancements() {
    const refresh = () => {
        mountWandMenu();
        applyLauncherVisibility();
        patchVersionText();
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(refresh, 300);
    window.setTimeout(refresh, 1000);
}

function installClipboardVersionPatch() {
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText || globalThis.__KSM_CLIPBOARD_PATCHED__) return;
    globalThis.__KSM_CLIPBOARD_PATCHED__ = true;
    const originalWriteText = clipboard.writeText.bind(clipboard);
    try {
        clipboard.writeText = text => originalWriteText(
            String(text).startsWith('Krystal · 卷轴记忆')
                ? String(text).replaceAll(`v${CORE_VERSION}`, `v${COMPAT_VERSION}`)
                : text,
        );
    } catch {
        // Read-only Clipboard in some WebViews only affects the copied header.
    }
}

function installFetchGuard() {
    if (globalThis.__KSM_FETCH_GUARD_INSTALLED__) return;
    globalThis.__KSM_FETCH_GUARD_INSTALLED__ = true;
    const originalFetch = globalThis.fetch.bind(globalThis);

    globalThis.fetch = async (input, init = {}) => {
        const url = requestUrl(input);
        if (String(url).includes(REMOTE_MANIFEST_PART)) {
            const response = await originalFetch(input, init);
            try {
                const data = await response.clone().json();
                data.version = CORE_VERSION;
                return cloneResponse(data, response);
            } catch {
                return response;
            }
        }

        const parsedBody = parseRequestBody(init);
        if (!isMemoryCaptureRequest(url, parsedBody)) return originalFetch(input, init);

        const currentBody = rewriteRequestWithCurrentSwipe(parsedBody);
        const guardedBody = {
            ...currentBody,
            max_tokens: Math.max(Number(currentBody.max_tokens) || 0, MIN_MEMORY_OUTPUT_TOKENS),
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
        const approved = globalThis.confirm(
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
        const retryResponse = await originalFetch(input, { ...guardedInit, body: JSON.stringify(retryBody) });
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
            return cloneResponse(retryData, retryResponse);
        }
        toast('error', '格式修复仍未得到完整记忆，请稍后点“重试本轮”');
        return retryResponse;
    };
}

async function waitForContext(timeoutMs = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (getContextSafe()) return true;
        await new Promise(resolve => window.setTimeout(resolve, 50));
    }
    return false;
}

async function load() {
    installFetchGuard();
    installClipboardVersionPatch();
    globalThis.__KSM_COMPAT_VERSION__ = COMPAT_VERSION;
    await waitForContext();
    installChatGuards();
    try {
        await import('./index.js');
        installUiEnhancements();
    } catch (error) {
        console.error('[Krystal Scroll Memory] Failed to load core module', error);
        toast('error', `卷轴记忆加载失败：${error.message}`);
    }
}

void load();
