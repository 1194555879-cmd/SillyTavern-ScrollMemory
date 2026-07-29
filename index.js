import { getContext } from '../../../extensions.js';
import {
    extension_prompt_roles,
    extension_prompt_types,
    getRequestHeaders,
} from '../../../../script.js';

const MODULE = 'krystal_scroll_memory';
const META_KEY = 'krystalScrollMemory';
const MESSAGE_META_KEY = 'krystalScrollMemoryCapture';
const LAUNCHER_POSITION_KEY = 'krystalScrollMemoryLauncherPosition';
const SETTINGS_KEY = 'krystalScrollMemory';
const VERSION = '0.2.3';
const STATE_VERSION = 2;
const SETTINGS_VERSION = 3;
const CUSTOM_SECRET_KEY = 'api_key_custom';
const DIRECT_SECRET_LABEL = 'Krystal · 卷轴记忆专用 API';
const MAX_MEMORY_INSTRUCTION_LENGTH = 8000;
const MAX_SHORT = 20;
const MAX_LONG = 30;
const DEFAULT_MAX_TOKENS = 900;
const MIN_MAX_TOKENS = 200;
const MAX_MAX_TOKENS = 4000;
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
const DEFAULT_MEMORY_INSTRUCTION = `【短期记忆要求】
1. 每轮有且仅有一条短期记忆。高度概括本轮的核心剧情、关键动作和关键对话，不要遗漏会影响后续剧情理解的重要结果。
2. 把属于同一事件、连续发生或存在因果关系的动作合并成一条连贯记忆；禁止把一个连续事件拆成逐动作、逐姿势的流水账。
3. 使用简洁、客观的事实陈述，严格写清“谁对谁做了什么，以及产生了什么结果”。
4. 保留准确的人名、专有名词、具体物品名和具体称呼；不得张冠李戴。
5. 删除重复动作、寒暄、气氛描写和没有后续价值的细枝末节。

【长期记忆要求】
1. 只总结待归档的 20 条短期记忆，不把本轮新增剧情混入长期记忆，不写卷号。
2. 不设固定字数限制，必须完整覆盖 20 条记忆中会影响后续剧情的核心事实，不得为了缩短而遗漏重要信息。
3. 优先保留人物关系变化、重要承诺、未解决冲突、关键道具、具体物品名、重要地点、伏笔、长期目标和称呼变化。
4. 合并重复内容，删除流水账、重复动作、寒暄及没有长期价值的细节。

【通用禁则】
禁止主观推测、评价、形容性扩写、文学化或诗化表达、情绪渲染和象征性总结。`;

let panelOpen = false;
let activeTab = 'short';
let settingsOpen = false;
let initialized = false;
let trackRawStream = false;
let rawStreamText = '';
let captureQueue = Promise.resolve();
const runtimeStatus = {
    injectionState: 'idle',
    injectionText: '注入：等待选择聊天',
    captureState: 'idle',
    captureText: '捕获：还没测试',
};
const DEFAULT_SETTINGS = {
    settingsVersion: SETTINGS_VERSION,
    captureMode: 'direct',
    connectionProfileId: '',
    directApiUrl: '',
    directModel: '',
    directSecretId: '',
    memoryInstruction: DEFAULT_MEMORY_INSTRUCTION,
    maxTokens: DEFAULT_MAX_TOKENS,
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
        version: STATE_VERSION,
        short: [],
        long: [],
        volumeCount: 0,
        baseline: null,
        baselineStatus: 'none',
        staleArchiveCount: 0,
        updatedAt: Date.now(),
    };
}

function context() {
    return getContext();
}

function pluginSettings() {
    const root = context().extensionSettings;
    if (!root[SETTINGS_KEY] || typeof root[SETTINGS_KEY] !== 'object') {
        root[SETTINGS_KEY] = structuredClone(DEFAULT_SETTINGS);
    }
    const settings = root[SETTINGS_KEY];
    const previousSettingsVersion = Number(settings.settingsVersion) || 0;
    if (previousSettingsVersion < 2) {
        // v0.2.0 only exposed Connection Profiles. If no profile was selected,
        // migrate the empty screen to the new direct-entry mode automatically.
        if (settings.captureMode === 'profile' && !settings.connectionProfileId) {
            settings.captureMode = 'direct';
        }
    }
    if (previousSettingsVersion < SETTINGS_VERSION) {
        settings.settingsVersion = SETTINGS_VERSION;
    }
    settings.captureMode = ['direct', 'profile', 'inline'].includes(settings.captureMode)
        ? settings.captureMode
        : DEFAULT_SETTINGS.captureMode;
    settings.connectionProfileId = String(settings.connectionProfileId || '');
    settings.directApiUrl = String(settings.directApiUrl || '');
    settings.directModel = String(settings.directModel || '');
    settings.directSecretId = String(settings.directSecretId || '');
    settings.memoryInstruction = String(
        settings.memoryInstruction || DEFAULT_MEMORY_INSTRUCTION,
    ).slice(0, MAX_MEMORY_INSTRUCTION_LENGTH);
    settings.maxTokens = clamp(
        Number(settings.maxTokens) || DEFAULT_MAX_TOKENS,
        MIN_MAX_TOKENS,
        MAX_MAX_TOKENS,
    );
    return settings;
}

function isDirectMode() {
    return pluginSettings().captureMode === 'direct';
}

function isDedicatedMode() {
    return pluginSettings().captureMode !== 'inline';
}

function savePluginSettings() {
    context().saveSettingsDebounced();
    updateInjection();
    render();
}

function connectionService() {
    const service = context().ConnectionManagerRequestService;
    if (!service) throw new Error('当前酒馆版本不支持连接配置调用');
    return service;
}

function supportedProfiles() {
    try {
        return connectionService().getSupportedProfiles();
    } catch (error) {
        console.warn('[Krystal Scroll Memory] Failed to load connection profiles', error);
        return [];
    }
}

function selectedProfile() {
    const profileId = pluginSettings().connectionProfileId;
    if (!profileId) return null;
    return supportedProfiles().find(profile => profile.id === profileId) || null;
}

