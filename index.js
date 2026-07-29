import { getContext } from '../../../extensions.js';
import {
    extension_prompt_roles,
    extension_prompt_types,
} from '../../../../script.js';

const MODULE = 'krystal_scroll_memory';
const META_KEY = 'krystalScrollMemory';
const MESSAGE_META_KEY = 'krystalScrollMemoryCapture';
const LAUNCHER_POSITION_KEY = 'krystalScrollMemoryLauncherPosition';
const VERSION = '0.1.5';
const MAX_SHORT = 20;
const MAX_LONG = 30;
const LAUNCHER_MARGIN = 8;
const LAUNCHER_DRAG_THRESHOLD = 6;
const SHORT_RE = /【记忆条目】([\s\S]{1,1200}?)【记忆完】/g;
const LONG_RE = /【长期记忆条目】([\s\S]{1,4000}?)【长期记忆完】/g;
const MEMORY_BLOCK_RE = /【长期记忆条目】[\s\S]*?【长期记忆完】|【记忆条目】[\s\S]*?【记忆完】/g;
const BAD_PATTERNS = [
    '重要系统任务',
    '记忆卷轴归档',
    '必须归档的 20 条短期记忆',
    '边界标签',
    '本轮新增剧情事实',
];

let panelOpen = false;
let activeTab = 'short';
let initialized = false;
let trackRawStream = false;
let rawStreamText = '';
const runtimeStatus = {
    injectionState: 'idle',
    injectionText: '注入：等待选择聊天',
    captureState: 'idle',
    captureText: '捕获：还没测试',
};

function clamp(number, minimum, maximum) {
    return Math.min(Math.max(number, minimum), maximum);
}

function launcherBounds(launcher) {
    const width = launcher.offsetWidth || 46;
    const height = launcher.offsetHeight || 46;
    const layoutWidth = document.documentElement.clientWidth || window.innerWidth;
    const layoutHeight = document.documentElement.clientHeight || window.innerHeight;
    const viewportWidth = Math.min(layoutWidth, window.visualViewport?.width || layoutWidth);
    const viewportHeight = Math.min(layoutHeight, window.visualViewport?.height || layoutHeight);
    return {
        minX: LAUNCHER_MARGIN,
        maxX: Math.max(LAUNCHER_MARGIN, viewportWidth - width - LAUNCHER_MARGIN),
        minY: LAUNCHER_MARGIN,
        maxY: Math.max(LAUNCHER_MARGIN, viewportHeight - height - LAUNCHER_MARGIN),
    };
}

function setLauncherPosition(launcher, left, top) {
    const bounds = launcherBounds(launcher);
    launcher.style.left = `${clamp(left, bounds.minX, bounds.maxX)}px`;
    launcher.style.top = `${clamp(top, bounds.minY, bounds.maxY)}px`;
    launcher.style.right = 'auto';
    launcher.style.bottom = 'auto';
}

function readLauncherPosition() {
    try {
        const stored = JSON.parse(localStorage.getItem(LAUNCHER_POSITION_KEY));
        if (!Number.isFinite(stored?.x) || !Number.isFinite(stored?.y)) return null;
        return {
            x: clamp(stored.x, 0, 1),
            y: clamp(stored.y, 0, 1),
        };
    } catch {
        return null;
    }
}

function saveLauncherPosition(launcher) {
    const bounds = launcherBounds(launcher);
    const rect = launcher.getBoundingClientRect();
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const position = {
        x: width > 0 ? clamp((rect.left - bounds.minX) / width, 0, 1) : 0,
        y: height > 0 ? clamp((rect.top - bounds.minY) / height, 0, 1) : 0,
    };
    try {
        localStorage.setItem(LAUNCHER_POSITION_KEY, JSON.stringify(position));
    } catch {
        // Storage can be unavailable in privacy-restricted webviews. Dragging
        // still works for the current session in that case.
    }
}

