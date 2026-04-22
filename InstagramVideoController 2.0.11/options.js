const DEBUG_REMOTE_KEY = 'debugRemoteVisibleV';

const checkbox = document.getElementById('debugRemoteVisible');
const statusEl = document.getElementById('status');

function t(key, fallback) {
    const message = chrome.i18n.getMessage(key);
    return message || fallback;
}

function setStatus(message) {
    statusEl.textContent = message;
    window.clearTimeout(setStatus.timer);
    setStatus.timer = window.setTimeout(() => {
        statusEl.textContent = '';
    }, 1400);
}

document.getElementById('pageTitle').textContent = t('panelTitle', 'Instagram Video Controller');
document.getElementById('debugRemoteLabel').textContent = t('debugRemoteLabel', 'Developer debug remote');
document.getElementById('debugRemoteHint').textContent = t('debugRemoteHint', 'When enabled, automatic execution stops and step buttons appear on the right side of the page.');

chrome.storage.local.get({ [DEBUG_REMOTE_KEY]: false }, result => {
    checkbox.checked = result[DEBUG_REMOTE_KEY] === true;
});

checkbox.addEventListener('change', () => {
    chrome.storage.local.set({ [DEBUG_REMOTE_KEY]: checkbox.checked }, () => {
        setStatus(t('saved', 'Saved'));
    });
});