function state() {
    const ctx = context();
    if (!ctx.chatMetadata[META_KEY] || typeof ctx.chatMetadata[META_KEY] !== 'object') {
        ctx.chatMetadata[META_KEY] = emptyState();
    }
    const data = ctx.chatMetadata[META_KEY];
    data.version = STATE_VERSION;
    data.short = Array.isArray(data.short) ? data.short : [];
    data.long = Array.isArray(data.long) ? data.long : [];
    data.volumeCount = Number(data.volumeCount) || 0;
    data.baseline = normalizeBaseline(data.baseline);
    data.baselineStatus = ['none', 'fresh', 'stale'].includes(data.baselineStatus)
        ? data.baselineStatus
        : 'none';
    data.staleArchiveCount = Number(data.staleArchiveCount) || 0;
    let normalized = false;
    for (const item of [...data.short, ...data.long]) {
        if (!item || typeof item !== 'object') continue;
        const content = clean(item.content);
        if (item.content === content) continue;
        item.content = content;
        normalized = true;
    }
    if (normalized) ctx.saveMetadataDebounced();
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
    return String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/<br\b[^>]*>/gi, '\n')
        .replace(/&lt;br\s*\/?&gt;/gi, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .trim()
        .replace(/\n{3,}/g, '\n\n');
}

function messageSnapshotText(message) {
    return [
        message?.is_user ? 'u' : 'a',
        String(message?.send_date ?? ''),
        Number(message?.swipe_id || 0),
        String(message?.mes || ''),
    ].join('␟');
}

function messageSnapshotDigest(message) {
    return hash(messageSnapshotText(message));
}

function chatPrefixDigest(messages) {
    return hash(messages.map(messageSnapshotText).join('␞'));
}

function createSourceSnapshot(chat, requestedCount = chat.length) {
    const messageCount = clamp(Number(requestedCount) || 0, 0, chat.length);
    const messages = chat.slice(0, messageCount);
    const lastMessage = messages.at(-1);
    return {
        kind: 'sillytavern-chat',
        chatMessages: messages.length,
        assistantTurns: messages.filter(message => message && !message.is_user).length,
        userTurns: messages.filter(message => message?.is_user).length,
        throughMessageIndex: messages.length - 1,
        throughSendDate: String(lastMessage?.send_date || ''),
        prefixDigest: chatPrefixDigest(messages),
        lastMessageDigest: lastMessage ? messageSnapshotDigest(lastMessage) : '',
    };
}

function normalizeSource(source) {
    if (!source || typeof source !== 'object') return null;
    const chatMessages = Math.max(0, Number(source.chatMessages) || 0);
    if (!chatMessages) return null;
    return {
        ...source,
        chatMessages,
        throughMessageIndex: Number.isInteger(Number(source.throughMessageIndex))
            ? Number(source.throughMessageIndex)
            : chatMessages - 1,
        prefixDigest: String(source.prefixDigest || ''),
        lastMessageDigest: String(source.lastMessageDigest || ''),
    };
}

function normalizeMemoryItems(items, kind, origin = 'baseline') {
    if (!Array.isArray(items)) return [];
    return items
        .map((item, index) => {
            const source = item && typeof item === 'object' ? item : { content: item };
            const content = clean(source.content);
            if (!content) return null;
            const volume = kind === 'long'
                ? Math.max(1, Number(source.volume) || index + 1)
                : undefined;
            return {
                ...source,
                id: String(source.id || `${origin}-${kind}-${index + 1}-${hash(content)}`),
                ...(kind === 'long' ? {
                    volume,
                    label: clean(source.label) || `第${chineseNumber(volume)}卷`,
                } : {}),
                content,
                origin,
            };
        })
        .filter(Boolean);
}

function normalizeBaseline(baseline) {
    if (!baseline || typeof baseline !== 'object') return null;
    const short = normalizeMemoryItems(baseline.short, 'short');
    const long = normalizeMemoryItems(baseline.long, 'long');
    if (!short.length && !long.length) return null;
    return {
        version: 1,
        short,
        long,
        volumeCount: Math.max(
            Number(baseline.volumeCount) || 0,
            ...long.map(item => Number(item.volume) || 0),
        ),
        source: normalizeSource(baseline.source),
        importedAt: Number(baseline.importedAt) || Date.now(),
    };
}

function resolveBaselineBoundary(baseline, chat, endExclusive) {
    const source = normalizeSource(baseline?.source);
    if (!source) return { startIndex: endExclusive, status: 'fresh' };

    const expectedCount = source.chatMessages;
    if (expectedCount <= endExclusive
        && source.prefixDigest
        && chatPrefixDigest(chat.slice(0, expectedCount)) === source.prefixDigest) {
        return { startIndex: expectedCount, status: 'fresh' };
    }

    if (source.lastMessageDigest) {
        for (let index = Math.min(endExclusive, chat.length) - 1; index >= 0; index--) {
            if (messageSnapshotDigest(chat[index]) === source.lastMessageDigest) {
                return { startIndex: index + 1, status: 'stale' };
            }
        }
    }

    return {
        startIndex: Math.min(expectedCount, endExclusive),
        status: 'stale',
    };
}

