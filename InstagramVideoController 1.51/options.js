const DEBUG_REMOTE_KEY = 'debugRemoteVisibleV';

const checkbox = document.getElementById('debugRemoteVisible');
const statusEl = document.getElementById('status');

function setStatus(message) {
    statusEl.textContent = message;
    window.clearTimeout(setStatus.timer);
    setStatus.timer = window.setTimeout(() => {
        statusEl.textContent = '';
    }, 1400);
}

chrome.storage.local.get({ [DEBUG_REMOTE_KEY]: false }, result => {
    checkbox.checked = result[DEBUG_REMOTE_KEY] === true;
});

checkbox.addEventListener('change', () => {
    chrome.storage.local.set({ [DEBUG_REMOTE_KEY]: checkbox.checked }, () => {
        setStatus('저장됨');
    });
});
