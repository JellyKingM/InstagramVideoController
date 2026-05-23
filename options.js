const STORAGE_KEYS = {
    backwardInterval: 'backwardIntervalV',
    forwardInterval: 'forwardIntervalV',
    nativeControlsEnabled: 'nativeControlsEnabledV',
    sideBoxEnabled: 'sideBoxEnabledV',
    sideBoxVisible: 'sideBoxVisibleV',
    hideReelClickCover: 'hideReelClickCoverV',
    sideBoxColor: 'sideBoxColorV',
    debugRemoteVisible: 'debugRemoteVisibleV',
    debugLogVisible: 'debugLogVisibleV',
    debugLogFontSize: 'debugLogFontSizeV',
    debugLogFontFamily: 'debugLogFontFamilyV',
    debugLogTheme: 'debugLogThemeV'
};

const DEFAULTS = {
    [STORAGE_KEYS.backwardInterval]: 10,
    [STORAGE_KEYS.forwardInterval]: 10,
    [STORAGE_KEYS.nativeControlsEnabled]: true,
    [STORAGE_KEYS.sideBoxEnabled]: true,
    [STORAGE_KEYS.sideBoxVisible]: true,
    [STORAGE_KEYS.hideReelClickCover]: true,
    [STORAGE_KEYS.sideBoxColor]: '#121212',
    [STORAGE_KEYS.debugRemoteVisible]: false,
    [STORAGE_KEYS.debugLogVisible]: false,
    [STORAGE_KEYS.debugLogFontSize]: 10,
    [STORAGE_KEYS.debugLogFontFamily]: 'Consolas, monospace',
    [STORAGE_KEYS.debugLogTheme]: 'dark'
};

const backwardInput = document.getElementById('backwardInterval');
const forwardInput = document.getElementById('forwardInterval');
const nativeControlsCheckbox = document.getElementById('nativeControlsEnabled');
const sideBoxEnabledCheckbox = document.getElementById('sideBoxEnabled');
const hideReelClickCoverCheckbox = document.getElementById('hideReelClickCover');
const sideBoxColorInput = document.getElementById('sideBoxColor');
const debugLogVisibleCheckbox = document.getElementById('debugLogVisible');
const debugLogFontSizeInput = document.getElementById('debugLogFontSize');
const debugLogFontFamilySelect = document.getElementById('debugLogFontFamily');
const debugLogThemeSelect = document.getElementById('debugLogTheme');
const statusEl = document.getElementById('status');

function t(key, fallback) {
    const message = chrome.i18n.getMessage(key);
    return message || fallback;
}