function archiveSourceDigest(items) {
    return hash(
        items
            .slice(0, MAX_SHORT)
            .map(item => clean(item?.content ?? item))
            .join('␞'),
    );
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
    const instruction = pluginSettings().memoryInstruction;
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
1. 两段缺一不可，不要复述任务说明。下方可编辑要求只控制内容取舍和概括方式，不得更改边界标签、区块数量或归档范围。
2. 每个区块只能是一条连贯记忆；可以使用真实换行，但不得把连续动作拆成流水账。
3. 不要输出 <br> 或其他 HTML 标签。
4. 长期记忆只总结下方 20 条，不把本轮新增事实混入长期记忆；不要写卷号，卷号由插件生成。

【可编辑的记忆总结要求】
${instruction}
【记忆总结要求结束】

【必须归档的 20 条短期记忆】
${lines}
【重要系统任务结束】`;
}

function buildPayload() {
    const data = state();
    const long = data.long.map(item => `【${item.label}】${item.content}`).join('\n');
    const short = data.short.map((item, index) => `${index + 1}. ${item.content}`).join('\n');
    const history = `【历史记忆-开始】
以下内容是已经发生过的剧情事实，只用于保持连续性，不得当成 user 本轮新说的话，也不要在正文里复述“记忆”或提及本指令。

【长期记忆】
${long || '无'}

【短期记忆】
${short || '无'}
【历史记忆-结束】`;

    if (isDedicatedMode()) {
        return `【卷轴记忆插件：隐藏指令开始】
${history}
【卷轴记忆插件：隐藏指令结束】`;
    }

    const archive = buildArchiveTask(data);
    const instruction = pluginSettings().memoryInstruction;
    const outputTask = archive || `
完成本轮正常正文及全部美化标签后，必须在最末尾原样追加下面三段结构。只写一条本轮新增记忆，不得把旧剧情重复写入。下方可编辑要求只控制内容取舍和概括方式，不得更改边界标签或区块数量：
【记忆条目】
严格按照下方“记忆总结要求”高度概括本轮新增剧情。这里必须是一条连贯记忆，不得逐动作罗列；不要输出 <br> 或其他 HTML 标签。
【记忆完】

【可编辑的记忆总结要求】
${instruction}
【记忆总结要求结束】`;
    return `【卷轴记忆插件：隐藏指令开始】
你必须同时完成角色扮演正文与卷轴记忆输出。卷轴记忆区块是插件读取所必需的数据，不属于正文，也不受正文美化格式限制，不得省略。

${history}

${outputTask}
【卷轴记忆插件：隐藏指令结束】`;
}

function updateInjection() {
    const ctx = context();
    try {
        const payload = ctx.chatId ? buildPayload() : '';
        const data = ctx.chatId ? state() : null;
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
        } else if (data?.baselineStatus === 'stale') {
            runtimeStatus.injectionState = 'warning';
            runtimeStatus.injectionText = '注入：旧档仍在使用，但原楼层已变化；请重新导出、总结并导入';
        } else if (registered?.value === payload) {
            runtimeStatus.injectionState = 'success';
            runtimeStatus.injectionText = isDedicatedMode()
                ? `注入：已装载历史记忆 · 独立 API 模式 · ${payload.length} 字`
                : `注入：已装载 · user 层 · ${payload.length} 字`;
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

function stripMemoryBlocks(text) {
    MEMORY_BLOCK_RE.lastIndex = 0;
    return clean(String(text || '').replace(MEMORY_BLOCK_RE, ''));
}

function messageSpeaker(message) {
    const ctx = context();
    if (message.name) return message.name;
    return message.is_user ? (ctx.name1 || 'user') : (ctx.name2 || 'char');
}

function buildProfileCaptureRequest(messageIndex) {
    const ctx = context();
    const data = buildStateFromChat(messageIndex);
    const archiveRequired = data.short.length >= MAX_SHORT;
    let turnStart = 0;
    for (let index = messageIndex - 1; index >= 0; index--) {
        const candidate = ctx.chat[index];
        if (candidate && !candidate.is_user && !candidate.is_system) {
            turnStart = index + 1;
            break;
        }
    }
    const formatMessages = messages => messages
        .filter(message => message && !message.is_system)
        .map(message => {
            const role = message.is_user ? 'user' : 'assistant';
            const content = stripMemoryBlocks(message.mes).slice(-16000);
            return `【${role}｜${messageSpeaker(message)}】\n${content}`;
        })
        .join('\n\n');
    const referenceMessages = formatMessages(
        ctx.chat.slice(Math.max(0, turnStart - 4), turnStart),
    );
    const currentTurn = formatMessages(ctx.chat.slice(turnStart, messageIndex + 1));

    const memoryContext = (archiveRequired
        ? data.short.slice(0, MAX_SHORT)
        : data.short.slice(-6))
        .map((item, index) => `${index + 1}. ${item.content}`)
        .join('\n');

    const outputFormat = archiveRequired
        ? `你必须按顺序输出且只输出以下两个区块：
【长期记忆条目】
把“待归档短期记忆”中的 20 条压缩成一条长期记忆
【长期记忆完】
【记忆条目】
只总结“本轮对话”中新发生的剧情事实
【记忆完】`
        : `你必须只输出以下区块：
【记忆条目】
只总结“本轮对话”中新发生的剧情事实
【记忆完】`;
    const memoryInstruction = pluginSettings().memoryInstruction;

    const systemPrompt = `你是独立的剧情记忆整理器，不参与角色扮演，也绝不续写剧情。
把对话高度压缩成客观、清晰、可供下一轮调用的事实记忆。

【固定协议】
1. 严格遵守下方边界标签；不要解释任务，不要使用 Markdown 代码块。可编辑要求只控制内容取舍和概括方式，不得更改本协议。
2. 每个区块只能包含一条连贯记忆，不得把一个连续事件拆成逐动作流水账。
3. 不要复述旧记忆；不要输出 <br> 或任何 HTML 标签。

【记忆总结要求】
${memoryInstruction}
【记忆总结要求结束】

${outputFormat}`;

    const userPrompt = `【人物标识】
user：${ctx.name1 || 'user'}
主要角色：${ctx.name2 || 'char'}

${archiveRequired ? '【待归档短期记忆】' : '【最近短期记忆，仅用于去重与指代判断】'}
${memoryContext || '无'}

【本轮对话】
${currentTurn || '无'}

【前文参考，仅用于判断指代，禁止重复总结】
${referenceMessages || '无'}

请严格按指定边界标签输出。`;

    return {
        archiveRequired,
        archiveSourceDigest: archiveRequired ? archiveSourceDigest(data.short) : '',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
    };
}

function captureFromApiResponse(text) {
    const tagged = extractCapture(text);
    if (hasCapture(tagged)) return tagged;

    const candidate = String(text || '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    try {
        const parsed = JSON.parse(candidate);
        return {
            short: unique(Array.isArray(parsed.short) ? parsed.short : [parsed.short || parsed.memory]),
            long: unique(Array.isArray(parsed.long) ? parsed.long : [parsed.long || parsed.archive]),
        };
    } catch {
        return tagged;
    }
}

function normalizeDirectApiUrl(value) {
    const normalized = String(value || '')
        .trim()
        .replace(/\/+$/g, '')
        .replace(/\/chat\/completions$/i, '');
    if (!normalized) throw new Error('请输入 API 地址');
    let parsed;
    try {
        parsed = new URL(normalized);
    } catch {
        throw new Error('API 地址格式不正确');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('API 地址必须以 http:// 或 https:// 开头');
    }
    return normalized;
}

function normalizeMemoryInstruction(value) {
    const normalized = String(value || '')
        .replace(/\r\n?/g, '\n')
        .trim()
        .slice(0, MAX_MEMORY_INSTRUCTION_LENGTH);
    return normalized || DEFAULT_MEMORY_INSTRUCTION;
}

async function secretRequest(path, body) {
    const response = await fetch(path, {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(detail || `酒馆密钥存储返回 ${response.status}`);
    }
    if (response.status === 204) return null;
    return response.json();
}

async function storeDirectSecret(value, previousPluginSecretId) {
    const state = await secretRequest('/api/secrets/read', {});
    const currentSecrets = Array.isArray(state?.[CUSTOM_SECRET_KEY])
        ? state[CUSTOM_SECRET_KEY]
        : [];
    const previousActiveId = currentSecrets.find(secret => secret.active)?.id || '';
    const written = await secretRequest('/api/secrets/write', {
        key: CUSTOM_SECRET_KEY,
        value,
        label: DIRECT_SECRET_LABEL,
    });
    const newSecretId = String(written?.id || '');
    if (!newSecretId) throw new Error('酒馆没有返回密钥编号');

    // Adding a custom key makes it the globally active custom key. Restore the
    // user's previous main-chat key while this extension keeps using its own
    // explicit secret_id.
    if (previousActiveId
        && previousActiveId !== previousPluginSecretId
        && previousActiveId !== newSecretId) {
        try {
            await secretRequest('/api/secrets/rotate', {
                key: CUSTOM_SECRET_KEY,
                id: previousActiveId,
            });
        } catch (error) {
            await secretRequest('/api/secrets/delete', {
                key: CUSTOM_SECRET_KEY,
                id: newSecretId,
            }).catch(() => null);
            throw new Error(`无法恢复正文 API 的原密钥：${error.message}`);
        }
    }

    if (previousPluginSecretId && previousPluginSecretId !== newSecretId) {
        await secretRequest('/api/secrets/delete', {
            key: CUSTOM_SECRET_KEY,
            id: previousPluginSecretId,
        }).catch(error => {
            console.warn('[Krystal Scroll Memory] Failed to remove the old memory API key', error);
        });
    }
    return newSecretId;
}

function directFormValues() {
    const panel = document.getElementById('ksm-panel');
    return {
        apiUrl: panel?.querySelector('#ksm-direct-api-url')?.value || '',
        apiKey: panel?.querySelector('#ksm-direct-api-key')?.value || '',
        model: panel?.querySelector('#ksm-direct-model')?.value || '',
        memoryInstruction: panel?.querySelector('#ksm-memory-instruction')?.value || '',
        maxTokens: panel?.querySelector('#ksm-max-tokens')?.value || DEFAULT_MAX_TOKENS,
    };
}

async function saveDirectConfiguration({ notify = true } = {}) {
    const settings = pluginSettings();
    const form = directFormValues();
    const apiUrl = normalizeDirectApiUrl(form.apiUrl);
    const model = String(form.model || '').trim();
    if (!model) throw new Error('请输入模型名称');
    if (!form.apiKey.trim() && !settings.directSecretId) {
        throw new Error('请输入 API 密钥');
    }

    let secretId = settings.directSecretId;
    if (form.apiKey.trim()) {
        secretId = await storeDirectSecret(form.apiKey.trim(), settings.directSecretId);
    }

    settings.captureMode = 'direct';
    settings.directApiUrl = apiUrl;
    settings.directModel = model;
    settings.directSecretId = secretId;
    settings.memoryInstruction = normalizeMemoryInstruction(form.memoryInstruction);
    settings.maxTokens = clamp(
        Number(form.maxTokens) || DEFAULT_MAX_TOKENS,
        MIN_MAX_TOKENS,
        MAX_MAX_TOKENS,
    );
    context().saveSettingsDebounced();
    const keyInput = document.getElementById('ksm-direct-api-key');
    if (keyInput) keyInput.value = '';
    [
        document.getElementById('ksm-direct-api-url'),
        document.getElementById('ksm-direct-api-key'),
        document.getElementById('ksm-direct-model'),
        document.getElementById('ksm-memory-instruction'),
        document.getElementById('ksm-max-tokens'),
    ].filter(Boolean).forEach(input => delete input.dataset.dirty);
    runtimeStatus.captureState = 'idle';
    runtimeStatus.captureText = '捕获：独立 API 配置已保存，请测试连接';
    updateInjection();
    render();
    if (notify) toastr.success('记忆 API 与总结要求已安全保存');
    return settings;
}

async function saveMemoryConfiguration({ notify = true } = {}) {
    const settings = pluginSettings();
    const form = directFormValues();
    settings.memoryInstruction = normalizeMemoryInstruction(form.memoryInstruction);
    settings.maxTokens = clamp(
        Number(form.maxTokens) || DEFAULT_MAX_TOKENS,
        MIN_MAX_TOKENS,
        MAX_MAX_TOKENS,
    );
    context().saveSettingsDebounced();
    [
        document.getElementById('ksm-memory-instruction'),
        document.getElementById('ksm-max-tokens'),
    ].filter(Boolean).forEach(input => delete input.dataset.dirty);
    runtimeStatus.captureState = 'idle';
    runtimeStatus.captureText = settings.captureMode === 'profile'
        ? '捕获：总结要求已保存，请测试连接'
        : '捕获：总结要求已保存，等待下一轮';
    updateInjection();
    render();
    if (notify) toastr.success('记忆总结要求已保存');
    return settings;
}

async function saveVisibleConfiguration(options) {
    if (isDirectMode()) return saveDirectConfiguration(options);
    return saveMemoryConfiguration(options);
}

function restoreDefaultMemoryInstruction() {
    const settings = pluginSettings();
    settings.memoryInstruction = DEFAULT_MEMORY_INSTRUCTION;
    context().saveSettingsDebounced();
    const textarea = document.getElementById('ksm-memory-instruction');
    if (textarea) {
        textarea.value = DEFAULT_MEMORY_INSTRUCTION;
        delete textarea.dataset.dirty;
    }
    runtimeStatus.captureState = 'idle';
    runtimeStatus.captureText = '捕获：已恢复 Mufy 默认总结要求';
    updateInjection();
    render();
    toastr.success('已恢复 Mufy 默认记忆总结要求');
}

function directResponseText(data) {
    const content = data?.choices?.[0]?.message?.content
        ?? data?.choices?.[0]?.text
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

async function sendDirectRequest(messages, maxTokens = pluginSettings().maxTokens) {
    const settings = pluginSettings();
    const apiUrl = normalizeDirectApiUrl(settings.directApiUrl);
    if (!settings.directModel) throw new Error('请先填写模型名称并保存');
    if (!settings.directSecretId) throw new Error('请先填写 API 密钥并保存');

    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: getRequestHeaders(),
        cache: 'no-cache',
        body: JSON.stringify({
            stream: false,
            messages,
            model: settings.directModel,
            chat_completion_source: 'custom',
            custom_url: apiUrl,
            secret_id: settings.directSecretId,
            max_tokens: maxTokens,
            temperature: 0.2,
            use_sysprompt: true,
        }),
    });
    const raw = await response.text();
    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error(raw || `记忆 API 返回了无法解析的内容（${response.status}）`);
    }
    if (!response.ok || data?.error) {
        const message = data?.error?.message
            ?? data?.message
            ?? `请求失败（${response.status}）`;
        throw new Error(String(message));
    }
    const text = directResponseText(data);
    if (!text.trim()) throw new Error('记忆 API 返回了空内容');
    return {
        label: settings.directModel,
        text,
    };
}

async function sendProfileRequest(messages, maxTokens = pluginSettings().maxTokens) {
    const profile = selectedProfile();
    if (!profile) throw new Error('请先选择一个可用的记忆 API 连接配置');
    const service = connectionService();
    const prompt = service.constructPrompt(messages, profile.id);
    const response = await service.sendRequest(
        profile.id,
        prompt,
        maxTokens,
        {
            stream: false,
            extractData: true,
            includePreset: true,
            includeInstruct: true,
        },
    );
    const text = typeof response === 'string'
        ? response
        : response?.content ?? response?.text ?? '';
    if (!String(text).trim()) throw new Error('记忆 API 返回了空内容');
    return { label: profile.name, text: String(text) };
}

async function sendDedicatedRequest(messages, maxTokens = pluginSettings().maxTokens) {
    if (isDirectMode()) return sendDirectRequest(messages, maxTokens);
    return sendProfileRequest(messages, maxTokens);
}

async function captureMessageWithProfile(messageIndex, snapshot) {
    const current = context();
    const message = current.chat[messageIndex];
    if (!message || message.is_user) return false;
    if (current.chatId !== snapshot.chatId
        || String(message.mes || '') !== snapshot.messageText
        || Number(message.swipe_id || 0) !== snapshot.swipeId) {
        return false;
    }

    runtimeStatus.captureState = 'working';
    runtimeStatus.captureText = '捕获：独立 API 正在整理本轮记忆';
    render();

    try {
        const request = buildProfileCaptureRequest(messageIndex);
        const { label, text } = await sendDedicatedRequest(request.messages);
        const latest = context();
        const latestMessage = latest.chat[messageIndex];
        if (latest.chatId !== snapshot.chatId
            || !latestMessage
            || String(latestMessage.mes || '') !== snapshot.messageText
            || Number(latestMessage.swipe_id || 0) !== snapshot.swipeId) {
            runtimeStatus.captureState = 'warning';
            runtimeStatus.captureText = '捕获：对话或重说已变化，本次结果已丢弃';
            render();
            return false;
        }

        const capture = captureFromApiResponse(text);
        if (!capture.short.length) throw new Error('记忆 API 没有返回完整的短期记忆标签');
        if (request.archiveRequired && !capture.long.length) {
            throw new Error('短期记忆已满，但记忆 API 没有返回长期归档标签');
        }

        writeStoredCapture(latestMessage, capture, `独立 API · ${label}`, {
            archiveSourceDigest: request.archiveSourceDigest,
        });
        rebuildFromChat();
        await latest.saveChat();
        runtimeStatus.captureState = 'success';
        runtimeStatus.captureText = `捕获：成功 · 独立 API（${label}）· 短期 ${capture.short.length} / 长期 ${capture.long.length}`;
        render();
        return true;
    } catch (error) {
        runtimeStatus.captureState = 'error';
        runtimeStatus.captureText = `捕获：独立 API 失败 · ${error.message}`;
        console.error('[Krystal Scroll Memory] Dedicated capture failed', error);
        toastr.error(`卷轴记忆捕获失败：${error.message}`);
        render();
        return false;
    }
}

function queueProfileCapture(messageIndex) {
    const ctx = context();
    const message = ctx.chat[messageIndex];
    if (!message || message.is_user) return Promise.resolve(false);
    const snapshot = {
        chatId: ctx.chatId,
        messageText: String(message.mes || ''),
        swipeId: Number(message.swipe_id || 0),
    };
    captureQueue = captureQueue
        .catch(() => false)
        .then(() => captureMessageWithProfile(messageIndex, snapshot));
    return captureQueue;
}

async function testProfileConnection() {
    try {
        await saveVisibleConfiguration({ notify: false });
        runtimeStatus.captureState = 'working';
        runtimeStatus.captureText = '捕获：正在测试独立 API';
        render();
        const { label } = await sendDedicatedRequest([
            { role: 'system', content: '这是连接测试。' },
            { role: 'user', content: '只回复“连接成功”。' },
        ], 32);
        runtimeStatus.captureState = 'success';
        runtimeStatus.captureText = `捕获：独立 API 已就绪 · ${label}`;
        toastr.success(`记忆 API 连接成功：${label}`);
    } catch (error) {
        runtimeStatus.captureState = 'error';
        runtimeStatus.captureText = `捕获：连接测试失败 · ${error.message}`;
        toastr.error(`记忆 API 测试失败：${error.message}`);
    }
    render();
}

function readStoredCapture(message) {
    const stored = message?.extra?.[MESSAGE_META_KEY];
    if (!stored || typeof stored !== 'object') return null;
    const capture = {
        short: Array.isArray(stored.short) ? unique(stored.short) : [],
        long: Array.isArray(stored.long) ? unique(stored.long) : [],
        archiveSourceDigest: String(stored.archiveSourceDigest || ''),
    };
    return hasCapture(capture) ? capture : null;
}

function writeStoredCapture(message, capture, source, metadata = {}) {
    message.extra ??= {};
    const stored = {
        short: capture.short,
        long: capture.long,
        source,
        capturedAt: Date.now(),
        ...(metadata.archiveSourceDigest
            ? { archiveSourceDigest: String(metadata.archiveSourceDigest) }
            : {}),
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
    if (!message || message.is_user) return false;

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

    const sourceState = buildStateFromChat(messageIndex);
    const archiveRequired = sourceState.short.length >= MAX_SHORT;
    if (archiveRequired && !capture.long.length) {
        runtimeStatus.captureState = 'warning';
        runtimeStatus.captureText = '捕获：短期记忆已满，但本轮缺少长期归档标签';
        return false;
    }

    writeStoredCapture(message, capture, source, {
        archiveSourceDigest: archiveRequired && capture.long.length
            ? archiveSourceDigest(sourceState.short)
            : '',
    });
    runtimeStatus.captureState = 'success';
    runtimeStatus.captureText = `捕获：成功 · ${source} · 短期 ${capture.short.length} / 长期 ${capture.long.length}`;
    return true;
}

function buildStateFromChat(endExclusive = context().chat.length) {
    const ctx = context();
    const rebuilt = emptyState();
    const end = clamp(Number(endExclusive) || 0, 0, ctx.chat.length);
    const baseline = normalizeBaseline(ctx.chatMetadata?.[META_KEY]?.baseline);
    let startIndex = 0;
    if (baseline) {
        const boundary = resolveBaselineBoundary(baseline, ctx.chat, end);
        rebuilt.baseline = baseline;
        rebuilt.baselineStatus = boundary.status;
        rebuilt.short = baseline.short.map(item => ({ ...item, origin: 'baseline' }));
        rebuilt.long = baseline.long.map(item => ({ ...item, origin: 'baseline' }));
        rebuilt.volumeCount = baseline.volumeCount;
        startIndex = boundary.startIndex;
    }

    for (let index = startIndex; index < end; index++) {
        const message = ctx.chat[index];
        if (!message || message.is_user) continue;
        const stored = readStoredCapture(message);
        const longs = stored?.long ?? extract(LONG_RE, message.mes);
        const shorts = stored?.short ?? extract(SHORT_RE, message.mes);
        for (let captureIndex = 0; captureIndex < longs.length; captureIndex++) {
            const content = longs[captureIndex];
            const archiveBatch = rebuilt.short.slice(0, MAX_SHORT);
            const archiveReady = archiveBatch.length >= MAX_SHORT;
            const sourceMatches = !stored?.archiveSourceDigest
                || stored.archiveSourceDigest === archiveSourceDigest(archiveBatch);
            if (!archiveReady || !sourceMatches) {
                rebuilt.staleArchiveCount += 1;
                continue;
            }
            rebuilt.volumeCount += 1;
            rebuilt.long.push({
                id: `v-${rebuilt.volumeCount}-${hash(content)}`,
                volume: rebuilt.volumeCount,
                label: `第${chineseNumber(rebuilt.volumeCount)}卷`,
                content,
                messageIndex: index,
                captureKind: 'long',
                captureIndex,
                origin: 'capture',
            });
            rebuilt.short.splice(0, MAX_SHORT);
        }
        for (let captureIndex = 0; captureIndex < shorts.length; captureIndex++) {
            const content = shorts[captureIndex];
            const id = `m-${index}-${hash(content)}`;
            if (rebuilt.short.some(item => item.id === id || item.content === content)) continue;
            rebuilt.short.push({
                id,
                content,
                messageIndex: index,
                captureKind: 'short',
                captureIndex,
                origin: 'capture',
            });
        }
    }
    rebuilt.long = rebuilt.long.slice(-MAX_LONG);
    return rebuilt;
}

function rebuildFromChat() {
    const ctx = context();
    const rebuilt = buildStateFromChat(ctx.chat.length);
    ctx.chatMetadata[META_KEY] = rebuilt;
    if (rebuilt.baselineStatus === 'stale') {
        runtimeStatus.captureState = 'warning';
        runtimeStatus.captureText = '捕获：旧档来源已被重说、编辑或删除；请重新导出并导入旧档';
    } else if (rebuilt.staleArchiveCount > 0) {
        runtimeStatus.captureState = 'warning';
        runtimeStatus.captureText = `捕获：${rebuilt.staleArchiveCount} 卷已因分支变化回退为短期记忆，将在后续回复重建`;
    }
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

function renderSettings(panel) {
    const settings = pluginSettings();
    const profiles = settings.captureMode === 'profile' ? supportedProfiles() : [];
    const mode = panel.querySelector('#ksm-capture-mode');
    const directSettings = panel.querySelector('#ksm-direct-settings');
    const profileSettings = panel.querySelector('#ksm-profile-settings');
    const apiUrl = panel.querySelector('#ksm-direct-api-url');
    const apiKey = panel.querySelector('#ksm-direct-api-key');
    const model = panel.querySelector('#ksm-direct-model');
    const keyStatus = panel.querySelector('#ksm-direct-key-status');
    const profile = panel.querySelector('#ksm-profile');
    const memoryInstruction = panel.querySelector('#ksm-memory-instruction');
    const maxTokens = panel.querySelector('#ksm-max-tokens');
    const saveButton = panel.querySelector('[data-action="save-settings"]');
    const testButton = panel.querySelector('[data-action="test-profile"]');
    const profileExists = profiles.some(item => item.id === settings.connectionProfileId);
    const directConfigured = Boolean(
        settings.directApiUrl
        && settings.directModel
        && settings.directSecretId,
    );

    mode.value = settings.captureMode;
    directSettings.hidden = settings.captureMode !== 'direct';
    profileSettings.hidden = settings.captureMode !== 'profile';
    if (apiUrl.dataset.dirty !== 'true') apiUrl.value = settings.directApiUrl;
    if (model.dataset.dirty !== 'true') model.value = settings.directModel;
    apiKey.placeholder = settings.directSecretId
        ? '已安全保存；留空表示不修改'
        : '请输入记忆 API 密钥';
    keyStatus.textContent = settings.directSecretId
        ? '密钥已保存在酒馆 Secrets 中，插件不会显示或导出原文。'
        : '尚未保存密钥。';
    profile.innerHTML = [
        '<option value="">请选择记忆 API 连接配置</option>',
        ...profiles.map(item => {
            const detail = item.model ? ` · ${item.model}` : '';
            return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${escapeHtml(detail)}</option>`;
        }),
        ...(!profileExists && settings.connectionProfileId
            ? [`<option value="${escapeHtml(settings.connectionProfileId)}">原连接已不可用，请重新选择</option>`]
            : []),
    ].join('');
    profile.value = settings.connectionProfileId;
    if (memoryInstruction.dataset.dirty !== 'true') {
        memoryInstruction.value = settings.memoryInstruction;
    }
    if (maxTokens.dataset.dirty !== 'true') maxTokens.value = String(settings.maxTokens);
    maxTokens.disabled = settings.captureMode === 'inline';
    saveButton.hidden = false;
    testButton.hidden = settings.captureMode === 'inline';
    testButton.disabled = settings.captureMode === 'profile' && !profileExists;
    testButton.title = settings.captureMode === 'direct' && !directConfigured
        ? '会先保存当前填写内容，再测试连接'
        : '';
}