function restoreLauncherPosition() {
    const launcher = document.getElementById('ksm-launcher');
    if (!launcher || launcher.classList.contains('ksm-dragging')) return;
    const stored = readLauncherPosition();
    const bounds = launcherBounds(launcher);
    if (stored) {
        setLauncherPosition(
            launcher,
            bounds.minX + stored.x * (bounds.maxX - bounds.minX),
            bounds.minY + stored.y * (bounds.maxY - bounds.minY),
        );
        return;
    }
    const rect = launcher.getBoundingClientRect();
    setLauncherPosition(launcher, rect.left, rect.top);
}

function applyViewportGuards() {
    const panel = document.getElementById('ksm-panel');
    const launcher = document.getElementById('ksm-launcher');
    if (!panel || !launcher) return;

    panel.style.setProperty('z-index', '2147483000', 'important');
    launcher.style.setProperty('z-index', '2147482999', 'important');

    const touchLayout = window.matchMedia('(hover: none) and (pointer: coarse)').matches
        || window.innerWidth <= 1100;
    if (touchLayout) {
        panel.style.setProperty(
            'top',
            'max(76px, calc(env(safe-area-inset-top) + 48px))',
            'important',
        );
        panel.style.setProperty(
            'max-height',
            'calc(100dvh - 164px - env(safe-area-inset-bottom))',
            'important',
        );
    } else {
        panel.style.removeProperty('top');
        panel.style.removeProperty('max-height');
    }
    window.requestAnimationFrame(restoreLauncherPosition);
}

function makeLauncherDraggable(launcher) {
    let drag = null;
    let suppressClickUntil = 0;

    launcher.addEventListener('pointerdown', event => {
        if (event.button !== undefined && event.button !== 0) return;
        const rect = launcher.getBoundingClientRect();
        drag = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: rect.left,
            startTop: rect.top,
            moved: false,
        };
        launcher.setPointerCapture?.(event.pointerId);
    });

    launcher.addEventListener('pointermove', event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        if (!drag.moved && Math.hypot(deltaX, deltaY) < LAUNCHER_DRAG_THRESHOLD) return;
        drag.moved = true;
        event.preventDefault();
        launcher.classList.add('ksm-dragging');
        setLauncherPosition(launcher, drag.startLeft + deltaX, drag.startTop + deltaY);
    });

    const finishDrag = event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (drag.moved) {
            event.preventDefault();
            saveLauncherPosition(launcher);
            suppressClickUntil = performance.now() + 500;
        }
        launcher.classList.remove('ksm-dragging');
        if (launcher.hasPointerCapture?.(event.pointerId)) {
            launcher.releasePointerCapture(event.pointerId);
        }
        drag = null;
    };

    launcher.addEventListener('pointerup', finishDrag);
    launcher.addEventListener('pointercancel', finishDrag);
    launcher.addEventListener('click', event => {
        if (performance.now() < suppressClickUntil) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        suppressClickUntil = 0;
        panelOpen = !panelOpen;
        render();
    });
}

function emptyState() {
    return {
        version: 1,
        short: [],
        long: [],
        volumeCount: 0,
        updatedAt: Date.now(),
    };
}

function context() {
    return getContext();
}

function state() {
    const ctx = context();
    if (!ctx.chatMetadata[META_KEY] || typeof ctx.chatMetadata[META_KEY] !== 'object') {
        ctx.chatMetadata[META_KEY] = emptyState();
    }
    const data = ctx.chatMetadata[META_KEY];
    data.short = Array.isArray(data.short) ? data.short : [];
    data.long = Array.isArray(data.long) ? data.long : [];
    data.volumeCount = Number(data.volumeCount) || 0;
    return data;
}

function save() {
    const data = state();
    data.updatedAt = Date.now();
    context().saveMetadataDebounced();
    updateInjection();
    render();
}

function hash(text) {
    let value = 0;
    for (let i = 0; i < text.length; i++) value = ((value << 5) - value + text.charCodeAt(i)) | 0;
    return value.toString(36);
}

function clean(text) {
    return String(text || '').trim().replace(/\n{3,}/g, '\n\n');
}

function isNoise(text) {
    const value = clean(text);
    return !value || BAD_PATTERNS.some(pattern => value.includes(pattern));
}

