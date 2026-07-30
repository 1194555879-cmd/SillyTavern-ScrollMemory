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
const VERSION = '0.3.12';
const STATE_VERSION = 3;
const SETTINGS_VERSION = 5;
const SOURCE_DIGEST_VERSION = 2;
const CUSTOM_SECRET_KEY = 'api_key_custom';
const DIRECT_SECRET_LABEL = 'Krystal · 卷轴记忆专用 API';
const REMOTE_MANIFEST_URL = 'https://raw.githubusercontent.com/1194555879-cmd/SillyTavern-ScrollMemory/main/manifest.json';
const MAX_MEMORY_INSTRUCTION_LENGTH = 8000;
const MAX_SHORT = 20;
const MAX_LONG = 30;
const MAX_FACTS = 80;
const MAX_FACT_KEY_LENGTH = 80;
const MAX_FACT_CONTENT_LENGTH = 500;
const DEFAULT_MAX_TOKENS = 900;
const MIN_MAX_TOKENS = 200;
const MAX_MAX_TOKENS = 4000;
const LAUNCHER_MARGIN = 8;
const LAUNCHER_DRAG_THRESHOLD = 6;
const SHORT_RE = /【记忆条目】([\s\S]{1,1200}?)【记忆完】/g;
const LONG_RE = /【长期记忆条目】([\s\S]{1,4000}?)【长期记忆完】/g;
const FACT_RE = /【细节记忆】([\s\S]{1,8000}?)【细节记忆完】/g;
const MEMORY_BLOCK_RE = /【长期记忆条目】[\s\S]*?【长期记忆完】|【记忆条目】[\s\S]*?【记忆完】|【细节记忆】[\s\S]*?【细节记忆完】/g;
const FACT_CATEGORIES = [
    '人物与关系',
    '秘密与知情',
    '物品与地点',
    '承诺与日期',
    '身体与习惯',
    '未解线索',
    '其他',
];
const FACT_CATEGORY_META = {
    人物与关系: { icon: 'fa-user-group', hint: '身份、关系与称呼' },
    秘密与知情: { icon: 'fa-lock', hint: '秘密与人物知情边界' },
    物品与地点: { icon: 'fa-location-dot', hint: '关键物品、归属与地点' },
    承诺与日期: { icon: 'fa-calendar-check', hint: '约定、期限与重要日期' },
    身体与习惯: { icon: 'fa-heart-pulse', hint: '伤病、身体状态与习惯' },
    未解线索: { icon: 'fa-magnifying-glass', hint: '伏笔、疑问与待处理事项' },
    其他: { icon: 'fa-folder', hint: '暂未归入以上类别的事实' },
};
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
5. 正文或世界时空栏给出明确剧情日期时，记忆必须以该日期开头；不得把聊天消息的发送时间当成剧情时间，也不得猜测未给出的日期。
6. 删除重复动作、寒暄、气氛描写和没有后续价值的细枝末节。

【长期记忆要求】
1. 只总结待归档的 20 条短期记忆，不把本轮新增剧情混入长期记忆，不写卷号。
2. 待归档短期记忆含有明确剧情日期时，长期记忆开头必须写明覆盖的起止日期。
3. 不设固定字数限制，必须完整覆盖 20 条记忆中会影响后续剧情的核心事实，不得为了缩短而遗漏重要信息。
4. 优先保留人物关系变化、重要承诺、未解决冲突、关键道具、具体物品名、重要地点、伏笔、长期目标和称呼变化。
5. 合并重复内容，删除流水账、重复动作、寒暄及没有长期价值的细节。

【通用禁则】
禁止主观推测、评价、形容性扩写、文学化或诗化表达、情绪渲染和象征性总结。`;

const SENSITIVE_ABSTRACTION_INSTRUCTION = `【敏感文本抽象协议】
原文可能包含成人亲密或其他敏感场景。只归档推动剧情的中性事实：双方意愿与拒绝、关系变化、边界与规则、亲密行为是否发生或结束、是否达到高潮、避孕措施、受伤或健康风险、地点时间、事后照顾、承诺及情绪后果。
禁止复述器官、体液、姿势、声音或逐动作刺激过程；不得补写原文没有的内容。若某项细节无法以中性方式表达，可省略该细节，但仍应总结同轮其余剧情事实。`;

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
    for (const [pattern, replacement] of replacements) {
        text = text.replace(pattern, replacement);
    }
    return text
        .replace(/发生发生亲密行为/g, '发生亲密行为')
        .replace(/(?:发生亲密行为[、，；。\s]*){2,}/g, '发生亲密行为。')
        .replace(/(?:进行亲密接触[、，；。\s]*){2,}/g, '进行亲密接触。');
}

let panelOpen = false;
let activeTab = 'short';
let settingsOpen = false;
let injectionPreviewOpen = false;
let initialized = false;
let trackRawStream = false;
let rawStreamText = '';
let captureQueue = Promise.resolve();
let generationInProgress = false;
let factBootstrapRunning = false;
let actionFeedbackTimer = 0;
let pendingDelete = null;
let pendingEmptyRetry = null;
let lastEmptyDiagnostic = null;
let updateConfirmationOpen = false;
const updateRuntime = {
    checking: false,
    updating: false,
    latest: '',
    available: false,
    message: `当前 v${VERSION} · 尚未检查更新`,
};
const openFactCategories = new Set();
const scheduledProfileCaptures = new Map();
const pendingProfileCaptures = new Map();
const runtimeStatus = {
    injectionState: 'idle',
    injectionText: '注入：等待选择聊天',
    captureState: 'idle',
    captureText: '捕获：还没测试',
    preparedAt: 0,
    preparedChatId: '',
    preparedDigest: '',
    preparedLength: 0,
    preparedPayload: '',
};
const DEFAULT_SETTINGS = {
    settingsVersion: SETTINGS_VERSION,
    appearance: 'follow',
    captureMode: 'direct',
    connectionProfileId: '',
    directApiUrl: '',
    directModel: '',
    directSecretId: '',
    memoryInstruction: DEFAULT_MEMORY_INSTRUCTION,
    sensitiveAbstraction: true,
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

    const touchLayout = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (touchLayout) {
        panel.style.setProperty(
            'top',
            'max(76px, calc(env(safe-area-inset-top) + 48px))',
            'important',
        );
        panel.style.setProperty(
            'height',
            'calc(100dvh - 164px - env(safe-area-inset-bottom))',
            'important',
        );
        panel.style.setProperty(
            'max-height',
            'calc(100dvh - 164px - env(safe-area-inset-bottom))',
            'important',
        );
    } else {
        panel.style.removeProperty('top');
        panel.style.removeProperty('height');
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
        const opening = !panelOpen;
        panelOpen = opening;
        if (opening) refreshCurrentChatState({ showStatus: true });
        render();
    });
}

function emptyState() {
    return {
        version: STATE_VERSION,
        short: [],
        long: [],
        facts: [],
        factSeed: [],
        manualFacts: [],
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
    settings.appearance = ['follow', 'light', 'dark'].includes(settings.appearance)
        ? settings.appearance
        : DEFAULT_SETTINGS.appearance;
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
    settings.sensitiveAbstraction = settings.sensitiveAbstraction !== false;
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
    data.facts = normalizeFactItems(data.facts, 'state');
    data.factSeed = normalizeFactItems(data.factSeed, 'seed');
    data.manualFacts = normalizeFactOps(data.manualFacts);
    data.volumeCount = Number(data.volumeCount) || 0;
    data.baseline = normalizeBaseline(data.baseline);
    data.baselineStatus = ['none', 'fresh', 'stale'].includes(data.baselineStatus)
        ? data.baselineStatus
        : 'none';
    data.staleArchiveCount = Number(data.staleArchiveCount) || 0;
    let normalized = false;
    for (const item of [...data.short, ...data.long, ...data.facts, ...data.factSeed]) {
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

function normalizedSendDate(value) {
    if (value === undefined || value === null || value === '') return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function messageSnapshotText(message, digestVersion = SOURCE_DIGEST_VERSION) {
    const stableFields = [
        message?.is_user ? 'u' : 'a',
        Number(message?.swipe_id || 0),
        String(message?.mes || ''),
    ];
    if (digestVersion >= 2) return stableFields.join('␟');
    return [
        stableFields[0],
        normalizedSendDate(message?.send_date),
        stableFields[1],
        stableFields[2],
    ].join('␟');
}

function messageSnapshotDigest(message, digestVersion = SOURCE_DIGEST_VERSION) {
    return hash(messageSnapshotText(message, digestVersion));
}

function chatPrefixDigest(messages, digestVersion = SOURCE_DIGEST_VERSION) {
    return hash(messages.map(message => messageSnapshotText(message, digestVersion)).join('␞'));
}

function createSourceSnapshot(chat, requestedCount = chat.length) {
    const messageCount = clamp(Number(requestedCount) || 0, 0, chat.length);
    const messages = chat.slice(0, messageCount);
    const lastMessage = messages.at(-1);
    return {
        kind: 'sillytavern-chat',
        digestVersion: SOURCE_DIGEST_VERSION,
        chatMessages: messages.length,
        assistantTurns: messages.filter(message => message && !message.is_user).length,
        userTurns: messages.filter(message => message?.is_user).length,
        throughMessageIndex: messages.length - 1,
        throughSendDate: normalizedSendDate(lastMessage?.send_date),
        prefixDigest: chatPrefixDigest(messages, SOURCE_DIGEST_VERSION),
        beforeLastPrefixDigest: messages.length > 1
            ? chatPrefixDigest(messages.slice(0, -1), SOURCE_DIGEST_VERSION)
            : '',
        lastMessageDigest: lastMessage ? messageSnapshotDigest(lastMessage, SOURCE_DIGEST_VERSION) : '',
    };
}

function normalizeSource(source) {
    if (!source || typeof source !== 'object') return null;
    if (source.chatMessages === undefined || source.chatMessages === null) return null;
    const chatMessages = Math.max(0, Number(source.chatMessages) || 0);
    return {
        ...source,
        digestVersion: Math.max(1, Number(source.digestVersion) || 1),
        chatMessages,
        assistantTurns: Math.max(0, Number(source.assistantTurns) || 0),
        userTurns: Math.max(0, Number(source.userTurns) || 0),
        throughMessageIndex: Number.isInteger(Number(source.throughMessageIndex))
            ? Number(source.throughMessageIndex)
            : chatMessages - 1,
        prefixDigest: String(source.prefixDigest || ''),
        beforeLastPrefixDigest: String(source.beforeLastPrefixDigest || ''),
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

function normalizeFactCategory(value) {
    const category = clean(value);
    if (FACT_CATEGORIES.includes(category)) return category;
    const aliases = {
        人物: '人物与关系',
        关系: '人物与关系',
        人物关系: '人物与关系',
        秘密: '秘密与知情',
        知情: '秘密与知情',
        知情边界: '秘密与知情',
        物品: '物品与地点',
        地点: '物品与地点',
        道具: '物品与地点',
        承诺: '承诺与日期',
        日期: '承诺与日期',
        时间: '承诺与日期',
        身体: '身体与习惯',
        习惯: '身体与习惯',
        伤病: '身体与习惯',
        线索: '未解线索',
        伏笔: '未解线索',
        修正: '其他',
    };
    return aliases[category] || '其他';
}

function normalizeFactKey(value) {
    return clean(value)
        .replace(/[｜|]/g, '／')
        .replace(/\s+/g, ' ')
        .slice(0, MAX_FACT_KEY_LENGTH);
}

function factId(category, key) {
    return `f-${hash(`${normalizeFactCategory(category)}␟${normalizeFactKey(key).toLocaleLowerCase()}`)}`;
}

function normalizeFactOps(items) {
    if (!Array.isArray(items)) return [];
    return items
        .map(item => {
            if (!item || typeof item !== 'object') return null;
            const action = item.action === 'delete' ? 'delete' : 'upsert';
            const category = normalizeFactCategory(item.category);
            const key = normalizeFactKey(item.key);
            const content = clean(item.content).slice(0, MAX_FACT_CONTENT_LENGTH);
            if (!key || (action === 'upsert' && !content)) return null;
            return {
                action,
                category,
                key,
                content: action === 'delete' ? '' : content,
                updatedAt: Number(item.updatedAt) || Date.now(),
            };
        })
        .filter(Boolean);
}

function normalizeFactItems(items, origin = 'baseline') {
    if (!Array.isArray(items)) return [];
    const result = [];
    for (const item of items) {
        const source = item && typeof item === 'object' ? item : null;
        if (!source) continue;
        const category = normalizeFactCategory(source.category);
        const key = normalizeFactKey(source.key || source.label);
        const content = clean(source.content).slice(0, MAX_FACT_CONTENT_LENGTH);
        if (!key || !content) continue;
        const id = factId(category, key);
        const normalized = {
            ...source,
            id,
            category,
            key,
            content,
            origin,
            updatedAt: Number(source.updatedAt) || Date.now(),
        };
        const previous = result.findIndex(candidate => candidate.id === id);
        if (previous >= 0) result.splice(previous, 1);
        result.push(normalized);
    }
    return result.slice(-MAX_FACTS);
}

function applyFactOps(target, operations, metadata = {}) {
    for (let captureIndex = 0; captureIndex < operations.length; captureIndex++) {
        const operation = operations[captureIndex];
        const id = factId(operation.category, operation.key);
        const existing = target.findIndex(item => item.id === id);
        if (operation.action === 'delete') {
            if (existing >= 0) target.splice(existing, 1);
            continue;
        }
        const item = {
            id,
            category: operation.category,
            key: operation.key,
            content: operation.content,
            updatedAt: Number(operation.updatedAt) || Date.now(),
            captureKind: 'facts',
            captureIndex,
            ...metadata,
        };
        if (existing >= 0) target.splice(existing, 1);
        target.push(item);
    }
    if (target.length > MAX_FACTS) target.splice(0, target.length - MAX_FACTS);
}

function applyManualFactOps(target, operations) {
    for (const operation of operations) {
        const id = factId(operation.category, operation.key);
        const existing = target.find(item => item.id === id);
        if (existing && Number(existing.updatedAt) > Number(operation.updatedAt)) continue;
        applyFactOps(target, [operation], { origin: 'manual' });
    }
}

function normalizeBaseline(baseline) {
    if (!baseline || typeof baseline !== 'object') return null;
    const short = normalizeMemoryItems(baseline.short, 'short');
    const long = normalizeMemoryItems(baseline.long, 'long');
    const facts = normalizeFactItems(baseline.facts, 'baseline');
    if (!short.length && !long.length && !facts.length) return null;
    return {
        version: 2,
        short,
        long,
        facts,
        volumeCount: Math.max(
            Number(baseline.volumeCount) || 0,
            ...long.map(item => Number(item.volume) || 0),
        ),
        source: normalizeSource(baseline.source),
        importedAt: Number(baseline.importedAt) || Date.now(),
        terminalDetached: Boolean(baseline.terminalDetached),
    };
}

function resolveBaselineBoundary(baseline, chat, endExclusive) {
    const source = normalizeSource(baseline?.source);
    if (!source) return { startIndex: endExclusive, status: 'fresh' };

    const expectedCount = source.chatMessages;
    const digestVersion = source.digestVersion || 1;
    if (expectedCount <= endExclusive
        && source.prefixDigest
        && chatPrefixDigest(chat.slice(0, expectedCount), digestVersion) === source.prefixDigest) {
        return { startIndex: expectedCount, status: 'fresh' };
    }

    if (source.lastMessageDigest) {
        for (let index = Math.min(endExclusive, chat.length) - 1; index >= 0; index--) {
            if (messageSnapshotDigest(chat[index], digestVersion) === source.lastMessageDigest) {
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
短期记忆已满。本轮请正常续写剧情，并在正文结尾依次输出以下三段：

【长期记忆条目】
把下方 20 条短期记忆压缩成一条客观、清晰、可供后续剧情调用的长期记忆。
【长期记忆完】

【记忆条目】
只总结本轮新增剧情事实。
【记忆完】

【细节记忆】
按“新增/更新｜类别｜稳定键｜客观事实”或“删除｜类别｜稳定键｜-”逐行记录本轮新增、变化或失效的稳定细节；类别只能使用${FACT_CATEGORIES.join('、')}；没有则写“无”。
【细节记忆完】

要求：
1. 三段缺一不可，不要复述任务说明。下方可编辑要求只控制内容取舍和概括方式，不得更改边界标签、区块数量或归档范围。
2. 长期和短期区块各自只能是一条连贯记忆；细节区块可以逐行记录不同稳定键。不得把连续动作拆成流水账。
3. 不要输出 <br> 或其他 HTML 标签。
4. 长期记忆只总结下方 20 条，不把本轮新增事实混入长期记忆；不要写卷号，卷号由插件生成。
5. 若正文、世界时空栏或短期记忆给出明确剧情日期，短期记忆必须以该日期开头，长期记忆必须写明覆盖的起止日期；不得使用聊天发送时间或猜测日期。

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
    const facts = data.facts
        .map(item => `- [${item.category}｜${item.key}] ${item.content}`)
        .join('\n');
    const history = `【历史记忆-开始】