function render() {
    const panel = document.getElementById('ksm-panel');
    if (!panel) return;
    const data = state();
    panel.classList.toggle('ksm-open', panelOpen);
    panel.classList.toggle('ksm-settings-open', settingsOpen);
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
    renderSettings(panel);
}

function syncCaptureToCurrentSwipe(message) {
    const swipeId = Number(message?.swipe_id);
    if (!Number.isInteger(swipeId) || !message?.swipe_info?.[swipeId]) return;
    message.swipe_info[swipeId].extra ??= {};
    const stored = message.extra?.[MESSAGE_META_KEY];
    if (stored) {
        message.swipe_info[swipeId].extra[MESSAGE_META_KEY] = structuredClone(stored);
    } else {
        delete message.swipe_info[swipeId].extra[MESSAGE_META_KEY];
    }
}

function persistMemoryItemChange(item, kind, action, nextContent = '') {
    const ctx = context();
    const data = state();
    if (item.origin === 'baseline' && data.baseline) {
        const list = kind === 'long' ? data.baseline.long : data.baseline.short;
        const index = list.findIndex(candidate => candidate.id === item.id);
        if (index < 0) return false;
        if (action === 'save') list[index].content = clean(nextContent);
        if (action === 'delete') list.splice(index, 1);
        rebuildFromChat();
        void ctx.saveChat();
        return true;
    }

    if (item.origin === 'capture' && Number.isInteger(item.messageIndex)) {
        const message = ctx.chat[item.messageIndex];
        const stored = message?.extra?.[MESSAGE_META_KEY];
        const list = stored?.[kind];
        if (!Array.isArray(list)) return false;
        let index = Number(item.captureIndex);
        if (!Number.isInteger(index) || clean(list[index]) !== item.content) {
            index = list.findIndex(content => clean(content) === item.content);
        }
        if (index < 0) return false;
        if (action === 'save') list[index] = clean(nextContent);
        if (action === 'delete') list.splice(index, 1);
        if (!stored.short?.length && !stored.long?.length) {
            delete message.extra[MESSAGE_META_KEY];
        }
        syncCaptureToCurrentSwipe(message);
        rebuildFromChat();
        void ctx.saveChat();
        return true;
    }

    return false;
}

