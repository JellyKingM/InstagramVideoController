
chrome.runtime.onInstalled.addListener(function() {
    chrome.contextMenus.create({
        title: "기부하기 / Donation",
        contexts: ["action"], // 확장 기능 아이콘에 대한 컨텍스트 메뉴 지정
        id: "donationLink"
    });
});

chrome.contextMenus.onClicked.addListener(function(info, tab) {
    if (info.menuItemId === "donationLink") {
        chrome.tabs.create({ url: "https://linktr.ee/Jelly_King" });
    }
});



chrome.action.onClicked.addListener(function(tab) {
    chrome.tabs.create({ url: "https://linktr.ee/Jelly_King" }); // 여기서 URL을 원하는 홈페이지 주소로 변경하세요.
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.redirect) {
        chrome.tabs.create({url: message.redirect});
    }
});
