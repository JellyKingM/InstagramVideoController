function t(key, fallback) {
    return chrome.i18n.getMessage(key) || fallback;
}

document.getElementById('settings').textContent = t('settings', 'Options');
document.getElementById('developer').textContent = t('developerLink', 'Developer Page');
document.getElementById('donate').textContent = t('donate', 'Donate to Developer');

document.getElementById('settings').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
});

document.getElementById('developer').addEventListener('click', function () {
    chrome.tabs.create({ url: IVC_SHARED.LINKS.developer });
});

document.getElementById('donate').addEventListener('click', function () {
    chrome.tabs.create({ url: IVC_SHARED.LINKS.donate });
});