function downloadJson() {
    const data = state();
    const exportItem = item => {
        const exported = {
            id: item.id,
            content: item.content,
        };
        if (item.volume) exported.volume = item.volume;
        if (item.label) exported.label = item.label;
        if (item.sourceTurn) exported.sourceTurn = item.sourceTurn;
        return exported;
    };
    const exported = {
        version: STATE_VERSION,
        format: 'krystal-scroll-memory',
        short: data.short.map(exportItem),
        long: data.long.map(exportItem),
        volumeCount: data.volumeCount,
        source: createSourceSnapshot(context().chat),
        exportedAt: Date.now(),
    };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
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
            const ctx = context();
            const baseline = normalizeBaseline({
                short: parsed.short,
                long: parsed.long,
                volumeCount: parsed.volumeCount,
                source: normalizeSource(parsed.source) || createSourceSnapshot(ctx.chat),
                importedAt: Date.now(),
            });
            if (!baseline) throw new Error('文件里没有可导入的记忆');
            ctx.chatMetadata[META_KEY] = {
                ...emptyState(),
                baseline,
            };
            rebuildFromChat();
            void ctx.saveChat();
            const data = state();
            if (data.baselineStatus === 'stale') {
                toastr.warning('旧档已导入，但原聊天楼层与导出时不同；请重新导出旧档后再生成一次');
            } else {
                toastr.success(`旧档已固定导入，并合并当前聊天的新记忆（短期 ${data.short.length} / 长期 ${data.long.length}）`);
            }
        } catch (error) {
            toastr.error(`导入失败：${error.message}`);
        }
    };
    reader.readAsText(file);
}