function chineseNumber(number) {
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (number < 10) return digits[number];
    if (number === 10) return '十';
    if (number < 20) return `十${digits[number % 10]}`;
    if (number < 100) return `${digits[Math.floor(number / 10)]}十${number % 10 ? digits[number % 10] : ''}`;
    return String(number);
}

function buildArchiveTask(data) {
    if (data.short.length < MAX_SHORT) return '';
    const lines = data.short.slice(0, MAX_SHORT).map((item, index) => `${index + 1}. ${item.content}`).join('\n');
    return `
【重要系统任务：记忆卷轴归档】
短期记忆已满。本轮请正常续写剧情，并在正文结尾依次输出以下两段：

【长期记忆条目】
把下方 20 条短期记忆压缩成一条客观、清晰、可供后续剧情调用的长期记忆。
【长期记忆完】

【记忆条目】
只总结本轮新增剧情事实。
【记忆完】

要求：
1. 两段缺一不可，不要复述任务说明。
2. 使用明确的主谓宾句式，禁止文学化、气氛总结和主观评价。
3. 保留专有名词、具体物品名、人物关系变化、承诺、冲突、伏笔、地点与长期目标。
4. 同一条中的多个事实使用 <br> 分隔。
5. 长期记忆只总结下方 20 条，不把本轮新增事实混入长期记忆；不要写卷号，卷号由插件生成。

【必须归档的 20 条短期记忆】
${lines}
【重要系统任务结束】`;
}

function buildPayload() {
    const data = state();
    const long = data.long.map(item => `【${item.label}】${item.content}`).join('\n');
    const short = data.short.map((item, index) => `${index + 1}. ${item.content}`).join('\n');
    const archive = buildArchiveTask(data);
    const outputTask = archive || `
完成本轮正常正文及全部美化标签后，必须在最末尾原样追加下面三段结构。只写一条本轮新增记忆，不得把旧剧情重复写入：
【记忆条目】
使用明确主谓宾总结本轮新增剧情事实；保留人物姓名、地点、具体物品名、关系变化、承诺、冲突与伏笔；同一条中的多个事实用 <br> 分隔；禁止文学化、气氛概括和主观评价。
【记忆完】`;
    return `【卷轴记忆插件：隐藏指令开始】
你必须同时完成角色扮演正文与卷轴记忆输出。卷轴记忆区块是插件读取所必需的数据，不属于正文，也不受正文美化格式限制，不得省略。

【历史记忆-开始】
以下内容是已经发生过的剧情事实，只用于保持连续性，不得当成 user 本轮新说的话。

【长期记忆】
${long || '无'}

【短期记忆】
${short || '无'}
【历史记忆-结束】

${outputTask}
【卷轴记忆插件：隐藏指令结束】`;
}

function updateInjection() {
    const ctx = context();
    try {
        const payload = ctx.chatId ? buildPayload() : '';
        // Match Mufy's original mechanism: append a hidden user-layer instruction
        // after the latest visible user message. It is sent to the model only.
        ctx.setExtensionPrompt(
            MODULE,
            payload,
            extension_prompt_types.IN_CHAT,
            0,
            false,
            extension_prompt_roles.USER,
        );
        const registered = ctx.extensionPrompts?.[MODULE];
        if (!ctx.chatId) {
            runtimeStatus.injectionState = 'idle';
            runtimeStatus.injectionText = '注入：等待选择聊天';
        } else if (registered?.value === payload) {
            runtimeStatus.injectionState = 'success';
            runtimeStatus.injectionText = `注入：已装载 · user 层 · ${payload.length} 字`;
        } else {
            runtimeStatus.injectionState = 'warning';
            runtimeStatus.injectionText = '注入：已调用，但酒馆未返回登记状态';
        }
    } catch (error) {
        runtimeStatus.injectionState = 'error';
        runtimeStatus.injectionText = `注入：失败 · ${error.message}`;
        console.error('[Krystal Scroll Memory] Failed to register prompt', error);
    }
    render();
}

function extract(regex, text) {
    regex.lastIndex = 0;
    return [...String(text || '').matchAll(regex)].map(match => clean(match[1])).filter(item => !isNoise(item));
}

function unique(items) {
    return [...new Set(items.map(clean).filter(Boolean))];
}

