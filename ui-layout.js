/**
 * Krystal Scroll Memory v0.3.19 UI layout adapter.
 * Keeps the wand menu as one entry and moves secondary actions into the panel.
 */

const COMPAT_VERSION = '0.3.19';
const PREVIOUS_VERSIONS = ['0.3.17', '0.3.18'];
const PANEL_ACTIONS_ID = 'ksm-panel-quick-actions';
const WAND_ITEM_IDS = {
    ignore: 'ksm-wand-ignore-last',
    launcher: 'ksm-wand-launcher-toggle',
};
const detachedWandItems = {
    ignore: null,
    launcher: null,
};
let observer = null;
let refreshScheduled = false;

function setTextIfChanged(element, text) {
    if (!element || element.textContent === text) return false;
    element.textContent = text;
    return true;
}

function rememberWandItem(kind, element) {
    if (element) detachedWandItems[kind] = element;
    return detachedWandItems[kind];
}

function wandItem(kind) {
    const id = WAND_ITEM_IDS[kind];
    const live = id ? document.getElementById(id) : null;
    return rememberWandItem(kind, live);
}

function detachSecondaryWandItems() {
    let changed = false;
    for (const kind of Object.keys(WAND_ITEM_IDS)) {
        const item = document.getElementById(WAND_ITEM_IDS[kind]);
        if (!item) continue;
        rememberWandItem(kind, item);
        if (typeof item.remove === 'function') {
            item.remove();
        } else if (item.parentNode?.removeChild) {
            item.parentNode.removeChild(item);
        } else {
            item.hidden = true;
            item.style?.setProperty?.('display', 'none', 'important');
        }
        changed = true;
    }
    return changed;
}

function tidyWandMenu() {
    return detachSecondaryWandItems();
}

function launcherVisible() {
    const launcher = document.getElementById('ksm-launcher');
    if (launcher) return launcher.style?.display !== 'none';
    const source = wandItem('launcher');
    return source ? source.getAttribute('aria-pressed') !== 'false' : true;
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

function triggerWandAction(kind) {
    const source = wandItem(kind);
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
            triggerWandAction('ignore');
        });
        card.querySelector('[data-ksm-panel-action="toggle-launcher"]')?.addEventListener('click', () => {
            triggerWandAction('launcher');
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
        if (element.children.length) return;
        let next = element.textContent || '';
        for (const version of PREVIOUS_VERSIONS) {
            next = next.replaceAll(`v${version}`, `v${COMPAT_VERSION}`);
        }
        setTextIfChanged(element, next);
    });
}

function observe() {
    if (observer && document.body) observer.observe(document.body, { childList: true, subtree: true });
}

function ensureLayout() {
    if (!document.body) return;
    observer?.disconnect();
    try {
        detachSecondaryWandItems();
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
    if (globalThis.__KSM_V0319_UI_LAYOUT__) return;
    globalThis.__KSM_V0319_UI_LAYOUT__ = true;
    observer = new MutationObserver(scheduleRefresh);
    observe();
    ensureLayout();
    [100, 400, 1000, 2500].forEach(delay => globalThis.setTimeout(ensureLayout, delay));
    document.addEventListener('click', event => {
        if (event.target?.closest?.('#extensionsMenuButton, #ksm-settings-button')) scheduleRefresh();
    }, true);
}

if (globalThis.__KSM_V0319_TEST_MODE__) {
    globalThis.__KSM_V0319_TEST__ = {
        detachSecondaryWandItems,
        launcherVisible,
        mountPanelActions,
        patchVersionText,
        setTextIfChanged,
        syncPanelActions,
        tidyWandMenu,
        triggerWandAction,
        wandItem,
    };
} else {
    void load();
}
