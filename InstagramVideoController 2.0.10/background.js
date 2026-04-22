chrome.runtime.onInstalled.addListener(function() {
    chrome.contextMenus.create({
        title: "기부하기 / Donation",
        contexts: ["action"],
        id: "donationLink"
    });
});

chrome.contextMenus.onClicked.addListener(function(info, tab) {
    if (info.menuItemId === "donationLink") {
        chrome.tabs.create({ url: "https://ko-fi.com/jelly_king" });
    }
});

chrome.action.onClicked.addListener(function(tab) {
    chrome.tabs.create({ url: "https://linktr.ee/Jelly_King" });
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.redirect) {
        chrome.tabs.create({url: message.redirect});
    }
});