function extractCapture(text) {
    return {
        short: unique(extract(SHORT_RE, text)),
        long: unique(extract(LONG_RE, text)),
    };
}

function hasCapture(capture) {
    return Boolean(capture.short.length || capture.long.length);
}

function readStoredCapture(message) {
    const stored = message?.extra?.[MESSAGE_META_KEY];
    if (!stored || typeof stored !== 'object') return null;
    const capture = {
        short: Array.isArray(stored.short) ? unique(stored.short) : [],
        long: Array.isArray(stored.long) ? unique(stored.long) : [],
    };
    return hasCapture(capture) ? capture : null;
}

function writeStoredCapture(message, capture, source) {
    message.extra ??= {};
    const stored = {
        short: capture.short,
        long: capture.long,
        source,
        capturedAt: Date.now(),
    };
    message.extra[MESSAGE_META_KEY] = stored;

    const swipeId = Number(message.swipe_id);
    if (Number.isInteger(swipeId) && message.swipe_info?.[swipeId]) {
        message.swipe_info[swipeId].extra ??= {};
        message.swipe_info[swipeId].extra[MESSAGE_META_KEY] = structuredClone(stored);
    }
}

function clearStoredCapture(message) {
    if (!message?.extra) return;
    delete message.extra[MESSAGE_META_KEY];
    const swipeId = Number(message.swipe_id);
    if (Number.isInteger(swipeId) && message.swipe_info?.[swipeId]?.extra) {
        delete message.swipe_info[swipeId].extra[MESSAGE_META_KEY];
    }
}

function captureMessage(messageIndex, generationType) {
    const ctx = context();
    const message = ctx.chat[messageIndex];
    if (!message || message.is_user || message.is_system) return false;

    const streamCapture = extractCapture(rawStreamText);
    const chatCapture = extractCapture(message.mes);
    const capture = hasCapture(streamCapture) ? streamCapture : chatCapture;
    const source = hasCapture(streamCapture) ? '生成原文' : '聊天文本';

    if (!hasCapture(capture)) {
        if (generationType === 'swipe' || generationType === 'regenerate') {
            clearStoredCapture(message);
        }
        runtimeStatus.captureState = 'warning';
        runtimeStatus.captureText = rawStreamText
            ? '捕获：AI 回复里没有完整记忆标签'
            : '捕获：未收到标签；若关闭了流式输出，美化正则也可能已将其删除';
        return false;
    }

    writeStoredCapture(message, capture, source);
    runtimeStatus.captureState = 'success';
    runtimeStatus.captureText = `捕获：成功 · ${source} · 短期 ${capture.short.length} / 长期 ${capture.long.length}`;
    return true;
}

function rebuildFromChat() {
    const ctx = context();
    const rebuilt = emptyState();
    for (let index = 0; index < ctx.chat.length; index++) {
        const message = ctx.chat[index];
        if (!message || message.is_user || message.is_system) continue;
        const stored = readStoredCapture(message);
        const longs = stored?.long ?? extract(LONG_RE, message.mes);
        const shorts = stored?.short ?? extract(SHORT_RE, message.mes);
        for (const content of longs) {
            rebuilt.volumeCount += 1;
            rebuilt.long.push({
                id: `v-${rebuilt.volumeCount}-${hash(content)}`,
                volume: rebuilt.volumeCount,
                label: `第${chineseNumber(rebuilt.volumeCount)}卷`,
                content,
                messageIndex: index,
            });
            if (rebuilt.short.length >= MAX_SHORT) rebuilt.short.splice(0, MAX_SHORT);
        }
        for (const content of shorts) {
            const id = `m-${index}-${hash(content)}`;
            if (rebuilt.short.some(item => item.id === id)) continue;
            rebuilt.short.push({ id, content, messageIndex: index });
        }
    }
    rebuilt.long = rebuilt.long.slice(-MAX_LONG);
    ctx.chatMetadata[META_KEY] = rebuilt;
    save();
}

