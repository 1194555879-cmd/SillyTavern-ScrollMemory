/**
 * Krystal Scroll Memory v0.3.15 compatibility bootstrap.
 *
 * Installs the truncation guard before loading the v0.3.14 core, then adds
 * SillyTavern wand-menu access and a persistent floating-launcher toggle.
 */

const COMPAT_VERSION = '0.3.15';
const CORE_VERSION = '0.3.14';
const SETTINGS_KEY = 'krystalScrollMemory';
const MEMORY_ENDPOINT = '/api/backends/chat-completions/generate';
const REMOTE_MANIFEST_PART = '/1194555879-cmd/SillyTavern-ScrollMemory/main/manifest.json';
const MIN_MEMORY_OUTPUT_TOKENS = 4000;

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
    if (api && typeof api[type] === 'function') {
        api[type](message);
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
    if (!String(url).includes(MEMORY_ENDPOINT) || !body || !Array.isArray(body.messages)) {
        return false;
    }
    return body.messages.some(message => {
        const content = String(message?.content || '');
        return content.includes('你是独立的剧情记忆整理器')
            || content.includes('【记忆总结要求】')
            || content.includes('【待归档短期记忆】');
    });
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
        return content
            .map(part => typeof part === 'string' ? part : (part?.text ?? part?.content ?? ''))
            .join('');
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
    if (!content) return text;
    return `${text.trim()}\n${end}`;
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
    if (toggle) {
        const visible = launcherIsVisible();
        toggle.setAttribute('aria-pressed', String(visible));
        const icon = toggle.querySelector('.extensionsMenuExtensionButton');
        if (icon) icon.className = `fa-solid ${visible ? 'fa-eye' : 'fa-eye-slash'} extensionsMenuExtensionButton`;
        const label = toggle.querySelector('span');
        if (label) label.textContent = `卷轴悬浮球：${visible ? '开' : '关'}`;
    }
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
            <div class="fa-solid fa-scroll extensionsMenuExtensionButton"></div>
            <span>卷轴记忆</span>
        </div>
        <div id="ksm-wand-launcher-toggle" class="list-group-item flex-container flexGap5 interactable" role="button" tabindex="0" aria-pressed="true">
            <div class="fa-solid fa-eye extensionsMenuExtensionButton"></div>
            <span>卷轴悬浮球：开</span>
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
        // Some WebViews expose a read-only Clipboard object. UI functionality
        // remains intact; only copied diagnostic headers keep the core version.
    }
}

function installFetchGuard() {
    if (globalThis.__KSM_FETCH_GUARD_INSTALLED__) return;
    globalThis.__KSM_FETCH_GUARD_INSTALLED__ = true;
    const originalFetch = globalThis.fetch.bind(globalThis);

    globalThis.fetch = async (input, init = {}) => {
        const url = requestUrl(input);

        // The v0.3.14 core compares its internal constant with the remote
        // manifest. Hide the compatibility wrapper's version from that one
        // internal check to prevent a self-update loop.
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

        const body = parseRequestBody(init);
        if (!isMemoryCaptureRequest(url, body)) {
            return originalFetch(input, init);
        }

        const guardedBody = {
            ...body,
            max_tokens: Math.max(Number(body.max_tokens) || 0, MIN_MEMORY_OUTPUT_TOKENS),
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
        const incomplete = !captureIsComplete(firstText, needsArchive);
        const truncated = finishReason(firstData).includes('length')
            || finishReason(firstData).includes('max_token');
        if (!incomplete && !truncated) return firstResponse;

        const approved = globalThis.confirm(
            '卷轴记忆输出被截断或缺少完整标签。\n\n是否发送一次“压缩格式修复”请求？这可能产生第二次 API 计费。\n\n取消后不会再次请求，本轮会保留为捕获失败，之后可手动重试。',
        );
        if (!approved) return firstResponse;

        toast('info', '正在进行一次压缩格式修复重试…');
        const retryBody = {
            ...guardedBody,
            messages: [
                ...guardedBody.messages,
                { role: 'user', content: compactRetryMessage(needsArchive) },
            ],
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
            return cloneResponse(retryData, retryResponse);
        }
        toast('error', '格式修复仍未得到完整记忆，请稍后点“重试本轮”');
        return retryResponse;
    };
}

installFetchGuard();
installClipboardVersionPatch();
globalThis.__KSM_COMPAT_VERSION__ = COMPAT_VERSION;

void import('./index.js')
    .then(() => installUiEnhancements())
    .catch(error => {
        console.error('[Krystal Scroll Memory] Failed to load core module', error);
        toast('error', `卷轴记忆加载失败：${error.message}`);
    });
