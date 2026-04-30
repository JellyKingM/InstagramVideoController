importScripts('shared.js');

chrome.runtime.onInstalled.addListener(function () {
    chrome.contextMenus.create({
        title: chrome.i18n.getMessage('donate') || 'Donate to Developer',
        contexts: ['action'],
        id: IVC_SHARED.IDS.donationMenu
    });
});

chrome.contextMenus.onClicked.addListener(function (info) {
    if (info.menuItemId === IVC_SHARED.IDS.donationMenu) {
        chrome.tabs.create({ url: IVC_SHARED.LINKS.donate });
    }
});

chrome.action.onClicked.addListener(function () {
    chrome.tabs.create({ url: IVC_SHARED.LINKS.developer });
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.redirect) {
        chrome.tabs.create({ url: message.redirect });
        return;
    }

    if (message.downloadVideo && message.downloadVideo.url) {
        console.log('[InstagramVideoController]', 'download request', message.downloadVideo);
        chrome.downloads.download({
            url: message.downloadVideo.url,
            filename: message.downloadVideo.filename || 'instagram-video.mp4',
            saveAs: false
        }, function (downloadId) {
            if (chrome.runtime.lastError) {
                console.log('[InstagramVideoController]', 'download error', chrome.runtime.lastError.message);
                sendResponse({
                    ok: false,
                    error: chrome.runtime.lastError.message
                });
                return;
            }

            console.log('[InstagramVideoController]', 'download started', downloadId);
            sendResponse({
                ok: true,
                downloadId
            });
        });
        return true;
    }
});