function hideMemoryInMessage(messageIndex) {
    window.setTimeout(() => {
        const root = document.querySelector(`.mes[mesid="${messageIndex}"] .mes_text`);
        MEMORY_BLOCK_RE.lastIndex = 0;
        if (!root || !MEMORY_BLOCK_RE.test(root.textContent || '')) return;
        MEMORY_BLOCK_RE.lastIndex = 0;
        root.innerHTML = root.innerHTML.replace(MEMORY_BLOCK_RE, '').trim();
    }, 0);
}

function hideAllMemoryBlocks() {
    document.querySelectorAll('.mes .mes_text').forEach(root => {
        MEMORY_BLOCK_RE.lastIndex = 0;
        if (!MEMORY_BLOCK_RE.test(root.textContent || '')) return;
        MEMORY_BLOCK_RE.lastIndex = 0;
        root.innerHTML = root.innerHTML.replace(MEMORY_BLOCK_RE, '').trim();
    });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
}

function render() {
    const panel = document.getElementById('ksm-panel');
    if (!panel) return;
    const data = state();
    panel.classList.toggle('ksm-open', panelOpen);
    panel.querySelector('[data-tab="short"]').classList.toggle('active', activeTab === 'short');
    panel.querySelector('[data-tab="long"]').classList.toggle('active', activeTab === 'long');
    panel.querySelector('#ksm-short-count').textContent = `${data.short.length}/${MAX_SHORT}`;
    panel.querySelector('#ksm-long-count').textContent = `${data.long.length}/${MAX_LONG}`;
    const injectionStatus = panel.querySelector('[data-status="injection"]');
    const captureStatus = panel.querySelector('[data-status="capture"]');
    injectionStatus.dataset.state = runtimeStatus.injectionState;
    captureStatus.dataset.state = runtimeStatus.captureState;
    injectionStatus.querySelector('span:last-child').textContent = runtimeStatus.injectionText;
    captureStatus.querySelector('span:last-child').textContent = runtimeStatus.captureText;
    const items = activeTab === 'short' ? data.short : data.long;
    panel.querySelector('#ksm-list').innerHTML = items.length
        ? items.map(item => `
            <article class="ksm-item" data-id="${escapeHtml(item.id)}">
                <header>${escapeHtml(item.label || `短期记忆 ${data.short.indexOf(item) + 1}`)}</header>
                <textarea>${escapeHtml(item.content)}</textarea>
                <div class="ksm-item-actions">
                    <button data-action="save-item">保存</button>
                    <button data-action="delete-item">删除</button>
                </div>
            </article>`).join('')
        : '<div class="ksm-empty">这里还没有记忆。</div>';
}

function downloadJson() {
    const blob = new Blob([JSON.stringify(state(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `scroll-memory-${context().chatId || 'chat'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
}

function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const parsed = JSON.parse(String(reader.result));
            if (!Array.isArray(parsed.short) || !Array.isArray(parsed.long)) throw new Error('格式不正确');
            context().chatMetadata[META_KEY] = parsed;
            save();
            toastr.success('卷轴记忆已导入');
        } catch (error) {
            toastr.error(`导入失败：${error.message}`);
        }
    };
    reader.readAsText(file);
}

function mountUi() {
    if (document.getElementById('ksm-launcher')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <button id="ksm-launcher" type="button" title="卷轴记忆（可拖动）" aria-label="卷轴记忆（可拖动）">📜</button>
        <div id="ksm-panel" role="dialog" aria-label="卷轴记忆">
            <header class="ksm-title">
                <div><strong>Krystal · 卷轴记忆</strong><small>v${VERSION}</small></div>
                <button data-action="close" title="关闭">×</button>
            </header>
            <nav class="ksm-tabs">
                <button data-tab="short">短期 <span id="ksm-short-count">0/20</span></button>
                <button data-tab="long">长期 <span id="ksm-long-count">0/30</span></button>
            </nav>
            <section class="ksm-status" aria-live="polite">
                <div data-status="injection" data-state="idle"><span class="ksm-status-dot"></span><span>注入：等待选择聊天</span></div>
                <div data-status="capture" data-state="idle"><span class="ksm-status-dot"></span><span>捕获：还没测试</span></div>
            </section>
            <section id="ksm-list"></section>
            <footer class="ksm-footer">
                <button data-action="rebuild">从当前聊天重建</button>
                <button data-action="export">导出</button>
                <label>导入<input id="ksm-import" type="file" accept=".json,application/json"></label>
            </footer>
        </div>`);

    applyViewportGuards();
    window.addEventListener('resize', applyViewportGuards);
    window.addEventListener('orientationchange', applyViewportGuards);
    window.visualViewport?.addEventListener('resize', applyViewportGuards);
    makeLauncherDraggable(document.getElementById('ksm-launcher'));
    document.getElementById('ksm-panel').addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.tab) {
            activeTab = button.dataset.tab;
            render();
            return;
        }
        const action = button.dataset.action;
        if (action === 'close') panelOpen = false;
        if (action === 'export') downloadJson();
        if (action === 'rebuild' && confirm('将根据当前聊天中保存的记忆标签重建侧栏，继续吗？')) rebuildFromChat();
        if (action === 'save-item' || action === 'delete-item') {
            const article = button.closest('.ksm-item');
            const data = state();
            const list = activeTab === 'short' ? data.short : data.long;
            const index = list.findIndex(item => item.id === article.dataset.id);
            if (index >= 0 && action === 'save-item') list[index].content = clean(article.querySelector('textarea').value);
            if (index >= 0 && action === 'delete-item') list.splice(index, 1);
            save();
        }
        render();
    });
    document.getElementById('ksm-import').addEventListener('change', event => {
        const [file] = event.target.files;
        if (file) importJson(file);
        event.target.value = '';
    });
}

