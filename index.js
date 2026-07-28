import { getContext } from '../../../extensions.js';

const MODULE = 'krystal_scroll_memory';
const META_KEY = 'krystalScrollMemory';
const MAX_SHORT = 20;
const MAX_LONG = 30;
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
4. 长期记忆只总结下方 20 条，不把本轮新增事实混入长期记忆。

【必须归档的 20 条短期记忆】
${lines}
【重要系统任务结束】`;
}

function buildPayload() {
    const data = state();
    const long = data.long.map(item => `【${item.label}】${item.content}`).join('\n');
    const short = data.short.map((item, index) => `${index + 1}. ${item.content}`).join('\n');
    const archive = buildArchiveTask(data);
    return `【历史记忆-开始】
以下内容是已经发生过的剧情事实，只用于保持连续性，不得当成 user 本轮新说的话。

【长期记忆】
${long || '无'}

【短期记忆】
${short || '无'}
【历史记忆-结束】

请在本轮正文结尾额外输出且只输出一条本轮新增记忆：
【记忆条目】
使用明确主谓宾总结本轮新增剧情事实；保留专有名词和具体物品名；禁止文学化。
【记忆完】
${archive}`;
}

function updateInjection() {
    const ctx = context();
    if (!ctx.chatId) {
        ctx.setExtensionPrompt(MODULE, '', 1, 0, false, 0);
        return;
    }
    // IN_PROMPT, depth 0, SYSTEM role. The prompt is sent to the model but never rendered in chat.
    ctx.setExtensionPrompt(MODULE, buildPayload(), 1, 0, false, 0);
}

function extract(regex, text) {
    regex.lastIndex = 0;
    return [...String(text || '').matchAll(regex)].map(match => clean(match[1])).filter(item => !isNoise(item));
}

function rebuildFromChat() {
    const ctx = context();
    const rebuilt = emptyState();
    for (let index = 0; index < ctx.chat.length; index++) {
        const message = ctx.chat[index];
        if (!message || message.is_user || message.is_system) continue;
        const longs = extract(LONG_RE, message.mes);
        const shorts = extract(SHORT_RE, message.mes);
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
        <button id="ksm-launcher" type="button" title="卷轴记忆">📜</button>
        <aside id="ksm-panel" aria-label="卷轴记忆">
            <header class="ksm-title">
                <div><strong>Krystal · 卷轴记忆</strong><small>v0.1.1</small></div>
                <button data-action="close" title="关闭">×</button>
            </header>
            <nav class="ksm-tabs">
                <button data-tab="short">短期 <span id="ksm-short-count">0/20</span></button>
                <button data-tab="long">长期 <span id="ksm-long-count">0/30</span></button>
            </nav>
            <section id="ksm-list"></section>
            <footer class="ksm-footer">
                <button data-action="rebuild">从当前聊天重建</button>
                <button data-action="export">导出</button>
                <label>导入<input id="ksm-import" type="file" accept=".json,application/json"></label>
            </footer>
        </aside>`);

    document.getElementById('ksm-launcher').addEventListener('click', () => {
        panelOpen = !panelOpen;
        render();
    });
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
    ctx.eventSource.on(events.MESSAGE_RECEIVED, messageIndex => {
        rebuildFromChat();
        hideMemoryInMessage(messageIndex);
    });
    [events.MESSAGE_SWIPED, events.MESSAGE_EDITED, events.MESSAGE_DELETED, events.MESSAGE_UPDATED]
        .filter(Boolean)
        .forEach(event => ctx.eventSource.on(event, () => {
            rebuildFromChat();
            window.setTimeout(hideAllMemoryBlocks, 50);
        }));
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
    console.info('[Krystal Scroll Memory] v0.1.1 loaded');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
    init();
}