以下内容是已经发生过的剧情事实，只用于保持连续性，不得当成 user 本轮新说的话，也不要在正文里复述“记忆”或提及本指令。

【长期记忆】
${long || '无'}

【短期记忆】
${short || '无'}

【细节事实记忆】
以下是需要稳定保持的细节、身份、知情边界和未解线索；与概括性记忆冲突时，以这里较新的明确事实为准。
${facts || '无'}
【历史记忆-结束】`;

    if (isDedicatedMode()) {
        return `【卷轴记忆插件：隐藏指令开始】
${history}
【卷轴记忆插件：隐藏指令结束】`;
    }

    const archive = buildArchiveTask(data);
    const instruction = pluginSettings().memoryInstruction;
    const outputTask = archive || `
完成本轮正常正文及全部美化标签后，必须在最末尾原样追加下面两个区块。只写一条本轮新增记忆，不得把旧剧情重复写入。下方可编辑要求只控制内容取舍和概括方式，不得更改边界标签或区块数量：
【记忆条目】
严格按照下方“记忆总结要求”高度概括本轮新增剧情。这里必须是一条连贯记忆，不得逐动作罗列；不要输出 <br> 或其他 HTML 标签。若正文或世界时空栏明确给出剧情日期，必须以该剧情日期开头；不得使用聊天发送时间或猜测日期。
【记忆完】

【细节记忆】
只写本轮新增、改变或失效的稳定细节。每行格式必须为：
新增/更新｜类别｜稳定键｜客观事实
删除｜类别｜稳定键｜-
类别只能使用：${FACT_CATEGORIES.join('、')}。若没有变化，只写“无”。
【细节记忆完】

【可编辑的记忆总结要求】
${instruction}
【记忆总结要求结束】`;
    return `【卷轴记忆插件：隐藏指令开始】
你必须同时完成角色扮演正文与卷轴记忆输出。卷轴记忆区块是插件读取所必需的数据，不属于正文，也不受正文美化格式限制，不得省略。

${history}

${outputTask}
【卷轴记忆插件：隐藏指令结束】`;
}

function updateInjection({ markPrepared = false } = {}) {
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
            if (markPrepared) {
                runtimeStatus.preparedAt = Date.now();
                runtimeStatus.preparedChatId = String(ctx.chatId || '');
                runtimeStatus.preparedDigest = hash(payload);
                runtimeStatus.preparedLength = payload.length;
                runtimeStatus.preparedPayload = payload;
            }
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

function parseFactLines(text) {
    const operations = [];
    FACT_RE.lastIndex = 0;
    for (const match of String(text || '').matchAll(FACT_RE)) {
        const lines = clean(match[1]).split('\n');
        for (const rawLine of lines) {
            const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.、])\s*/, '').trim();
            if (!line || /^(?:无|没有|无变化|无需更新)[。.]?$/.test(line)) continue;
            const parts = line.split(/[｜|]/).map(part => clean(part));
            if (parts.length < 3) continue;
            const verb = parts[0].replace(/\s+/g, '');
            const deleting = /^(?:删除|移除|作废)$/.test(verb);
            const category = normalizeFactCategory(parts[1]);
            const key = normalizeFactKey(parts[2]);
            const content = deleting ? '' : clean(parts.slice(3).join('｜')).slice(0, MAX_FACT_CONTENT_LENGTH);
            if (!key || (!deleting && !content)) continue;
            operations.push({
                action: deleting ? 'delete' : 'upsert',
                category,
                key,
                content,
                updatedAt: Date.now(),
            });
        }
    }
    return normalizeFactOps(operations);
}

function extractCapture(text) {
    return {
        short: unique(extract(SHORT_RE, text)),
        long: unique(extract(LONG_RE, text)),
        facts: parseFactLines(text),
    };
}

function hasCapture(capture) {
    return Boolean(capture?.short?.length || capture?.long?.length || capture?.facts?.length);
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
    const settings = pluginSettings();
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
            const source = stripMemoryBlocks(message.mes).slice(-16000);
            const content = settings.sensitiveAbstraction
                ? abstractSensitiveSource(source)
                : source;
            return `【${role}｜${messageSpeaker(message)}】\n${content}`;
        })
        .join('\n\n');
    const referenceMessages = formatMessages(
        ctx.chat.slice(Math.max(0, turnStart - 4), turnStart),
    );
    const currentTurn = formatMessages(ctx.chat.slice(turnStart, messageIndex + 1));

    const abstractContext = value => (
        settings.sensitiveAbstraction ? abstractSensitiveSource(value) : String(value || '')
    );
    const memoryContext = (archiveRequired
        ? data.short.slice(0, MAX_SHORT)
        : data.short.slice(-6))
        .map((item, index) => `${index + 1}. ${abstractContext(item.content)}`)
        .join('\n');
    const factContext = data.facts
        .map(item => abstractContext(`${item.category}｜${item.key}｜${item.content}`))
        .join('\n');

    const outputFormat = archiveRequired
        ? `你必须按顺序输出且只输出以下三个区块：
【长期记忆条目】
把“待归档短期记忆”中的 20 条压缩成一条长期记忆
【长期记忆完】
【记忆条目】
只总结“本轮对话”中新发生的剧情事实
【记忆完】
【细节记忆】
逐行输出本轮需要新增、更新或删除的稳定细节；没有变化只写“无”
【细节记忆完】`
        : `你必须按顺序输出且只输出以下两个区块：
【记忆条目】
只总结“本轮对话”中新发生的剧情事实
【记忆完】
【细节记忆】
逐行输出本轮需要新增、更新或删除的稳定细节；没有变化只写“无”
【细节记忆完】`;
    const memoryInstruction = settings.memoryInstruction;
    const sensitiveAbstractionInstruction = settings.sensitiveAbstraction
        ? `\n\n${SENSITIVE_ABSTRACTION_INSTRUCTION}`
        : '';

    const systemPrompt = `你是独立的剧情记忆整理器，不参与角色扮演，也绝不续写剧情。
把对话高度压缩成客观、清晰、可供下一轮调用的事实记忆。

【固定协议】
1. 严格遵守下方边界标签；不要解释任务，不要使用 Markdown 代码块。可编辑要求只控制内容取舍和概括方式，不得更改本协议。
2. 【记忆条目】和【长期记忆条目】各自只能包含一条连贯记忆，不得把一个连续事件拆成逐动作流水账。
3. 不要复述旧记忆；不要输出 <br> 或任何 HTML 标签。
4. 若“本轮对话”或其世界时空栏明确给出剧情日期，【记忆条目】必须以该日期开头；若待归档短期记忆含有日期，【长期记忆条目】必须写明覆盖的起止日期。不得把聊天发送时间当成剧情时间，也不得猜测未给出的日期。
5. 【细节记忆】只记录跨轮仍有用的稳定事实：人物身份与关系、秘密及谁知道什么、关键物品与地点、承诺与日期、身体伤病与习惯、未解决线索。普通动作、气氛和已存在且未变化的事实不要重复。
6. 【细节记忆】每行必须严格使用“新增/更新｜类别｜稳定键｜客观事实”或“删除｜类别｜稳定键｜-”。类别只能是：${FACT_CATEGORIES.join('、')}。同一事实必须沿用现有稳定键；事实改变时更新原键，禁止换键后重复。若没有变化，只写“无”。${sensitiveAbstractionInstruction}

【记忆总结要求】
${memoryInstruction}
【记忆总结要求结束】

${outputFormat}`;

    const userPrompt = `【人物标识】
user：${ctx.name1 || 'user'}
主要角色：${ctx.name2 || 'char'}