function clampNumber(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function setStatus(message) {
    statusEl.textContent = message;
    window.clearTimeout(setStatus.timer);
    setStatus.timer = window.setTimeout(() => {
        statusEl.textContent = '';
    }, 1400);
}

function save(values) {
    chrome.storage.local.set(values, () => {
        setStatus(t('saved', 'Saved'));
    });
}

function bindLabels() {
    document.getElementById('pageTitle').textContent = t('panelTitle', 'Instagram Video Controller');
    document.getElementById('developer').textContent = t('developerLink', 'Developer Page');
    document.getElementById('donate').textContent = t('donate', 'Donate to Developer');
}

function bindLinks() {
    document.getElementById('developer').addEventListener('click', () => {
        chrome.tabs.create({ url: IVC_SHARED.LINKS.developer });
    });

    document.getElementById('donate').addEventListener('click', () => {
        chrome.tabs.create({ url: IVC_SHARED.LINKS.donate });
    });
}

function setChildrenDisabled(parentId, disabled) {
    document.querySelectorAll(`[data-parent="${parentId}"]`).forEach(row => {
        row.classList.toggle('disabled', disabled);
        row.querySelectorAll('input, select, button').forEach(control => {
            control.disabled = disabled;
        });
    });
}

function updateDependencyState() {
    setChildrenDisabled('sideBoxEnabled', !sideBoxEnabledCheckbox.checked);
    setChildrenDisabled('debugLogVisible', !debugLogVisibleCheckbox.checked);
}

function loadValues(result) {
    backwardInput.value = String(clampNumber(result[STORAGE_KEYS.backwardInterval], 1, 60, 10));
    forwardInput.value = String(clampNumber(result[STORAGE_KEYS.forwardInterval], 1, 60, 10));
    nativeControlsCheckbox.checked = result[STORAGE_KEYS.nativeControlsEnabled] !== false;
    sideBoxEnabledCheckbox.checked = result[STORAGE_KEYS.sideBoxEnabled] !== false;
    hideReelClickCoverCheckbox.checked = result[STORAGE_KEYS.hideReelClickCover] !== false;
    sideBoxColorInput.value = result[STORAGE_KEYS.sideBoxColor] || DEFAULTS[STORAGE_KEYS.sideBoxColor];
    debugLogVisibleCheckbox.checked = result[STORAGE_KEYS.debugLogVisible] === true;
    debugLogFontSizeInput.value = String(clampNumber(result[STORAGE_KEYS.debugLogFontSize], 8, 18, 10));
    debugLogFontFamilySelect.value = result[STORAGE_KEYS.debugLogFontFamily] || DEFAULTS[STORAGE_KEYS.debugLogFontFamily];
    debugLogThemeSelect.value = result[STORAGE_KEYS.debugLogTheme] || DEFAULTS[STORAGE_KEYS.debugLogTheme];
    updateDependencyState();
}

function bindControls() {
    backwardInput.addEventListener('change', () => {
        const value = clampNumber(backwardInput.value, 1, 60, 10);
        backwardInput.value = String(value);
        save({ [STORAGE_KEYS.backwardInterval]: value });
    });

    forwardInput.addEventListener('change', () => {
        const value = clampNumber(forwardInput.value, 1, 60, 10);
        forwardInput.value = String(value);
        save({ [STORAGE_KEYS.forwardInterval]: value });
    });

    nativeControlsCheckbox.addEventListener('change', () => {
        save({ [STORAGE_KEYS.nativeControlsEnabled]: nativeControlsCheckbox.checked });
    });

    sideBoxEnabledCheckbox.addEventListener('change', () => {
        updateDependencyState();
        save({
            [STORAGE_KEYS.sideBoxEnabled]: sideBoxEnabledCheckbox.checked,
            [STORAGE_KEYS.sideBoxVisible]: sideBoxEnabledCheckbox.checked
        });
    });

    hideReelClickCoverCheckbox.addEventListener('change', () => {
        save({ [STORAGE_KEYS.hideReelClickCover]: hideReelClickCoverCheckbox.checked });
    });

    sideBoxColorInput.addEventListener('input', () => {
        save({ [STORAGE_KEYS.sideBoxColor]: sideBoxColorInput.value });
    });

    debugLogVisibleCheckbox.addEventListener('change', () => {
        updateDependencyState();
        save({ [STORAGE_KEYS.debugLogVisible]: debugLogVisibleCheckbox.checked });
    });

    debugLogFontSizeInput.addEventListener('change', () => {
        const value = clampNumber(debugLogFontSizeInput.value, 8, 18, 10);
        debugLogFontSizeInput.value = String(value);
        save({ [STORAGE_KEYS.debugLogFontSize]: value });
    });

    debugLogFontFamilySelect.addEventListener('change', () => {
        save({ [STORAGE_KEYS.debugLogFontFamily]: debugLogFontFamilySelect.value });
    });

    debugLogThemeSelect.addEventListener('change', () => {
        save({ [STORAGE_KEYS.debugLogTheme]: debugLogThemeSelect.value });
    });
}

bindLabels();
bindLinks();
bindControls();

chrome.storage.local.get(DEFAULTS, result => {
    if (result[STORAGE_KEYS.debugRemoteVisible] === true) {
        result[STORAGE_KEYS.debugRemoteVisible] = false;
        save({ [STORAGE_KEYS.debugRemoteVisible]: false });
    }
    loadValues(result);
});
