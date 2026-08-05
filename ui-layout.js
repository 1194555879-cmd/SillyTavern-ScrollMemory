/**
 * Krystal Scroll Memory v0.3.18 UI layout adapter.
 * Keeps the wand menu as one entry and moves secondary actions into the panel.
 */

const COMPAT_VERSION = '0.3.18';
const PREVIOUS_VERSION = '0.3.17';
const PANEL_ACTIONS_ID = 'ksm-panel-quick-actions';
let observer = null;
let refreshScheduled = false;

function setTextIfChanged(element, text) {
    if (!element || element.textContent === text) return false;
    element.textContent = text;
    return true;
}

function secondaryWandItems() {
    return {
        ignore: document.getElementById('ksm-wand-ignore-last'),
        launcher: document.getElementById('ksm-wand-launcher-toggle'),
    };
}

function tidyWandMenu() {
    const { ignore, launcher } = secondaryWandItems();
    if (ignore && !ignore.hidden) ignore.hidden = true;
    if (launcher && !launcher.hidden) launcher.hidden = true;
}

function launcherVisible() {
    const source = document.getElementById('ksm-wand-launcher-toggle');
    if (source) return source.getAttribute('aria-pressed') !== 'false';
    const launcher = document.getElementById('ksm-launcher');
    return launcher?.style?.display !== 'none';
}

function syncPanelActions(card = document.getElementById(PANEL_ACTIONS_ID)) {
    if (!card) return;
    const visible = launcherVisible();
    const launcherButton = card.querySelector('[data-ksm-panel-action="toggle-launcher"]');
    if (launcherButton) {
        launcherButton.setAttribute('aria-pressed', String(visible));
        const icon = launcherButton.querySelector('i');
        const iconClass = `fa-solid ${visible ? 'fa-eye' : 'fa-eye-slash'}`;
        if (icon && icon.className !== iconClass) icon.className = iconClass;
        setTextIfChanged(launcherButton.querySelector('span'), `悬浮球：${visible ? '开' : '关'}`);
    }
}

function triggerWandAction(id) {
    const source = document.getElementById(id);
    if (!source) {
        globalThis.toastr?.warning?.('卷轴记忆操作尚未加载完成，请稍后再试');
        return;
    }
    source.click();
    globalThis.queueMicrotask?.(() => syncPanelActions());
    globalThis.setTimeout?.(() => syncPanelActions(), 50);
}

function mountPanelActions() {
    const settings = document.getElementById('ksm-settings');
    if (!settings) return false;
    let card = document.getElementById(PANEL_ACTIONS_ID);
    if (!card) {
        card = document.createElement('div');
        card.id = PANEL_ACTIONS_ID;
        card.className = 'ksm-update-card';
        card.innerHTML = `
            <span class="ksm-update-copy">
                <strong>快捷操作</strong>
                <small>管理最近一轮记忆与卷轴悬浮球</small>
            </span>
            <span class="ksm-update-actions">
                <button type="button" data-ksm-panel-action="ignore-last">
                    <i class="fa-solid fa-comment-slash"></i><span>忽略最近一轮</span>
                </button>
                <button type="button" data-ksm-panel-action="toggle-launcher" aria-pressed="true">
                    <i class="fa-solid fa-eye"></i><span>悬浮球：开</span>
                </button>
            </span>`;
        card.querySelector('[data-ksm-panel-action="ignore-last"]')?.addEventListener('click', () => {
            triggerWandAction('ksm-wand-ignore-last');
        });
        card.querySelector('[data-ksm-panel-action="toggle-launcher"]')?.addEventListener('click', () => {
            triggerWandAction('ksm-wand-launcher-toggle');
        });
        const updateCard = settings.querySelector('.ksm-update-card');
        if (updateCard) updateCard.insertAdjacentElement('afterend', card);
        else settings.querySelector('.ksm-section-heading')?.insertAdjacentElement('afterend', card);
    }
    syncPanelActions(card);
    return true;
}

function patchVersionText() {
    document.querySelectorAll('#ksm-panel *').forEach(element => {
        if (element.children.length || !element.textContent?.includes(`v${PREVIOUS_VERSION}`)) return;
        setTextIfChanged(element, element.textContent.replaceAll(`v${PREVIOUS_VERSION}`, `v${COMPAT_VERSION}`));
    });
}

function observe() {
    if (observer && document.body) observer.observe(document.body, { childList: true, subtree: true });
}

function ensureLayout() {
    if (!document.body) return;
    observer?.disconnect();
    try {
        tidyWandMenu();
        mountPanelActions();
        patchVersionText();
    } finally {
        observe();
    }
}

function scheduleRefresh() {
    if (refreshScheduled) return;
    refreshScheduled = true;
    const schedule = globalThis.requestAnimationFrame || (callback => globalThis.setTimeout(callback, 16));
    schedule(() => {
        refreshScheduled = false;
        ensureLayout();
    });
}

async function load() {
    await import('./entry.js');
    if (globalThis.__KSM_V0318_UI_LAYOUT__) return;
    globalThis.__KSM_V0318_UI_LAYOUT__ = true;
    observer = new MutationObserver(scheduleRefresh);
    observe();
    ensureLayout();
    [100, 400, 1000, 2500].forEach(delay => globalThis.setTimeout(ensureLayout, delay));
    document.addEventListener('click', event => {
        if (event.target?.closest?.('#extensionsMenuButton, #ksm-settings-button')) scheduleRefresh();
    }, true);
}

if (globalThis.__KSM_V0318_TEST_MODE__) {
    globalThis.__KSM_V0318_TEST__ = {
        launcherVisible,
        mountPanelActions,
        patchVersionText,
        setTextIfChanged,
        syncPanelActions,
        tidyWandMenu,
    };
} else {
    void load();
}