${archiveRequired ? '【待归档短期记忆】' : '【最近短期记忆，仅用于去重与指代判断】'}
${memoryContext || '无'}

【现有细节事实，仅用于沿用稳定键、识别冲突和避免重复】
${factContext || '无'}

【本轮对话】
${currentTurn || '无'}

【前文参考，仅用于判断指代，禁止重复总结】
${referenceMessages || '无'}

请严格按指定边界标签输出。`;
    const safeUserPrompt = settings.sensitiveAbstraction
        ? abstractSensitiveSource(userPrompt)
        : userPrompt;

    return {
        archiveRequired,
        archiveSourceDigest: archiveRequired ? archiveSourceDigest(data.short) : '',
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: safeUserPrompt },
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
            facts: normalizeFactOps(parsed.facts),
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
        sensitiveAbstraction: panel?.querySelector('#ksm-sensitive-abstraction')?.value !== 'off',
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
    settings.sensitiveAbstraction = Boolean(form.sensitiveAbstraction);
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
    settings.sensitiveAbstraction = Boolean(form.sensitiveAbstraction);
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

function emptyResponseReason(data) {
    const finishReason = String(
        data?.choices?.[0]?.finish_reason
        ?? data?.choices?.[0]?.finishReason
        ?? data?.candidates?.[0]?.finishReason
        ?? '',
    ).toLowerCase();
    const blockReason = String(
        data?.promptFeedback?.blockReason
        ?? data?.prompt_feedback?.block_reason
        ?? '',
    ).toLowerCase();
    if (finishReason.includes('content_filter')
        || finishReason.includes('safety')
        || blockReason.includes('safety')
        || blockReason.includes('block')) {
        return '疑似被上游安全过滤';
    }
    if (finishReason.includes('length') || finishReason.includes('max_token')) {
        return '输出长度达到上限';
    }
    if (!data?.choices?.length && !data?.candidates?.length && !data?.output_text && !data?.content) {
        return '上游没有返回候选结果';
    }
    return finishReason ? `上游结束原因：${finishReason}` : '上游未说明原因';
}

function buildEmptyDiagnostic(data, options = {}) {
    const finishReason = String(
        data?.choices?.[0]?.finish_reason
        ?? data?.choices?.[0]?.finishReason
        ?? data?.candidates?.[0]?.finishReason
        ?? '未提供',
    );
    const blockReason = String(
        data?.promptFeedback?.blockReason
        ?? data?.prompt_feedback?.block_reason
        ?? '未提供',
    );
    let endpoint = '酒馆连接配置';
    if (options.apiUrl) {
        try {
            endpoint = new URL(options.apiUrl).host;
        } catch {
            endpoint = '自定义接口';
        }
    }
    const headers = options.response?.headers;
    const requestId = headers?.get?.('x-request-id')
        || headers?.get?.('request-id')
        || headers?.get?.('cf-ray')
        || '未提供';
    return {
        time: new Date().toLocaleString(),
        attempt: Number(options.attempt) || 1,
        model: String(options.model || '未提供'),
        endpoint,
        httpStatus: options.response?.status ?? '未提供',
        contentType: headers?.get?.('content-type') || '未提供',
        requestId,
        finishReason,
        blockReason,
        choices: Array.isArray(data?.choices) ? data.choices.length : 0,
        candidates: Array.isArray(data?.candidates) ? data.candidates.length : 0,
        responseKeys: data && typeof data === 'object'
            ? Object.keys(data).slice(0, 16).join(', ') || '无'
            : '非对象响应',
        elapsedMs: Math.max(0, Math.round(Number(options.elapsedMs) || 0)),
        reason: emptyResponseReason(data),
    };
}

function formatEmptyDiagnostic(diagnostic = lastEmptyDiagnostic) {
    if (!diagnostic) return '暂无空回诊断';
    return [
        'Krystal · 卷轴记忆空回诊断',
        `时间：${diagnostic.time}`,
        `模型：${diagnostic.model}`,
        `接口主机：${diagnostic.endpoint}`,
        `请求序号：第 ${diagnostic.attempt} 次（本次可能已计费）`,
        `HTTP：${diagnostic.httpStatus}`,
        `Content-Type：${diagnostic.contentType}`,
        `Request ID：${diagnostic.requestId}`,
        `finish reason：${diagnostic.finishReason}`,
        `block reason：${diagnostic.blockReason}`,
        `choices / candidates：${diagnostic.choices} / ${diagnostic.candidates}`,
        `响应字段：${diagnostic.responseKeys}`,
        `耗时：${diagnostic.elapsedMs}ms`,
        `插件判断：${diagnostic.reason}`,
        '诊断不包含 API 密钥、原始剧情或完整请求内容。',
    ].join('\n');
}

async function copyLastEmptyDiagnostic() {
    const text = formatEmptyDiagnostic();
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.append(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }
    showActionFeedback('空回诊断已复制');
}

function saferRetryMessages(messages) {
    const reminder = `${SENSITIVE_ABSTRACTION_INSTRUCTION}

【空响应重试要求】
只处理已经发生的剧情事实。省略所有身体、姿势、声音与逐动作过程，只保留人物、意愿、边界、关系变化、关键结果、健康风险、地点和事后安排。必须按原协议输出完整边界标签。`;
    return messages.map((message, index) => ({
        ...message,
        content: index === 0 && message.role === 'system'
            ? `${message.content}\n\n${reminder}`
            : abstractSensitiveSource(message.content),
    }));
}

function requestEmptyRetryConfirmation(diagnostic) {
    lastEmptyDiagnostic = diagnostic;
    if (pendingEmptyRetry?.resolve) {
        pendingEmptyRetry.resolve(false);
    }
    panelOpen = true;
    settingsOpen = false;
    injectionPreviewOpen = false;
    runtimeStatus.captureState = 'warning';
    runtimeStatus.captureText = `捕获：API 空回 · ${diagnostic.reason} · 等待你决定是否再次计费重试`;
    return new Promise(resolve => {
        pendingEmptyRetry = { resolve, diagnostic };
        render();
    });
}

function settleEmptyRetry(shouldRetry) {
    const pending = pendingEmptyRetry;
    if (!pending) return;
    pendingEmptyRetry = null;
    runtimeStatus.captureState = shouldRetry ? 'working' : 'error';
    runtimeStatus.captureText = shouldRetry
        ? '捕获：已确认再次请求，正在使用加强抽象重试'
        : '捕获：已停止；没有发送第二次请求';
    render();
    pending.resolve(Boolean(shouldRetry));
}

function renderPersistentDialogs(panel) {
    const emptyDialog = panel.querySelector('#ksm-empty-retry-confirm');
    const emptyVisible = Boolean(pendingEmptyRetry);
    emptyDialog.hidden = !emptyVisible;
    emptyDialog.classList.toggle('is-visible', emptyVisible);
    if (emptyVisible) {
        emptyDialog.querySelector('.ksm-decision-reason').textContent
            = `${pendingEmptyRetry.diagnostic.reason}。第一笔请求可能已经计费。`;
    }

    const updateDialog = panel.querySelector('#ksm-update-confirm');
    updateDialog.hidden = !updateConfirmationOpen;
    updateDialog.classList.toggle('is-visible', updateConfirmationOpen);
    if (updateConfirmationOpen) {
        updateDialog.querySelector('.ksm-decision-reason').textContent
            = `当前 v${VERSION}，将更新到 v${updateRuntime.latest || '最新版本'}。更新后页面会自动刷新。`;
    }
}

async function sendDirectRequest(messages, maxTokens = pluginSettings().maxTokens) {
    const settings = pluginSettings();
    const apiUrl = normalizeDirectApiUrl(settings.directApiUrl);
    if (!settings.directModel) throw new Error('请先填写模型名称并保存');
    if (!settings.directSecretId) throw new Error('请先填写 API 密钥并保存');

    const runAttempt = async (requestMessages, attempt) => {
        const startedAt = performance.now();
        const response = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            cache: 'no-cache',
            body: JSON.stringify({
                stream: false,
                messages: requestMessages,
                model: settings.directModel,
                chat_completion_source: 'custom',
                custom_url: apiUrl,
                secret_id: settings.directSecretId,
                max_tokens: maxTokens,
                temperature: attempt === 1 ? 0.2 : 0.1,
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
        return {
            data,
            response,
            text: directResponseText(data),
            diagnostic: buildEmptyDiagnostic(data, {
                attempt,
                model: settings.directModel,
                apiUrl,
                response,
                elapsedMs: performance.now() - startedAt,
            }),
        };
    };

    const first = await runAttempt(messages, 1);
    if (first.text.trim()) {
        return { label: settings.directModel, text: first.text };
    }

    const authorized = await requestEmptyRetryConfirmation(first.diagnostic);
    if (!authorized) {
        throw new Error(`API 返回空内容（${first.diagnostic.reason}）；已停止，未发送第二次请求`);
    }

    const second = await runAttempt(saferRetryMessages(messages), 2);
    if (second.text.trim()) {
        return { label: settings.directModel, text: second.text };
    }
    lastEmptyDiagnostic = second.diagnostic;
    render();
    throw new Error(`加强抽象重试后仍为空（${second.diagnostic.reason}）`);
}

async function sendProfileRequest(messages, maxTokens = pluginSettings().maxTokens) {
    const profile = selectedProfile();
    if (!profile) throw new Error('请先选择一个可用的记忆 API 连接配置');
    const service = connectionService();
    for (let attempt = 1; attempt <= 2; attempt++) {
        const startedAt = performance.now();
        const requestMessages = attempt === 1 ? messages : saferRetryMessages(messages);
        const prompt = service.constructPrompt(requestMessages, profile.id);
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
            : response?.content ?? response?.text ?? directResponseText(response);
        if (String(text).trim()) return { label: profile.name, text: String(text) };

        const responseData = response && typeof response === 'object' ? response : {};
        const diagnostic = buildEmptyDiagnostic(responseData, {
            attempt,
            model: profile.model || profile.name,
            elapsedMs: performance.now() - startedAt,
        });
        lastEmptyDiagnostic = diagnostic;
        if (attempt === 1) {
            const authorized = await requestEmptyRetryConfirmation(diagnostic);
            if (!authorized) {
                throw new Error(`API 返回空内容（${diagnostic.reason}）；已停止，未发送第二次请求`);
            }
            runtimeStatus.captureState = 'working';
            runtimeStatus.captureText = '捕获：已确认再次请求，正在使用加强抽象重试';
            render();
        } else {
            render();
            throw new Error(`加强抽象重试后仍为空（${diagnostic.reason}）`);
        }
    }
    throw new Error('记忆 API 返回空内容');
}

async function sendDedicatedRequest(messages, maxTokens = pluginSettings().maxTokens) {
    if (isDirectMode()) return sendDirectRequest(messages, maxTokens);
    return sendProfileRequest(messages, maxTokens);
}

async function captureMessageWithProfile(messageIndex, snapshot, options = {}) {
    const current = context();
    const message = current.chat[messageIndex];
    if (!message || message.is_user) return false;
    if (current.chatId !== snapshot.chatId
        || String(message.mes || '') !== snapshot.messageText
        || Number(message.swipe_id || 0) !== snapshot.swipeId) {
        return false;
    }
    detachImportedTerminalMemory();

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

        const replacedExistingCapture = Boolean(readStoredCapture(latestMessage));
        writeStoredCapture(latestMessage, capture, `独立 API · ${label}`, {
            archiveSourceDigest: request.archiveSourceDigest,
        });
        rebuildFromChat();
        await latest.saveChat();
        const currentState = state();
        const manualRetry = options.reason === 'retry' || options.reason === 'repair';
        const action = manualRetry
            ? (replacedExistingCapture
                ? '重试已替换本轮原总结（不会重复新增）'
                : '重试已补写本轮总结')
            : (replacedExistingCapture ? '自动已更新本轮总结' : '自动已新增本轮总结');
        runtimeStatus.captureState = 'success';
        runtimeStatus.captureText = `捕获：${action} · 独立 API（${label}）· 当前短期 ${currentState.short.length}/${MAX_SHORT} · 本轮细节 ${capture.facts.length}`;
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

function resolveAssistantMessageIndex(messageIndex) {
    const ctx = context();
    const numericIndex = messageIndex === undefined || messageIndex === null
        ? Number.NaN
        : Number(messageIndex);
    if (Number.isInteger(numericIndex)) {
        const candidate = ctx.chat[numericIndex];
        if (candidate && !candidate.is_user) return numericIndex;
    }
    return latestAssistantMessageIndex();
}

function profileCaptureKey(chatId, messageIndex, message) {
    return [
        String(chatId || ''),
        messageIndex,
        Number(message?.swipe_id || 0),
        hash(String(message?.mes || '')),
    ].join('␟');
}

function queueProfileCapture(messageIndex, options = {}) {
    const ctx = context();
    const resolvedIndex = resolveAssistantMessageIndex(messageIndex);
    const message = ctx.chat[resolvedIndex];
    if (!message || message.is_user) return Promise.resolve(false);
    const force = Boolean(options.force);
    if (!force && readStoredCapture(message)) return Promise.resolve(false);
    const snapshot = {
        chatId: ctx.chatId,
        messageText: String(message.mes || ''),
        swipeId: Number(message.swipe_id || 0),
    };
    const key = profileCaptureKey(snapshot.chatId, resolvedIndex, message);
    const pending = pendingProfileCaptures.get(key);
    if (pending) return pending;

    const task = captureQueue
        .catch(() => false)
        .then(() => {
            const latest = context();
            const latestMessage = latest.chat[resolvedIndex];
            if (latest.chatId !== snapshot.chatId
                || !latestMessage
                || latestMessage.is_user
                || String(latestMessage.mes || '') !== snapshot.messageText
                || Number(latestMessage.swipe_id || 0) !== snapshot.swipeId) {
                return false;
            }
            if (!force && readStoredCapture(latestMessage)) return false;
            return captureMessageWithProfile(resolvedIndex, snapshot, options);
        });
    pendingProfileCaptures.set(key, task);
    captureQueue = task.catch(() => false);
    void task.finally(() => {
        if (pendingProfileCaptures.get(key) === task) pendingProfileCaptures.delete(key);
    }).catch(() => false);
    return task;
}

function scheduleProfileCapture(messageIndex, generationType = 'normal', delay = 140) {
    if (!isDedicatedMode() || generationType === 'first_message') return;
    const ctx = context();
    const chatId = String(ctx.chatId || '');
    const numericIndex = messageIndex === undefined || messageIndex === null
        ? Number.NaN
        : Number(messageIndex);
    const timerKey = `${chatId}:${Number.isInteger(numericIndex) ? numericIndex : 'latest'}`;
    const previousTimer = scheduledProfileCaptures.get(timerKey);
    if (previousTimer) window.clearTimeout(previousTimer);
    const timer = window.setTimeout(() => {
        scheduledProfileCaptures.delete(timerKey);
        if (String(context().chatId || '') !== chatId) return;
        if (generationType === 'swipe-select' && generationInProgress) return;
        const resolvedIndex = resolveAssistantMessageIndex(messageIndex);
        const message = context().chat[resolvedIndex];
        if (!message || message.is_user || !String(message.mes || '').trim()) return;
        const force = ['swipe', 'regenerate', 'continue', 'append', 'appendFinal']
            .includes(String(generationType));
        hideMemoryInMessage(resolvedIndex);
        void queueProfileCapture(resolvedIndex, {
            force,
            reason: 'auto',
            generationType,
        });
    }, delay);
    scheduledProfileCaptures.set(timerKey, timer);
}

function clearScheduledProfileCaptures() {
    for (const timer of scheduledProfileCaptures.values()) window.clearTimeout(timer);
    scheduledProfileCaptures.clear();
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

function buildFactBootstrapRequest() {
    const data = state();
    const long = data.long.map(item => `【${item.label}】${item.content}`).join('\n\n');
    const short = data.short.map((item, index) => `${index + 1}. ${item.content}`).join('\n');
    return [
        {
            role: 'system',
            content: `你是剧情事实数据库整理器。请从已有长期与短期记忆中提取跨轮仍有用的稳定细节，不续写剧情，不猜测。