function registerEvents() {
    const ctx = context();
    const events = ctx.eventTypes || ctx.event_types;
    ctx.eventSource.on(events.CHAT_CHANGED, () => {
        updateInjection();
        render();
        window.setTimeout(hideAllMemoryBlocks, 50);
    });
    if (events.GENERATION_AFTER_COMMANDS) {
        ctx.eventSource.on(events.GENERATION_AFTER_COMMANDS, (generationType, _options, dryRun) => {
            if (dryRun || generationType === 'quiet' || generationType === 'impersonate') return;
            rawStreamText = '';
            trackRawStream = true;
            runtimeStatus.captureState = 'working';
            runtimeStatus.captureText = '捕获：等待本轮 AI 回复';
            updateInjection();
        });
    }
    if (events.STREAM_TOKEN_RECEIVED) {
        ctx.eventSource.on(events.STREAM_TOKEN_RECEIVED, text => {
            if (trackRawStream) rawStreamText = String(text || '');
        });
    }
    ctx.eventSource.on(events.MESSAGE_RECEIVED, (messageIndex, generationType) => {
        if (generationType !== 'first_message') {
            captureMessage(Number(messageIndex), generationType);
        }
        rebuildFromChat();
        hideMemoryInMessage(messageIndex);
        trackRawStream = false;
        rawStreamText = '';
    });
    [events.MESSAGE_SWIPED, events.MESSAGE_DELETED, events.MESSAGE_UPDATED]
        .filter(Boolean)
        .forEach(event => ctx.eventSource.on(event, () => {
            rebuildFromChat();
            window.setTimeout(hideAllMemoryBlocks, 50);
        }));
    if (events.MESSAGE_EDITED) {
        ctx.eventSource.on(events.MESSAGE_EDITED, messageIndex => {
            const message = context().chat[Number(messageIndex)];
            if (message && !message.is_user) clearStoredCapture(message);
            runtimeStatus.captureState = 'idle';
            runtimeStatus.captureText = '捕获：聊天已编辑，已按当前内容重建';
            rebuildFromChat();
            window.setTimeout(hideAllMemoryBlocks, 50);
        });
    }
    if (events.MORE_MESSAGES_LOADED) {
        ctx.eventSource.on(events.MORE_MESSAGES_LOADED, () => window.setTimeout(hideAllMemoryBlocks, 50));
    }
}

function init() {
    if (initialized) return;
    initialized = true;
    mountUi();
    registerEvents();
    updateInjection();
    render();
    window.setTimeout(hideAllMemoryBlocks, 100);
    console.info(`[Krystal Scroll Memory] v${VERSION} loaded`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