function latestAssistantMessageIndex() {
    const chat = context().chat;
    for (let index = chat.length - 1; index >= 0; index--) {
        const message = chat[index];
        if (message && !message.is_user) return index;
    }
    return -1;
}

async function retryLastCapture() {
    const messageIndex = latestAssistantMessageIndex();
    if (messageIndex < 0) {
        toastr.warning('当前聊天还没有可整理的 AI 回复');
        return;
    }
    if (isDedicatedMode()) {
        await queueProfileCapture(messageIndex);
        return;
    }
    const captured = captureMessage(messageIndex, 'retry');
    if (captured) {
        rebuildFromChat();
        await context().saveChat();
        render();
        toastr.success('已重新捕获最后一轮记忆');
    } else {
        render();
        toastr.warning('最后一轮回复中没有找到完整记忆标签');
    }
}

function mountUi() {
    if (document.getElementById('ksm-launcher')) return;
    document.body.insertAdjacentHTML('beforeend', `
        <button id="ksm-launcher" type="button" title="卷轴记忆（可拖动）" aria-label="卷轴记忆（可拖动）">📜</button>
        <div id="ksm-panel" role="dialog" aria-label="卷轴记忆">
            <header class="ksm-title">
                <div><strong>Krystal · 卷轴记忆</strong><small>v${VERSION}</small></div>
                <div class="ksm-title-actions">
                    <button data-action="settings" title="记忆 API 设置" aria-label="记忆 API 设置">⚙</button>
                    <button data-action="close" title="关闭" aria-label="关闭">×</button>
                </div>
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
            <section id="ksm-settings" aria-label="记忆 API 设置">
                <h3>记忆生成方式</h3>
                <label class="ksm-setting-row">
                    <span>工作模式</span>
                    <select id="ksm-capture-mode">
                        <option value="direct">独立 API（直接填写）</option>
                        <option value="profile">酒馆连接配置（高级）</option>
                        <option value="inline">正文模型兼容模式</option>
                    </select>
                </label>
                <p class="ksm-setting-help">
                    独立 API 模式下，正文模型只负责演剧情；回复完成后，由另一条连接单独整理记忆。
                </p>
                <div id="ksm-direct-settings">
                    <label class="ksm-setting-row">
                        <span>API 地址</span>
                        <input id="ksm-direct-api-url" type="url" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" placeholder="https://你的接口地址/v1">
                    </label>
                    <p class="ksm-setting-help">
                        使用 OpenAI 兼容格式；填到 <code>/v1</code> 即可。若粘贴了 <code>/chat/completions</code>，保存时会自动移除。
                    </p>
                    <label class="ksm-setting-row">
                        <span>API 密钥</span>
                        <input id="ksm-direct-api-key" type="password" autocomplete="new-password" autocapitalize="none" spellcheck="false" placeholder="请输入记忆 API 密钥">
                    </label>
                    <p id="ksm-direct-key-status" class="ksm-setting-help">尚未保存密钥。</p>
                    <label class="ksm-setting-row">
                        <span>模型名称</span>
                        <input id="ksm-direct-model" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="例如 deepseek-chat">
                    </label>
                </div>
                <div id="ksm-profile-settings" hidden>
                    <label class="ksm-setting-row">
                        <span>连接配置</span>
                        <select id="ksm-profile"></select>
                    </label>
                    <p class="ksm-setting-help">
                        高级选项：读取酒馆已有的 Connection Profile。
                    </p>
                </div>
                <label class="ksm-setting-block" for="ksm-memory-instruction">
                    <span>记忆总结要求</span>
                    <textarea id="ksm-memory-instruction" maxlength="${MAX_MEMORY_INSTRUCTION_LENGTH}" spellcheck="false"></textarea>
                </label>
                <p class="ksm-setting-help ksm-setting-help-wide">
                    默认是原 Mufy 的短期与长期总结规则，可自行修改。“记什么、怎么概括”由这里控制；边界标签和第 21 轮归档仍由插件固定保护。
                </p>
                <label class="ksm-setting-row">
                    <span>最大输出</span>
                    <input id="ksm-max-tokens" type="number" min="${MIN_MAX_TOKENS}" max="${MAX_MAX_TOKENS}" step="100" inputmode="numeric">
                </label>
                <div class="ksm-settings-actions">
                    <button data-action="restore-default-instruction">恢复默认</button>
                    <button data-action="save-settings">保存设置</button>
                    <button data-action="test-profile">测试连接</button>
                </div>
            </section>
            <footer class="ksm-footer">
                <button data-action="rebuild">从当前聊天重建</button>
                <button data-action="retry-last">重试本轮</button>
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
        if (action === 'settings') settingsOpen = !settingsOpen;
        if (action === 'export') downloadJson();
        if (action === 'save-settings') {
            runtimeStatus.captureState = 'working';
            runtimeStatus.captureText = '捕获：正在保存设置';
            void saveVisibleConfiguration().catch(error => {
                runtimeStatus.captureState = 'error';
                runtimeStatus.captureText = `捕获：配置保存失败 · ${error.message}`;
                toastr.error(`卷轴记忆设置保存失败：${error.message}`);
                render();
            });
        }
        if (action === 'restore-default-instruction') restoreDefaultMemoryInstruction();
        if (action === 'test-profile') void testProfileConnection();
        if (action === 'retry-last') void retryLastCapture();
        if (action === 'rebuild' && confirm('将根据当前聊天中保存的记忆标签重建侧栏，继续吗？')) rebuildFromChat();
        if (action === 'save-item' || action === 'delete-item') {
            const article = button.closest('.ksm-item');
            const data = state();
            const list = activeTab === 'short' ? data.short : data.long;
            const index = list.findIndex(item => item.id === article.dataset.id);
            if (index >= 0) {
                const persisted = persistMemoryItemChange(
                    list[index],
                    activeTab,
                    action === 'save-item' ? 'save' : 'delete',
                    article.querySelector('textarea').value,
                );
                if (!persisted) {
                    toastr.warning('这条记忆来自未迁移的旧标签，暂时无法持久修改');
                }
            }
        }
        render();
    });
    document.getElementById('ksm-panel').addEventListener('input', event => {
        if ([
            'ksm-direct-api-url',
            'ksm-direct-api-key',
            'ksm-direct-model',
            'ksm-memory-instruction',
            'ksm-max-tokens',
        ].includes(event.target.id)) {
            event.target.dataset.dirty = 'true';
        }
    });
    document.getElementById('ksm-panel').addEventListener('change', event => {
        const settings = pluginSettings();
        if (event.target.id === 'ksm-capture-mode') {
            settings.captureMode = ['direct', 'profile', 'inline'].includes(event.target.value)
                ? event.target.value
                : 'direct';
            if (settings.captureMode === 'direct') {
                const configured = settings.directApiUrl
                    && settings.directModel
                    && settings.directSecretId;
                runtimeStatus.captureState = configured ? 'idle' : 'warning';
                runtimeStatus.captureText = configured
                    ? '捕获：独立 API 已配置，请先测试连接'
                    : '捕获：请填写地址、密钥和模型';
            } else if (settings.captureMode === 'profile') {
                runtimeStatus.captureState = settings.connectionProfileId ? 'idle' : 'warning';
                runtimeStatus.captureText = settings.connectionProfileId
                    ? '捕获：独立 API 已配置，等待下一轮'
                    : '捕获：请先选择记忆 API 连接配置';
            } else {
                runtimeStatus.captureState = 'idle';
                runtimeStatus.captureText = '捕获：正文模型兼容模式，等待下一轮';
            }
            savePluginSettings();
        }
        if (event.target.id === 'ksm-profile') {
            settings.connectionProfileId = String(event.target.value || '');
            runtimeStatus.captureState = settings.connectionProfileId ? 'idle' : 'warning';
            runtimeStatus.captureText = settings.connectionProfileId
                ? '捕获：独立 API 已配置，请先测试连接'
                : '捕获：请先选择记忆 API 连接配置';
            savePluginSettings();
        }
        if (event.target.id === 'ksm-max-tokens') {
            settings.maxTokens = clamp(
                Number(event.target.value) || DEFAULT_MAX_TOKENS,
                MIN_MAX_TOKENS,
                MAX_MAX_TOKENS,
            );
            delete event.target.dataset.dirty;
            context().saveSettingsDebounced();
        }
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
    [
        events.CONNECTION_PROFILE_CREATED,
        events.CONNECTION_PROFILE_UPDATED,
        events.CONNECTION_PROFILE_DELETED,
    ].filter(Boolean).forEach(event => ctx.eventSource.on(event, render));
    ctx.eventSource.on(events.CHAT_CHANGED, () => {
        updateInjection();
        render();
        window.setTimeout(hideAllMemoryBlocks, 50);
    });
    if (events.GENERATION_AFTER_COMMANDS) {
        ctx.eventSource.on(events.GENERATION_AFTER_COMMANDS, (generationType, _options, dryRun) => {
            if (dryRun || generationType === 'quiet' || generationType === 'impersonate') return;
            rawStreamText = '';
            trackRawStream = !isDedicatedMode();
            runtimeStatus.captureState = 'working';
            runtimeStatus.captureText = isDedicatedMode()
                ? '捕获：等待正文完成后调用独立 API'
                : '捕获：等待本轮 AI 回复';
            updateInjection();
        });
    }
    if (events.STREAM_TOKEN_RECEIVED) {
        ctx.eventSource.on(events.STREAM_TOKEN_RECEIVED, text => {
            if (trackRawStream) rawStreamText = String(text || '');
        });
    }
    ctx.eventSource.on(events.MESSAGE_RECEIVED, (messageIndex, generationType) => {
        const index = Number(messageIndex);
        if (generationType !== 'first_message' && isDedicatedMode()) {
            trackRawStream = false;
            rawStreamText = '';
            hideMemoryInMessage(index);
            void queueProfileCapture(index);
            return;
        }
        if (generationType !== 'first_message') {
            captureMessage(index, generationType);
        }
        rebuildFromChat();
        hideMemoryInMessage(index);
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
            runtimeStatus.captureText = isDedicatedMode()
                ? '捕获：聊天已编辑；如需更新记忆，请点“重试本轮”'
                : '捕获：聊天已编辑，已按当前内容重建';
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