必须只输出：
【细节记忆】
新增/更新｜类别｜稳定键｜客观事实
【细节记忆完】

类别只能是：${FACT_CATEGORIES.join('、')}。
稳定键应简短且能长期复用，例如“顾明远身份”“方伊慈-林夕死因知情边界”“段逐闲车内大白兔”。
同一事实只保留一条；冲突时采用时间更晚、表达更明确的版本。必须区分“事实本身”和“谁知道该事实”。不要收录普通动作、气氛、修辞和一次性对话。最多输出 ${MAX_FACTS} 条。`,
        },
        {
            role: 'user',
            content: `【长期记忆】
${long || '无'}

【短期记忆】
${short || '无'}

请整理完整细节事实集。`,
        },
    ];
}

async function bootstrapFactsFromMemory() {
    if (factBootstrapRunning) return false;
    if (!isDedicatedMode()) {
        toastr.warning('整理现有记忆需要先启用独立 API 模式');
        return false;
    }
    const data = state();
    if (!data.short.length && !data.long.length) {
        toastr.warning('目前没有可整理的长期或短期记忆');
        return false;
    }
    factBootstrapRunning = true;
    runtimeStatus.captureState = 'working';
    runtimeStatus.captureText = '捕获：正在从现有记忆整理细节事实';
    render();
    try {
        const { label, text } = await sendDedicatedRequest(
            buildFactBootstrapRequest(),
            Math.max(pluginSettings().maxTokens, 1800),
        );
        const facts = parseFactLines(text).filter(item => item.action === 'upsert');
        if (!facts.length) throw new Error('记忆 API 没有返回可用的细节记忆区块');
        const current = state();
        current.factSeed = normalizeFactItems(facts.slice(-MAX_FACTS), 'seed');
        context().chatMetadata[META_KEY] = current;
        rebuildFromChat();
        await context().saveChat();
        activeTab = 'facts';
        runtimeStatus.captureState = 'success';
        runtimeStatus.captureText = `捕获：细节整理完成 · 独立 API（${label}）· ${state().facts.length} 条`;
        toastr.success(`已从现有记忆整理 ${state().facts.length} 条细节事实`);
        render();
        return true;
    } catch (error) {
        runtimeStatus.captureState = 'error';
        runtimeStatus.captureText = `捕获：细节整理失败 · ${error.message}`;
        toastr.error(`细节记忆整理失败：${error.message}`);
        render();
        return false;
    } finally {
        factBootstrapRunning = false;
        render();
    }
}

function readStoredCapture(message) {
    const stored = message?.extra?.[MESSAGE_META_KEY];
    if (!stored || typeof stored !== 'object') return null;
    const capture = {
        short: Array.isArray(stored.short) ? unique(stored.short) : [],
        long: Array.isArray(stored.long) ? unique(stored.long) : [],
        facts: normalizeFactOps(stored.facts),
        archiveSourceDigest: String(stored.archiveSourceDigest || ''),
        capturedAt: Number(stored.capturedAt) || 0,
        source: String(stored.source || ''),
    };
    return hasCapture(capture) ? capture : null;
}

function createStoredCapture(capture, source, metadata = {}) {
    return {
        short: capture.short,
        long: capture.long,
        facts: normalizeFactOps(capture.facts),
        source,
        capturedAt: Date.now(),
        ...(metadata.archiveSourceDigest
            ? { archiveSourceDigest: String(metadata.archiveSourceDigest) }
            : {}),
    };
}

function writeStoredCapture(message, capture, source, metadata = {}) {
    message.extra ??= {};
    const stored = createStoredCapture(capture, source, metadata);
    message.extra[MESSAGE_META_KEY] = stored;

    const swipeId = Number(message.swipe_id);
    if (Number.isInteger(swipeId) && message.swipe_info?.[swipeId]) {
        message.swipe_info[swipeId].extra ??= {};
        message.swipe_info[swipeId].extra[MESSAGE_META_KEY] = structuredClone(stored);
    }
}

function writeStoredCaptureToSwipe(message, swipeId, capture, source, metadata = {}) {
    if (!Number.isInteger(swipeId) || !message?.swipe_info?.[swipeId]) return false;
    message.swipe_info[swipeId].extra ??= {};
    if (!message.swipe_info[swipeId].extra[MESSAGE_META_KEY]) {
        message.swipe_info[swipeId].extra[MESSAGE_META_KEY] = createStoredCapture(
            capture,
            source,
            metadata,
        );
    }
    return true;
}

function syncCaptureFromCurrentSwipe(message) {
    const swipeId = Number(message?.swipe_id);
    if (!Number.isInteger(swipeId) || !message?.swipe_info?.[swipeId]) return;
    message.extra ??= {};
    const stored = message.swipe_info[swipeId].extra?.[MESSAGE_META_KEY];
    if (stored) {
        message.extra[MESSAGE_META_KEY] = structuredClone(stored);
    } else {
        delete message.extra[MESSAGE_META_KEY];
    }
}

function messageForSwipe(message, swipeId) {
    const swipeText = Array.isArray(message?.swipes) ? message.swipes[swipeId] : undefined;
    if (typeof swipeText !== 'string') return null;
    return {
        ...message,
        mes: swipeText,
        swipe_id: swipeId,
    };
}

function findSwipeByDigest(message, expectedDigest, digestVersion) {
    if (!expectedDigest || !Array.isArray(message?.swipes)) return -1;
    for (let swipeId = 0; swipeId < message.swipes.length; swipeId++) {
        const candidate = messageForSwipe(message, swipeId);
        if (candidate && messageSnapshotDigest(candidate, digestVersion) === expectedDigest) {
            return swipeId;
        }
    }
    return -1;
}

function captureWasCreatedAfterImport(message, baseline) {
    const stored = readStoredCapture(message);
    return Boolean(
        stored?.capturedAt
        && stored.capturedAt >= Number(baseline?.importedAt || 0),
    );
}

function resolveImportedTerminalIndex(baseline, chat) {
    const source = normalizeSource(baseline?.source);
    if (!source || !Array.isArray(chat) || !chat.length) return -1;

    const digestVersion = source.digestVersion || 1;
    const expectedIndex = source.chatMessages - 1;
    if (source.lastMessageDigest) {
        const digestMatches = [];
        for (let index = 0; index < chat.length; index++) {
            const message = chat[index];
            if (!message || message.is_user) continue;
            const selectedMatches = messageSnapshotDigest(message, digestVersion)
                === source.lastMessageDigest;
            const swipeMatches = findSwipeByDigest(
                message,
                source.lastMessageDigest,
                digestVersion,
            ) >= 0;
            if (selectedMatches || swipeMatches) digestMatches.push(index);
        }
        if (digestMatches.length) {
            digestMatches.sort(
                (left, right) => Math.abs(left - expectedIndex) - Math.abs(right - expectedIndex),
            );
            return digestMatches[0];
        }
    }

    // Archives exported before v0.3.0 do not have beforeLastPrefixDigest.
    // Resolve their terminal floor by conversation turn counts instead of a
    // brittle absolute array index. This survives Tauri migrations that move
    // the same assistant floor while preserving the user/assistant sequence.
    const targetAssistantTurns = source.assistantTurns;
    const targetUserTurns = source.userTurns;
    if (!targetAssistantTurns) return -1;

    let assistantTurns = 0;
    let userTurns = 0;
    for (let index = 0; index < chat.length; index++) {
        const message = chat[index];
        if (!message) continue;
        if (message.is_user) {
            userTurns += 1;
            continue;
        }
        assistantTurns += 1;
        if (assistantTurns !== targetAssistantTurns) continue;
        const userCountMatches = !targetUserTurns || userTurns === targetUserTurns;
        return userCountMatches && captureWasCreatedAfterImport(message, baseline)
            ? index
            : -1;
    }
    return -1;
}

function detachImportedTerminalMemory() {
    const ctx = context();
    const data = state();
    const baseline = data.baseline;
    const source = normalizeSource(baseline?.source);
    if (!baseline || baseline.terminalDetached || !source || !baseline.short.length) {
        return { detached: false, needsCapture: false, replacedStaticTerminal: false };
    }

    const terminalIndex = resolveImportedTerminalIndex(baseline, ctx.chat);
    const message = ctx.chat[terminalIndex];
    if (terminalIndex < 0 || !message || message.is_user) {
        return { detached: false, needsCapture: false, replacedStaticTerminal: false };
    }

    const digestVersion = source.digestVersion || 1;
    const selectedMatches = messageSnapshotDigest(message, digestVersion) === source.lastMessageDigest;
    const fullPrefixMatches = source.prefixDigest
        && chatPrefixDigest(ctx.chat.slice(0, source.chatMessages), digestVersion) === source.prefixDigest;
    const beforePrefixMatches = source.beforeLastPrefixDigest
        && chatPrefixDigest(ctx.chat.slice(0, terminalIndex), digestVersion) === source.beforeLastPrefixDigest;
    const originalSwipeId = findSwipeByDigest(message, source.lastMessageDigest, digestVersion);
    const currentStoredCapture = readStoredCapture(message);
    const currentCaptureReplacesStaticTerminal = Boolean(
        currentStoredCapture?.capturedAt
        && currentStoredCapture.capturedAt >= baseline.importedAt,
    );
    if (!selectedMatches
        && !fullPrefixMatches
        && !beforePrefixMatches
        && originalSwipeId < 0
        && !currentCaptureReplacesStaticTerminal) {
        return { detached: false, needsCapture: false, replacedStaticTerminal: false };
    }

    const terminalMemory = baseline.short.at(-1);
    const terminalSourceTurn = Number(terminalMemory?.sourceTurn) || 0;
    const terminalFacts = terminalSourceTurn
        ? baseline.facts.filter(item => Number(item.sourceTurn) === terminalSourceTurn)
        : [];
    const capture = {
        short: [terminalMemory.content],
        long: [],
        facts: terminalFacts.map(item => ({
            action: 'upsert',
            category: item.category,
            key: item.key,
            content: item.content,
            updatedAt: item.updatedAt,
        })),
    };

    if (currentCaptureReplacesStaticTerminal) {
        // Old archive files did not always include beforeLastPrefixDigest. A
        // capture created after import on that exact terminal floor is the
        // current selected swipe's replacement, so keep it in message.extra
        // and remove the static terminal summary from the baseline.
        if (originalSwipeId >= 0 && originalSwipeId !== Number(message.swipe_id)) {
            writeStoredCaptureToSwipe(message, originalSwipeId, capture, '导入旧档末轮');
        }
    } else if (selectedMatches || fullPrefixMatches) {
        if (!readStoredCapture(message)) {
            writeStoredCapture(message, capture, '导入旧档末轮');
        }
    } else if (originalSwipeId >= 0) {
        writeStoredCaptureToSwipe(message, originalSwipeId, capture, '导入旧档末轮');
    }

    baseline.short.pop();
    if (terminalFacts.length) {
        const detachedIds = new Set(terminalFacts.map(item => item.id));
        baseline.facts = baseline.facts.filter(item => !detachedIds.has(item.id));
    }
    baseline.source = createSourceSnapshot(ctx.chat, terminalIndex);
    baseline.terminalDetached = true;
    data.baseline = baseline;
    ctx.chatMetadata[META_KEY] = data;
    ctx.saveMetadataDebounced();

    if (!currentCaptureReplacesStaticTerminal) syncCaptureFromCurrentSwipe(message);
    const needsCapture = !readStoredCapture(message);
    if (needsCapture) {
        runtimeStatus.captureState = 'warning';
        runtimeStatus.captureText = '捕获：旧档末轮已接管；请点“重试本轮”生成当前 swipe 的新记忆';
    }
    return {
        detached: true,
        needsCapture,
        messageIndex: terminalIndex,
        replacedStaticTerminal: currentCaptureReplacesStaticTerminal,
    };
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
    detachImportedTerminalMemory();

    const streamCapture = extractCapture(rawStreamText);
    const chatCapture = extractCapture(message.mes);
    const capture = hasCapture(streamCapture) ? streamCapture : chatCapture;
    const source = hasCapture(streamCapture) ? '生成原文' : '聊天文本';

    if (!capture.short.length) {
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
    runtimeStatus.captureText = `捕获：成功 · ${source} · 短期 ${capture.short.length} / 长期 ${capture.long.length} / 细节 ${capture.facts.length}`;
    return true;
}

function buildStateFromChat(endExclusive = context().chat.length) {
    const ctx = context();
    const rebuilt = emptyState();
    const end = clamp(Number(endExclusive) || 0, 0, ctx.chat.length);
    const previousState = ctx.chatMetadata?.[META_KEY];
    const baseline = normalizeBaseline(previousState?.baseline);
    rebuilt.factSeed = normalizeFactItems(previousState?.factSeed, 'seed');
    rebuilt.manualFacts = normalizeFactOps(previousState?.manualFacts);
    let startIndex = 0;
    if (baseline) {
        const boundary = resolveBaselineBoundary(baseline, ctx.chat, end);
        rebuilt.baseline = baseline;
        rebuilt.baselineStatus = boundary.status;
        rebuilt.short = baseline.short.map(item => ({ ...item, origin: 'baseline' }));
        rebuilt.long = baseline.long.map(item => ({ ...item, origin: 'baseline' }));
        rebuilt.facts = baseline.facts.map(item => ({ ...item, origin: 'baseline' }));
        rebuilt.volumeCount = baseline.volumeCount;
        startIndex = boundary.startIndex;
    }
    applyFactOps(
        rebuilt.facts,
        rebuilt.factSeed.map(item => ({
            action: 'upsert',
            category: item.category,
            key: item.key,
            content: item.content,
            updatedAt: item.updatedAt,
        })),
        { origin: 'seed' },
    );

    for (let index = 0; index < end; index++) {
        const message = ctx.chat[index];
        if (!message || message.is_user) continue;
        const stored = readStoredCapture(message);
        const capturedAfterImport = Boolean(
            baseline
            && stored?.capturedAt
            && stored.capturedAt >= baseline.importedAt,
        );
        // A stale imported archive can point past the end of a migrated or
        // shortened chat. Captures created after that archive was imported are
        // new dynamic floors, so they must still participate in the rebuild
        // even when their numeric index is below the old static boundary.
        if (index < startIndex && !capturedAfterImport) continue;
        const longs = stored?.long ?? extract(LONG_RE, message.mes);
        const shorts = stored?.short ?? extract(SHORT_RE, message.mes);
        const facts = stored?.facts ?? parseFactLines(message.mes);
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
        applyFactOps(rebuilt.facts, facts, {
            messageIndex: index,
            origin: 'capture',
        });
    }
    rebuilt.long = rebuilt.long.slice(-MAX_LONG);
    applyManualFactOps(rebuilt.facts, rebuilt.manualFacts);
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
    return rebuilt;
}

function refreshCurrentChatState({ showStatus = false } = {}) {
    const ctx = context();
    if (!ctx.chatId) return null;
    const before = state();
    const beforeShort = before.short.length;
    const detached = detachImportedTerminalMemory();
    const rebuilt = rebuildFromChat();
    if (showStatus && runtimeStatus.captureState !== 'working') {
        const recovered = Math.max(0, rebuilt.short.length - beforeShort);
        const latestIndex = latestAssistantMessageIndex();
        const latestHasCapture = latestIndex >= 0
            && Boolean(readStoredCapture(ctx.chat[latestIndex]));
        runtimeStatus.captureState = detached.replacedStaticTerminal || recovered > 0
            ? 'success'
            : 'idle';
        runtimeStatus.captureText = detached.replacedStaticTerminal
            ? `捕获：已移除重 roll 前的旧总结 · 当前短期 ${rebuilt.short.length}/${MAX_SHORT}`
            : (recovered > 0
                ? `捕获：自动重建找回 ${recovered} 条短期记忆 · 当前 ${rebuilt.short.length}/${MAX_SHORT}`
                : `捕获：已自动核对楼层底片 · 最后一轮${latestHasCapture ? '有' : '没有'}底片 · 当前短期 ${rebuilt.short.length}/${MAX_SHORT}`);
        render();
    }
    return rebuilt;
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

function isNewerVersion(candidate, current) {
    const left = String(candidate || '').split('.').map(part => Number.parseInt(part, 10) || 0);
    const right = String(current || '').split('.').map(part => Number.parseInt(part, 10) || 0);
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index++) {
        if ((left[index] || 0) > (right[index] || 0)) return true;
        if ((left[index] || 0) < (right[index] || 0)) return false;
    }
    return false;
}

async function checkForPluginUpdate({ notify = false } = {}) {
    if (updateRuntime.checking || updateRuntime.updating) return;
    updateRuntime.checking = true;
    updateRuntime.message = '正在检查 GitHub 新版本…';
    render();
    try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 8000);
        let response;
        try {
            response = await fetch(`${REMOTE_MANIFEST_URL}?t=${Date.now()}`, {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal,
            });
        } finally {
            window.clearTimeout(timer);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const remote = await response.json();
        const latest = String(remote?.version || '').trim();
        if (!latest) throw new Error('远端清单没有版本号');
        updateRuntime.latest = latest;
        updateRuntime.available = isNewerVersion(latest, VERSION);
        updateRuntime.message = updateRuntime.available
            ? `发现 v${latest} · 可以在这里直接更新`
            : `当前 v${VERSION} · 已是最新版本`;
        if (notify) {
            showActionFeedback(updateRuntime.available
                ? `发现新版本 v${latest}`
                : '当前已经是最新版本');
        }
    } catch (error) {
        updateRuntime.message = `检查失败 · ${error.message}`;
        if (notify) showActionFeedback(`检查更新失败：${error.message}`, 'error', 2600);
    } finally {
        updateRuntime.checking = false;
        render();
    }
}

function extensionFolderName() {
    try {
        const pathname = decodeURIComponent(new URL(import.meta.url).pathname);
        const marker = '/third-party/';
        const markerIndex = pathname.indexOf(marker);
        if (markerIndex >= 0) {
            const folder = pathname.slice(markerIndex + marker.length).split('/')[0];
            if (folder) return folder;
        }
    } catch {
        // Fall through to the repository folder name.
    }
    return 'SillyTavern-ScrollMemory';
}

async function discoverExtensionType(folder) {
    try {
        const response = await fetch('/api/extensions/discover', {
            method: 'GET',
            headers: getRequestHeaders(),
            cache: 'no-store',
        });
        if (!response.ok) return null;
        const list = await response.json();
        const target = `third-party/${folder}`;
        const found = Array.isArray(list) ? list.find(item => item?.name === target) : null;
        return ['global', 'local', 'system'].includes(found?.type) ? found.type : null;
    } catch {
        return null;
    }
}

async function performPluginUpdate() {
    if (updateRuntime.updating) return;
    updateConfirmationOpen = false;
    updateRuntime.updating = true;
    updateRuntime.message = '正在通过酒馆更新卷轴记忆…';
    render();
    try {
        const folder = extensionFolderName();
        const type = await discoverExtensionType(folder);
        const response = await fetch('/api/extensions/update', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                extensionName: folder,
                global: type === 'global',
            }),
        });
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(detail || response.statusText || `HTTP ${response.status}`);
        }
        const result = await response.json().catch(() => ({}));
        if (result?.isUpToDate) {
            updateRuntime.available = false;
            updateRuntime.latest = VERSION;
            updateRuntime.message = `当前 v${VERSION} · 已是最新版本`;
            showActionFeedback('卷轴记忆已经是最新版本');
            return;
        }
        updateRuntime.available = false;
        updateRuntime.message = `更新成功 · ${result?.shortCommitHash || '正在刷新'}`;
        showActionFeedback('更新成功，正在刷新页面…', 'success', 0);
        window.setTimeout(() => window.location.reload(), 1000);
    } catch (error) {
        updateRuntime.message = `更新失败 · ${error.message}`;
        showActionFeedback(`更新失败：${error.message}`, 'error', 3200);
        toastr.error(`卷轴记忆更新失败：${error.message}`);
    } finally {
        updateRuntime.updating = false;
        render();
    }
}

function renderSettings(panel) {
    const settings = pluginSettings();
    const profiles = settings.captureMode === 'profile' ? supportedProfiles() : [];
    const appearance = panel.querySelector('#ksm-appearance');
    const mode = panel.querySelector('#ksm-capture-mode');
    const directSettings = panel.querySelector('#ksm-direct-settings');
    const profileSettings = panel.querySelector('#ksm-profile-settings');
    const apiUrl = panel.querySelector('#ksm-direct-api-url');
    const apiKey = panel.querySelector('#ksm-direct-api-key');
    const model = panel.querySelector('#ksm-direct-model');
    const keyStatus = panel.querySelector('#ksm-direct-key-status');
    const profile = panel.querySelector('#ksm-profile');
    const memoryInstruction = panel.querySelector('#ksm-memory-instruction');
    const sensitiveAbstraction = panel.querySelector('#ksm-sensitive-abstraction');
    const maxTokens = panel.querySelector('#ksm-max-tokens');
    const updateStatus = panel.querySelector('#ksm-update-status');
    const checkUpdateButton = panel.querySelector('[data-action="check-update"]');
    const performUpdateButton = panel.querySelector('[data-action="request-update"]');
    const diagnosticStatus = panel.querySelector('#ksm-diagnostic-status');
    const copyDiagnosticButton = panel.querySelector('[data-action="copy-empty-diagnostic"]');
    const saveButton = panel.querySelector('[data-action="save-settings"]');
    const testButton = panel.querySelector('[data-action="test-profile"]');
    const profileExists = profiles.some(item => item.id === settings.connectionProfileId);
    const directConfigured = Boolean(
        settings.directApiUrl
        && settings.directModel
        && settings.directSecretId,
    );

    appearance.value = settings.appearance;
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
    sensitiveAbstraction.value = settings.sensitiveAbstraction ? 'on' : 'off';
    if (maxTokens.dataset.dirty !== 'true') maxTokens.value = String(settings.maxTokens);
    maxTokens.disabled = settings.captureMode === 'inline';
    saveButton.hidden = false;
    testButton.hidden = settings.captureMode === 'inline';
    testButton.disabled = settings.captureMode === 'profile' && !profileExists;
    testButton.title = settings.captureMode === 'direct' && !directConfigured
        ? '会先保存当前填写内容，再测试连接'
        : '';
    updateStatus.textContent = updateRuntime.message;
    checkUpdateButton.disabled = updateRuntime.checking || updateRuntime.updating;
    checkUpdateButton.querySelector('span').textContent = updateRuntime.checking ? '检查中…' : '检查更新';
    performUpdateButton.hidden = !updateRuntime.available;
    performUpdateButton.disabled = updateRuntime.updating;
    performUpdateButton.querySelector('span').textContent = updateRuntime.updating ? '更新中…' : '立即更新';
    diagnosticStatus.textContent = lastEmptyDiagnostic
        ? `最近一次：${lastEmptyDiagnostic.reason} · 第 ${lastEmptyDiagnostic.attempt} 次请求`
        : '暂无空回诊断';
    copyDiagnosticButton.disabled = !lastEmptyDiagnostic;
}

function renderInjectionPreview(panel) {
    const textarea = panel.querySelector('#ksm-injection-text');
    const meta = panel.querySelector('#ksm-injection-meta');
    if (!textarea || !meta || !injectionPreviewOpen) return;
    const ctx = context();
    const currentPayload = ctx.chatId ? buildPayload() : '';
    const preparedForCurrentChat = runtimeStatus.preparedChatId === String(ctx.chatId || '')
        && runtimeStatus.preparedAt
        && runtimeStatus.preparedPayload;
    const payload = preparedForCurrentChat ? runtimeStatus.preparedPayload : currentPayload;
    const registered = ctx.extensionPrompts?.[MODULE]?.value === currentPayload;
    const preparedTime = preparedForCurrentChat
        ? new Date(runtimeStatus.preparedAt).toLocaleTimeString()
        : '尚未生成';
    const sourceLabel = preparedForCurrentChat ? '最近一次生成前实际登记' : '当前待发送';
    meta.textContent = `${sourceLabel} · 酒馆当前登记：${registered ? '成功' : '未确认'} · user 层 depth 0 · ${payload.length} 字 · 时间：${preparedTime}`;
    textarea.value = payload;
}

async function copyInjectionPreview() {
    const textarea = document.getElementById('ksm-injection-text');
    if (!textarea) return;
    try {
        await navigator.clipboard.writeText(textarea.value);
    } catch {
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
    }
    toastr.success('已复制本轮实际登记的记忆提示词');
}

function applyAppearance(panel) {
    const appearance = pluginSettings().appearance;
    panel.dataset.appearance = appearance;
    const launcher = document.getElementById('ksm-launcher');
    if (launcher) launcher.dataset.appearance = appearance;
}

function renderEditableItem(item, kind, data) {
    const label = kind === 'facts'
        ? item.key
        : (kind === 'long'
            ? (item.label || '长期记忆')
            : (item.label || `短期记忆 ${data.short.indexOf(item) + 1}`));
    const icon = kind === 'facts'
        ? 'fa-bookmark'
        : (kind === 'long' ? 'fa-book-open' : 'fa-feather-pointed');
    return `
        <article class="ksm-item ksm-item-${kind}" data-id="${escapeHtml(item.id)}">
            <header class="ksm-item-header">
                <span class="ksm-item-title">
                    <span class="ksm-item-mark" aria-hidden="true"><i class="fa-solid ${icon}"></i></span>
                    <span class="ksm-item-label">${escapeHtml(label)}</span>
                </span>
                <span class="ksm-item-actions">
                    <button data-action="save-item" title="保存这条记忆" aria-label="保存这条记忆">
                        <i class="fa-solid fa-check" aria-hidden="true"></i>
                    </button>
                    <button data-action="delete-item" title="删除这条记忆" aria-label="删除这条记忆">
                        <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                    </button>
                </span>
            </header>
            <textarea aria-label="${escapeHtml(label)}">${escapeHtml(item.content)}</textarea>
        </article>`;
}

function renderFactGroups(items, data) {
    return FACT_CATEGORIES
        .map(category => ({
            category,
            items: items.filter(item => item.category === category),
            meta: FACT_CATEGORY_META[category] || FACT_CATEGORY_META.其他,
        }))
        .filter(group => group.items.length)
        .map(group => {
            const expanded = openFactCategories.has(group.category);
            return `
                <section class="ksm-fact-group${expanded ? ' is-open' : ''}" data-category="${escapeHtml(group.category)}">
                    <button class="ksm-fact-group-head" data-action="toggle-fact-group" aria-expanded="${expanded}">
                        <span class="ksm-fact-group-icon" aria-hidden="true">
                            <i class="fa-solid ${group.meta.icon}"></i>
                        </span>
                        <span class="ksm-fact-group-copy">
                            <strong>${escapeHtml(group.category)}</strong>
                            <small>${escapeHtml(group.meta.hint)}</small>
                        </span>
                        <span class="ksm-fact-group-count">${group.items.length}</span>
                        <i class="fa-solid fa-chevron-down ksm-fact-group-caret" aria-hidden="true"></i>
                    </button>
                    <div class="ksm-fact-group-body">
                        <div class="ksm-fact-group-inner">
                            <div class="ksm-fact-items">
                                ${group.items.map(item => renderEditableItem(item, 'facts', data)).join('')}
                            </div>
                        </div>
                    </div>
                </section>`;
        })
        .join('');
}


const TAB_PRESENTATION = {
    short: { title: '短期记忆', hint: '近期剧情摘要', icon: 'fa-feather-pointed' },
    long: { title: '长期记忆', hint: '归档后的剧情卷轴', icon: 'fa-book-open' },
    facts: { title: '细节记忆', hint: '人物、关系与关键线索', icon: 'fa-bookmark' },
};

function replayClass(element, className, duration = 360) {
    if (!element) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    window.setTimeout(() => element.classList.remove(className), duration);
}

function revealOverlay(element) {
    if (!element) return;
    element.classList.remove('is-visible');
    void element.offsetWidth;
    window.requestAnimationFrame(() => element.classList.add('is-visible'));
}

function showActionFeedback(message, state = 'success', duration = 1800) {
    const feedback = document.getElementById('ksm-action-feedback');
    if (!feedback) return;
    window.clearTimeout(actionFeedbackTimer);
    feedback.hidden = false;
    feedback.dataset.state = state;
    const icon = feedback.querySelector('i');
    if (icon) {
        icon.className = state === 'working'
            ? 'fa-solid fa-spinner'
            : (state === 'error' ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-circle-check');
    }
    const copy = feedback.querySelector('.ksm-action-feedback-copy');
    if (copy) copy.textContent = message;
    revealOverlay(feedback);
    if (duration > 0) {
        actionFeedbackTimer = window.setTimeout(() => {
            feedback.classList.remove('is-visible');
            window.setTimeout(() => { feedback.hidden = true; }, 220);
        }, duration);
    }
}

function hideDeleteConfirmation() {
    pendingDelete = null;
    const prompt = document.getElementById('ksm-delete-confirm');
    if (prompt) {
        prompt.classList.remove('is-visible');
        window.setTimeout(() => { prompt.hidden = true; }, 180);
    }
}

function requestDeleteConfirmation(item, kind, label) {
    pendingDelete = { id: item.id, kind, label };
    const prompt = document.getElementById('ksm-delete-confirm');
    if (!prompt) return;
    prompt.querySelector('.ksm-delete-confirm-copy').textContent = `确定删除“${label}”吗？`;
    prompt.hidden = false;
    revealOverlay(prompt);
}

function confirmPendingDelete() {
    if (!pendingDelete) return;
    const { id, kind, label } = pendingDelete;
    const data = state();
    const list = kind === 'short' ? data.short : (kind === 'long' ? data.long : data.facts);
    const item = list.find(candidate => candidate.id === id);
    if (!item) {
        hideDeleteConfirmation();
        showActionFeedback('这条记忆已经不存在', 'error');
        return;
    }
    const persisted = kind === 'facts'
        ? persistFactChange(item, 'delete')
        : persistMemoryItemChange(item, kind, 'delete');
    hideDeleteConfirmation();
    if (!persisted) {
        toastr.warning('这条记忆来自未迁移的旧标签，暂时无法持久修改');
        showActionFeedback('删除失败：这条旧记忆暂时无法修改', 'error', 2600);
        return;
    }
    render();
    showActionFeedback(`已删除：${label}`);
}

function animateCurrentView() {
    replayClass(document.getElementById('ksm-current-view'), 'is-switching', 420);
    replayClass(document.getElementById('ksm-list'), 'is-switching', 420);
}

function render() {
    const panel = document.getElementById('ksm-panel');
    if (!panel) return;
    applyAppearance(panel);
    const data = state();
    panel.classList.toggle('ksm-open', panelOpen);
    panel.classList.toggle('ksm-settings-open', settingsOpen);
    panel.classList.toggle('ksm-preview-open', injectionPreviewOpen);
    for (const tab of panel.querySelectorAll('[data-tab]')) {
        const selected = tab.dataset.tab === activeTab;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
    }
    panel.querySelector('[data-action="settings"]').classList.toggle('active', settingsOpen);
    panel.querySelector('#ksm-short-count').textContent = `${data.short.length}/${MAX_SHORT}`;
    panel.querySelector('#ksm-long-count').textContent = `${data.long.length}/${MAX_LONG}`;
    panel.querySelector('#ksm-fact-count').textContent = `${data.facts.length}/${MAX_FACTS}`;
    const tabPresentation = TAB_PRESENTATION[activeTab];
    panel.querySelector('#ksm-current-view-icon').className = `fa-solid ${tabPresentation.icon}`;
    panel.querySelector('#ksm-current-view-title').textContent = tabPresentation.title;
    panel.querySelector('#ksm-current-view-hint').textContent = tabPresentation.hint;
    const injectionStatus = panel.querySelector('[data-status="injection"]');
    const captureStatus = panel.querySelector('[data-status="capture"]');
    injectionStatus.dataset.state = runtimeStatus.injectionState;
    captureStatus.dataset.state = runtimeStatus.captureState;
    injectionStatus.querySelector('span:last-child').textContent = runtimeStatus.injectionText;
    captureStatus.querySelector('span:last-child').textContent = runtimeStatus.captureText;
    const bootstrapButton = panel.querySelector('[data-action="bootstrap-facts"]');
    if (bootstrapButton) {
        bootstrapButton.disabled = factBootstrapRunning;
        const buttonLabel = bootstrapButton.querySelector('.ksm-button-label');
        if (buttonLabel) {
            buttonLabel.textContent = factBootstrapRunning ? '整理中…' : '整理细节';
        } else {
            bootstrapButton.textContent = factBootstrapRunning ? '整理中…' : '整理细节';
        }
    }
    const items = activeTab === 'short'
        ? data.short
        : (activeTab === 'long' ? data.long : data.facts);
    panel.querySelector('#ksm-list').innerHTML = items.length
        ? (activeTab === 'facts'
            ? renderFactGroups(items, data)
            : items.map(item => renderEditableItem(item, activeTab, data)).join(''))
        : (activeTab === 'facts'
            ? `<div class="ksm-empty">
                    <span class="ksm-empty-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></span>
                    <strong>还没有细节事实</strong>
                    <span>点底部“整理细节”，从现有长期与短期记忆自动建立。</span>
                </div>`
            : `<div class="ksm-empty">
                    <span class="ksm-empty-icon"><i class="fa-solid fa-feather-pointed"></i></span>
                    <strong>这里还没有记忆</strong>
                    <span>继续聊天后，本轮摘要会自动出现在这里。</span>
                </div>`);
    renderSettings(panel);
    renderInjectionPreview(panel);
    renderPersistentDialogs(panel);
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
        if (!stored.short?.length && !stored.long?.length && !stored.facts?.length) {
            delete message.extra[MESSAGE_META_KEY];
        }
        syncCaptureToCurrentSwipe(message);
        rebuildFromChat();
        void ctx.saveChat();
        return true;
    }

    return false;
}

function persistFactChange(item, action, nextContent = '') {
    const ctx = context();
    const data = state();
    const category = normalizeFactCategory(item.category);
    const key = normalizeFactKey(item.key);
    const content = clean(nextContent).slice(0, MAX_FACT_CONTENT_LENGTH);
    if (!key || (action === 'save' && !content)) return false;
    const id = factId(category, key);
    data.manualFacts = normalizeFactOps(data.manualFacts)
        .filter(operation => factId(operation.category, operation.key) !== id);
    data.manualFacts.push({
        action: action === 'delete' ? 'delete' : 'upsert',
        category,
        key,
        content: action === 'delete' ? '' : content,
        updatedAt: Date.now(),
    });
    ctx.chatMetadata[META_KEY] = data;
    rebuildFromChat();
    void ctx.saveChat();
    return true;
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
    const exportFact = item => ({
        id: item.id,
        category: item.category,
        key: item.key,
        content: item.content,
        updatedAt: item.updatedAt,
        ...(item.sourceTurn ? { sourceTurn: item.sourceTurn } : {}),
    });
    const exported = {
        version: STATE_VERSION,
        format: 'krystal-scroll-memory',
        short: data.short.map(exportItem),
        long: data.long.map(exportItem),
        facts: data.facts.map(exportFact),
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
            const importedFacts = Array.isArray(parsed.facts)
                ? parsed.facts
                : (Array.isArray(parsed.notes?.corrections)
                    ? parsed.notes.corrections.map((content, index) => ({
                        category: '其他',
                        key: `导入修正 ${index + 1}`,
                        content,
                    }))
                    : []);
            const baseline = normalizeBaseline({
                short: parsed.short,
                long: parsed.long,
                facts: importedFacts,
                volumeCount: parsed.volumeCount,
                source: normalizeSource(parsed.source) || createSourceSnapshot(ctx.chat),
                importedAt: Date.now(),
            });
            if (!baseline) throw new Error('文件里没有可导入的记忆');
            ctx.chatMetadata[META_KEY] = {
                ...emptyState(),
                baseline,
            };
            detachImportedTerminalMemory();
            rebuildFromChat();
            void ctx.saveChat();
            const data = state();
            if (data.baselineStatus === 'stale') {
                toastr.warning('旧档已导入，但原聊天楼层与导出时不同；请重新导出旧档后再生成一次');
            } else {
                toastr.success(`旧档已固定导入，并接管末轮重说（短期 ${data.short.length} / 长期 ${data.long.length} / 细节 ${data.facts.length}）`);
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

function recentCaptureRepairIndices(latestIndex, limit = 8) {
    const ctx = context();
    const recentAssistantIndices = [];
    for (let index = latestIndex; index >= 0 && recentAssistantIndices.length < limit; index--) {
        const message = ctx.chat[index];
        if (message && !message.is_user && !message.is_system) {
            recentAssistantIndices.unshift(index);
        }
    }
    let lastMissingPosition = -1;
    for (let position = 0; position < recentAssistantIndices.length; position++) {
        const message = ctx.chat[recentAssistantIndices[position]];
        if (!readStoredCapture(message)) lastMissingPosition = position;
    }
    if (lastMissingPosition < 0) return [latestIndex];

    let start = lastMissingPosition;
    while (start > 0 && !readStoredCapture(ctx.chat[recentAssistantIndices[start - 1]])) {
        start--;
    }
    const hasCapturedAnchor = recentAssistantIndices
        .slice(0, start)
        .some(index => readStoredCapture(ctx.chat[index]));
    if (!hasCapturedAnchor) return [latestIndex];
    return recentAssistantIndices.slice(start);
}

async function retryLastCapture() {
    const messageIndex = latestAssistantMessageIndex();
    if (messageIndex < 0) {
        toastr.warning('当前聊天还没有可整理的 AI 回复');
        return;
    }
    const detached = detachImportedTerminalMemory();
    if (detached.detached) rebuildFromChat();
    if (isDedicatedMode()) {
        const repairIndices = recentCaptureRepairIndices(messageIndex);
        const repairingGap = repairIndices.length > 1 || repairIndices[0] !== messageIndex;
        if (repairingGap) {
            runtimeStatus.captureState = 'working';
            runtimeStatus.captureText = `捕获：发现最近缺失 ${repairIndices.length} 轮，正在按剧情顺序补写`;
            render();
            showActionFeedback(`发现缺失，正在按顺序补写 ${repairIndices.length} 轮…`, 'working', 0);
        }
        let completed = 0;
        for (const index of repairIndices) {
            const captured = await queueProfileCapture(index, {
                force: true,
                reason: repairingGap ? 'repair' : 'retry',
                generationType: 'retry',
            });
            if (!captured) break;
            completed++;
        }
        if (completed === repairIndices.length) {
            const message = repairingGap
                ? `已按顺序修复 ${completed} 轮缺失记忆，归档边界已重算`
                : '已重新整理并替换最后一轮原总结；不会新增重复条目';
            toastr.success(message);
            showActionFeedback(message, 'success', 2600);
        } else if (repairingGap) {
            showActionFeedback(`补写在第 ${completed + 1} 轮停止，请查看捕获错误`, 'error', 3200);
        }
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
        <button id="ksm-launcher" type="button" title="卷轴记忆（可拖动）" aria-label="卷轴记忆（可拖动）">
            <i class="fa-solid fa-scroll" aria-hidden="true"></i>
        </button>
        <div id="ksm-panel" role="dialog" aria-label="卷轴记忆">
            <header class="ksm-title">
                <div class="ksm-brand">
                    <span class="ksm-brand-mark" aria-hidden="true">K</span>
                    <span class="ksm-brand-copy">
                        <strong>Krystal · 卷轴记忆</strong>
                        <small>Memory archive · v${VERSION}</small>
                    </span>
                </div>
                <div class="ksm-title-actions">
                    <button data-action="settings" title="记忆 API 设置" aria-label="记忆 API 设置">
                        <i class="fa-solid fa-sliders" aria-hidden="true"></i>
                    </button>
                    <button data-action="close" title="关闭" aria-label="关闭">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                </div>
            </header>
            <nav class="ksm-tabs" role="tablist" aria-label="记忆类型">
                <button data-tab="short" role="tab"><span class="ksm-tab-label">短期</span><span class="ksm-tab-count" id="ksm-short-count">0/20</span></button>
                <button data-tab="long" role="tab"><span class="ksm-tab-label">长期</span><span class="ksm-tab-count" id="ksm-long-count">0/30</span></button>
                <button data-tab="facts" role="tab"><span class="ksm-tab-label">细节</span><span class="ksm-tab-count" id="ksm-fact-count">0/${MAX_FACTS}</span></button>
            </nav>
            <section class="ksm-status" aria-live="polite">
                <div data-status="injection" data-state="idle"><span class="ksm-status-dot"></span><span>注入：等待选择聊天</span></div>
                <div data-status="capture" data-state="idle"><span class="ksm-status-dot"></span><span>捕获：还没测试</span></div>
            </section>
            <section id="ksm-current-view" class="ksm-current-view" aria-live="polite">
                <span class="ksm-current-view-mark" aria-hidden="true"><i id="ksm-current-view-icon" class="fa-solid fa-feather-pointed"></i></span>
                <span class="ksm-current-view-copy">
                    <strong id="ksm-current-view-title">短期记忆</strong>
                    <small id="ksm-current-view-hint">近期剧情摘要</small>
                </span>
            </section>
            <section id="ksm-list"></section>
            <section id="ksm-settings" aria-label="记忆 API 设置">
                <div class="ksm-section-heading">
                    <span class="ksm-section-icon"><i class="fa-solid fa-sliders"></i></span>
                    <span><h3>卷轴记忆设置</h3><small>外观、连接、模型与总结指令</small></span>
                </div>
                <div class="ksm-update-card">
                    <span class="ksm-update-copy">
                        <strong>插件更新</strong>
                        <small id="ksm-update-status">当前 v${VERSION} · 尚未检查更新</small>
                    </span>
                    <span class="ksm-update-actions">
                        <button data-action="check-update"><i class="fa-solid fa-arrows-rotate"></i><span>检查更新</span></button>
                        <button data-action="request-update" class="ksm-update-primary" hidden><i class="fa-solid fa-download"></i><span>立即更新</span></button>
                    </span>
                </div>
                <label class="ksm-setting-row">
                    <span>面板外观</span>
                    <select id="ksm-appearance">
                        <option value="follow">跟随酒馆</option>
                        <option value="light">日间模式</option>
                        <option value="dark">夜间模式</option>
                    </select>
                </label>
                <p class="ksm-setting-help">
                    “跟随酒馆”会读取当前美化配色；也可以只让卷轴面板固定为日间或夜间。
                </p>
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
                <p class="ksm-setting-help ksm-setting-help-wide">
                    细节事实层会另外维护人物关系、秘密与知情边界、物品地点、承诺日期、身体习惯及未解线索；同一稳定键发生变化时覆盖旧值，不重复堆叠。
                </p>
                <label class="ksm-setting-row">
                    <span>敏感内容抽象</span>
                    <select id="ksm-sensitive-abstraction">
                        <option value="on">开启（推荐）</option>
                        <option value="off">关闭</option>
                    </select>
                </label>
                <p class="ksm-setting-help">
                    发送给记忆 API 前，会统一抽象本轮正文、最近记忆和细节事实，保留同意、边界、关系变化与关键结果。不会导入 Claude 的正文写作词。
                </p>
                <div class="ksm-diagnostic-card">
                    <span>
                        <strong>空回诊断</strong>
                        <small id="ksm-diagnostic-status">暂无空回诊断</small>
                    </span>
                    <button data-action="copy-empty-diagnostic" disabled><i class="fa-solid fa-copy"></i><span>复制诊断</span></button>
                </div>
                <label class="ksm-setting-row">
                    <span>最大输出</span>
                    <input id="ksm-max-tokens" type="number" min="${MIN_MAX_TOKENS}" max="${MAX_MAX_TOKENS}" step="100" inputmode="numeric">
                </label>
                <div class="ksm-settings-actions">
                    <button data-action="restore-default-instruction"><i class="fa-solid fa-rotate-left"></i><span>恢复默认</span></button>
                    <button data-action="save-settings"><i class="fa-solid fa-floppy-disk"></i><span>保存设置</span></button>
                    <button data-action="test-profile"><i class="fa-solid fa-plug"></i><span>测试连接</span></button>
                </div>
            </section>
            <section id="ksm-injection-preview" aria-label="实际注入内容">
                <div class="ksm-section-heading">
                    <span class="ksm-section-icon"><i class="fa-solid fa-eye"></i></span>
                    <span><h3>本轮实际注入</h3><small>检查酒馆实际登记的记忆内容</small></span>
                </div>
                <p id="ksm-injection-meta" class="ksm-preview-meta"></p>
                <textarea id="ksm-injection-text" readonly spellcheck="false"></textarea>
                <p class="ksm-setting-help ksm-setting-help-wide">
                    “酒馆登记成功”证明这段内容已交给提示词系统；生成后仍可在 Prompt Itemization 中搜索“历史记忆-开始”，确认最终请求没有被上下文裁剪。模型是否真正采用，只能再用剧情细节进行行为验证。
                </p>
                <div class="ksm-settings-actions">
                    <button data-action="copy-injection"><i class="fa-solid fa-copy"></i><span>复制内容</span></button>
                    <button data-action="close-injection"><i class="fa-solid fa-arrow-left"></i><span>返回</span></button>
                </div>
            </section>
            <div id="ksm-action-feedback" class="ksm-action-feedback" role="status" aria-live="polite" hidden>
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                <span class="ksm-action-feedback-copy">操作完成</span>
            </div>
            <div id="ksm-delete-confirm" class="ksm-delete-confirm" role="alertdialog" aria-label="确认删除" hidden>
                <span class="ksm-delete-confirm-copy">确定删除这条记忆吗？</span>
                <span class="ksm-delete-confirm-actions">
                    <button data-action="cancel-delete">取消</button>
                    <button data-action="confirm-delete" class="ksm-confirm-danger">确认删除</button>
                </span>
            </div>
            <div id="ksm-empty-retry-confirm" class="ksm-decision-dialog" role="alertdialog" aria-modal="true" aria-label="空回重试确认" hidden>
                <div class="ksm-decision-card">
                    <span class="ksm-decision-icon ksm-decision-warning"><i class="fa-solid fa-coins"></i></span>
                    <h4>记忆 API 返回了空内容</h4>
                    <p class="ksm-decision-reason">第一笔请求可能已经计费。</p>
                    <p class="ksm-decision-emphasis">再次请求可能再次扣费，插件不会替你自动重试。</p>
                    <div class="ksm-decision-actions">
                        <button data-action="copy-empty-diagnostic"><i class="fa-solid fa-copy"></i><span>复制诊断</span></button>
                        <button data-action="cancel-empty-retry"><span>停止，不再请求</span></button>
                        <button data-action="confirm-empty-retry" class="ksm-decision-primary"><i class="fa-solid fa-shield-halved"></i><span>加强抽象重试</span></button>
                    </div>
                </div>
            </div>
            <div id="ksm-update-confirm" class="ksm-decision-dialog" role="alertdialog" aria-modal="true" aria-label="插件更新确认" hidden>
                <div class="ksm-decision-card">
                    <span class="ksm-decision-icon"><i class="fa-solid fa-cloud-arrow-down"></i></span>
                    <h4>更新卷轴记忆</h4>
                    <p class="ksm-decision-reason">更新后页面会自动刷新。</p>
                    <div class="ksm-decision-actions">
                        <button data-action="cancel-update"><span>稍后</span></button>
                        <button data-action="confirm-update" class="ksm-decision-primary"><i class="fa-solid fa-download"></i><span>更新并刷新</span></button>
                    </div>
                </div>
            </div>
            <footer class="ksm-footer">
                <div class="ksm-footer-primary">
                    <button data-action="retry-last">
                        <i class="fa-solid fa-rotate-right"></i><span>重试本轮</span>
                    </button>
                    <button data-action="bootstrap-facts">
                        <i class="fa-solid fa-wand-magic-sparkles"></i><span class="ksm-button-label">整理细节</span>
                    </button>
                </div>
                <div class="ksm-footer-secondary">
                    <button data-action="view-injection"><i class="fa-solid fa-eye"></i><span>查看注入</span></button>
                    <button data-action="rebuild"><i class="fa-solid fa-arrows-rotate"></i><span>重建</span></button>
                    <button data-action="export"><i class="fa-solid fa-upload"></i><span>导出</span></button>
                    <button data-action="import"><i class="fa-solid fa-download"></i><span>导入</span></button>
                </div>
                <input id="ksm-import" type="file" accept=".json,application/json">
            </footer>
        </div>`);

    applyViewportGuards();
    window.addEventListener('resize', applyViewportGuards);
    window.addEventListener('orientationchange', applyViewportGuards);
    window.visualViewport?.addEventListener('resize', applyViewportGuards);
    makeLauncherDraggable(document.getElementById('ksm-launcher'));
    const panel = document.getElementById('ksm-panel');
    panel.addEventListener('pointerdown', event => {
        const button = event.target.closest('button');
        if (!button || button.disabled) return;
        replayClass(button, 'ksm-press-feedback', 320);
    });
    panel.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        if (button.dataset.tab) {
            const nextTab = button.dataset.tab;
            const changed = nextTab !== activeTab;
            activeTab = nextTab;
            injectionPreviewOpen = false;
            hideDeleteConfirmation();
            render();
            if (changed) {
                animateCurrentView();
                showActionFeedback(`已切换到${TAB_PRESENTATION[activeTab].title}`, 'success', 1200);
            }
            return;
        }
        const action = button.dataset.action;
        if (action === 'copy-empty-diagnostic') {
            void copyLastEmptyDiagnostic();
            return;
        }
        if (action === 'cancel-empty-retry') {
            settleEmptyRetry(false);
            return;
        }
        if (action === 'confirm-empty-retry') {
            settleEmptyRetry(true);
            return;
        }
        if (action === 'check-update') {
            void checkForPluginUpdate({ notify: true });
            return;
        }
        if (action === 'request-update') {
            if (updateRuntime.available) {
                updateConfirmationOpen = true;
                render();
            }
            return;
        }
        if (action === 'cancel-update') {
            updateConfirmationOpen = false;
            render();
            showActionFeedback('已暂缓更新');
            return;
        }
        if (action === 'confirm-update') {
            void performPluginUpdate();
            return;
        }
        if (action === 'close') panelOpen = false;
        if (action === 'settings') {
            settingsOpen = !settingsOpen;
            injectionPreviewOpen = false;
        }
        if (action === 'view-injection') {
            settingsOpen = false;
            injectionPreviewOpen = true;
        }
        if (action === 'close-injection') injectionPreviewOpen = false;
        if (action === 'copy-injection') {
            void copyInjectionPreview();
            showActionFeedback('注入内容已复制');
        }
        if (action === 'export') {
            downloadJson();
            showActionFeedback('记忆文件已导出');
        }
        if (action === 'import') {
            document.getElementById('ksm-import')?.click();
            showActionFeedback('请选择要导入的记忆文件', 'working', 1600);
        }
        if (action === 'cancel-delete') {
            hideDeleteConfirmation();
            showActionFeedback('已取消删除', 'success', 1100);
            return;
        }
        if (action === 'confirm-delete') {
            confirmPendingDelete();
            return;
        }
        if (action === 'toggle-fact-group') {
            const category = button.closest('.ksm-fact-group')?.dataset.category;
            if (category) {
                if (openFactCategories.has(category)) {
                    openFactCategories.delete(category);
                } else {
                    openFactCategories.add(category);
                }
            }
            render();
            return;
        }
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
        if (action === 'bootstrap-facts') void bootstrapFactsFromMemory();
        if (action === 'rebuild' && confirm('将根据当前聊天中保存的记忆标签重建侧栏，继续吗？')) {
            showActionFeedback('正在重建当前记忆…', 'working', 0);
            rebuildFromChat();
            showActionFeedback('当前记忆已重建');
        }
        if (action === 'save-item' || action === 'delete-item') {
            const article = button.closest('.ksm-item');
            const data = state();
            const list = activeTab === 'short'
                ? data.short
                : (activeTab === 'long' ? data.long : data.facts);
            const index = list.findIndex(item => item.id === article.dataset.id);
            if (index >= 0) {
                const item = list[index];
                const label = article.querySelector('.ksm-item-label')?.textContent || '这条记忆';
                if (action === 'delete-item') {
                    requestDeleteConfirmation(item, activeTab, label);
                    return;
                }
                const persisted = activeTab === 'facts'
                    ? persistFactChange(item, 'save', article.querySelector('textarea').value)
                    : persistMemoryItemChange(item, activeTab, 'save', article.querySelector('textarea').value);
                if (!persisted) {
                    toastr.warning('这条记忆来自未迁移的旧标签，暂时无法持久修改');
                    showActionFeedback('保存失败：这条旧记忆暂时无法修改', 'error', 2600);
                } else {
                    showActionFeedback(`已保存：${label}`);
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
        if (event.target.id === 'ksm-appearance') {
            settings.appearance = ['follow', 'light', 'dark'].includes(event.target.value)
                ? event.target.value
                : 'follow';
            savePluginSettings();
        }
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
        if (event.target.id === 'ksm-sensitive-abstraction') {
            settings.sensitiveAbstraction = event.target.value !== 'off';
            context().saveSettingsDebounced();
            runtimeStatus.captureState = 'idle';
            runtimeStatus.captureText = settings.sensitiveAbstraction
                ? '捕获：敏感内容抽象已开启'
                : '捕获：敏感内容抽象已关闭';
            showActionFeedback(settings.sensitiveAbstraction
                ? '敏感内容抽象已开启'
                : '敏感内容抽象已关闭');
            render();
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
        generationInProgress = false;
        clearScheduledProfileCaptures();
        refreshCurrentChatState();
        updateInjection();
        render();
        window.setTimeout(hideAllMemoryBlocks, 50);
    });
    if (events.GENERATION_AFTER_COMMANDS) {
        ctx.eventSource.on(events.GENERATION_AFTER_COMMANDS, (generationType, _options, dryRun) => {
            if (dryRun || generationType === 'quiet' || generationType === 'impersonate') return;
            generationInProgress = true;
            if (generationType === 'swipe' || generationType === 'regenerate') {
                const detached = detachImportedTerminalMemory();
                if (detached.detached) rebuildFromChat();
            }
            rawStreamText = '';
            trackRawStream = !isDedicatedMode();
            runtimeStatus.captureState = 'working';
            runtimeStatus.captureText = isDedicatedMode()
                ? '捕获：等待正文完成后调用独立 API'
                : '捕获：等待本轮 AI 回复';
            updateInjection({ markPrepared: true });
        });
    }
    if (events.STREAM_TOKEN_RECEIVED) {
        ctx.eventSource.on(events.STREAM_TOKEN_RECEIVED, text => {
            if (trackRawStream) rawStreamText = String(text || '');
        });
    }
    ctx.eventSource.on(events.MESSAGE_RECEIVED, (messageIndex, generationType) => {
        generationInProgress = false;
        const index = resolveAssistantMessageIndex(messageIndex);
        if (generationType !== 'first_message' && isDedicatedMode()) {
            trackRawStream = false;
            rawStreamText = '';
            hideMemoryInMessage(index);
            scheduleProfileCapture(index, generationType);
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
    if (events.CHARACTER_MESSAGE_RENDERED) {
        ctx.eventSource.on(events.CHARACTER_MESSAGE_RENDERED, (messageIndex, generationType) => {
            if (generationType === 'first_message' || !isDedicatedMode()) return;
            generationInProgress = false;
            // Some mobile wrappers finish persisting the selected swipe only
            // after MESSAGE_RECEIVED. This second official event is a harmless
            // fallback; the scheduler and pending-key map deduplicate it.
            scheduleProfileCapture(messageIndex, generationType);
        });
    }
    [events.GENERATION_ENDED, events.GENERATION_STOPPED]
        .filter(Boolean)
        .forEach(event => ctx.eventSource.on(event, () => {
            generationInProgress = false;
        }));
    if (events.MESSAGE_SWIPED) {
        ctx.eventSource.on(events.MESSAGE_SWIPED, (messageIndex, meta = {}) => {
            const detached = detachImportedTerminalMemory();
            const index = resolveAssistantMessageIndex(messageIndex);
            const message = context().chat[index];
            if (message && !message.is_user) syncCaptureFromCurrentSwipe(message);
            rebuildFromChat();
            window.setTimeout(hideAllMemoryBlocks, 50);
            if (!meta?.pendingGeneration
                && isDedicatedMode()
                && message
                && !message.is_user
                && !readStoredCapture(message)) {
                scheduleProfileCapture(index, 'swipe-select', 360);
            } else if (detached.needsCapture && !meta?.pendingGeneration && isDedicatedMode()) {
                scheduleProfileCapture(detached.messageIndex, 'swipe-select', 360);
            }
        });
    }
    [events.MESSAGE_DELETED, events.MESSAGE_UPDATED]
        .filter(Boolean)
        .forEach(event => ctx.eventSource.on(event, () => {
            rebuildFromChat();
            window.setTimeout(hideAllMemoryBlocks, 50);
        }));
    if (events.MESSAGE_EDITED) {
        ctx.eventSource.on(events.MESSAGE_EDITED, messageIndex => {
            const detached = detachImportedTerminalMemory();
            if (detached.detached) rebuildFromChat();
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
    refreshCurrentChatState();
    updateInjection();
    render();
    window.setTimeout(refreshCurrentChatState, 600);
    window.setTimeout(hideAllMemoryBlocks, 100);
    window.setTimeout(() => void checkForPluginUpdate(), 1200);
    console.info(`[Krystal Scroll Memory] v${VERSION} loaded`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
