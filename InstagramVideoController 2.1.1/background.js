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

chrome.runtime.onMessage.addListener(function (message) {
    if (message.redirect) {
        chrome.tabs.create({ url: message.redirect });
    }
});
