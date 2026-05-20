const STORAGE_KEYS = {
    backwardInterval: 'backwardIntervalV',
    forwardInterval: 'forwardIntervalV',
    debugRemoteVisible: 'debugRemoteVisibleV'
};

const DEFAULTS = {
    [STORAGE_KEYS.backwardInterval]: 10,
    [STORAGE_KEYS.forwardInterval]: 10,
    [STORAGE_KEYS.debugRemoteVisible]: false
};

const backwardInput = document.getElementById('backwardInterval');
const forwardInput = document.getElementById('forwardInterval');
const debugRemoteCheckbox = document.getElementById('debugRemoteVisible');
const statusEl = document.getElementById('status');

function t(key, fallback) {
    const message = chrome.i18n.getMessage(key);
    return message || fallback;
}

function clampInterval(value) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(Math.max(parsed, 1), 60);
}

function setStatus(message) {
    statusEl.textContent = message;
    window.clearTimeout(setStatus.timer);
    setStatus.timer = window.setTimeout(() => {
        statusEl.textContent = '';
    }, 1400);
}

function saveInterval(key, input) {
    const value = clampInterval(input.value);
    input.value = String(value);
    chrome.storage.local.set({ [key]: value }, () => {
        setStatus(t('saved', 'Saved'));
    });
}

function bindLabels() {
    document.getElementById('pageTitle').textContent = t('panelTitle', 'Instagram Video Controller');
    document.getElementById('backwardIntervalLabel').textContent = t('backwardIntervalLabel', 'Back seconds');
    document.getElementById('forwardIntervalLabel').textContent = t('forwardIntervalLabel', 'Forward seconds');
    document.getElementById('developerSectionTitle').textContent = t('developerSectionTitle', 'Developer');
    document.getElementById('debugRemoteLabel').textContent = t('debugRemoteLabel', 'Developer debug remote');
    document.getElementById('debugRemoteHint').textContent = t('debugRemoteHint', 'When enabled, automatic execution stops and step buttons appear on the right side of the page.');
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

bindLabels();
bindLinks();

chrome.storage.local.get(DEFAULTS, result => {
    backwardInput.value = String(clampInterval(result[STORAGE_KEYS.backwardInterval]));
    forwardInput.value = String(clampInterval(result[STORAGE_KEYS.forwardInterval]));
    debugRemoteCheckbox.checked = result[STORAGE_KEYS.debugRemoteVisible] === true;
});

backwardInput.addEventListener('change', () => {
    saveInterval(STORAGE_KEYS.backwardInterval, backwardInput);
});

forwardInput.addEventListener('change', () => {
    saveInterval(STORAGE_KEYS.forwardInterval, forwardInput);
});

debugRemoteCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ [STORAGE_KEYS.debugRemoteVisible]: debugRemoteCheckbox.checked }, () => {
        setStatus(t('saved', 'Saved'));
    });
});
