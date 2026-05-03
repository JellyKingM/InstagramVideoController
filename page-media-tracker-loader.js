(function () {
    'use strict';

    const scriptId = 'instagram-video-controller-media-tracker';
    if (document.getElementById(scriptId)) {
        return;
    }

    const script = document.createElement('script');
    script.id = scriptId;
    script.src = chrome.runtime.getURL('page-media-tracker.js');
    (document.documentElement || document.head || document.body).appendChild(script);
})();
