(function () {
    'use strict';

    const LOG_PREFIX = '[InstagramVideoController]';
    const DONATION_URL = 'https://buymeacoffee.com/madjellyparty';
    const STORAGE_KEYS = {
        volume: 'volumeSliderV',
        muted: 'volumeMute',
        mutedExplicit: 'volumeMuteExplicitV',
        playbackRate: 'playbackRateV',
        controllerVisible: 'controllerVisibleV',
        sideBoxVisible: 'sideBoxVisibleV',
        debugRemoteVisible: 'debugRemoteVisibleV',
        donatePromptSeenCount: 'donatePromptSeenCountV',
        donatePromptNextAt: 'donatePromptNextAtV',
        donatePromptDismissed: 'donatePromptDismissedV'
    };

    const options = {
        videoControllerV: true,
        volumeMute: false,
        volumeSliderV: 0.5,
        playbackRateV: 1,
        backwardIntervalV: 3,
        forwardIntervalV: 3,
        controllerVisibleV: true,
        sideBoxVisibleV: true,
        debugRemoteVisibleV: false
    };

    let panel = null;
    let statusEl = null;
    let activeVideo = null;
    let observer = null;
    let scanTimer = null;
    let applyingVolume = false;
    let applyingMute = false;
    let sideBox = null;
    let sideBoxVideo = null;
    let sideBoxResizeObserver = null;
    let sideBoxInfo = null;
    let sideBoxControls = null;
    let sideBoxRestoreButton = null;
    let donatePrompt = null;
    let movedInfoByVideo = new WeakMap();
    let debugPanel = null;
    let debugOutput = null;
    let debugAnchor = null;
    let debugOverlay = null;
    let debugInfoElement = null;
    let donatePromptSeenCount = 0;
    let donatePromptNextAt = 30;
    let donatePromptDismissed = false;

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function t(key, fallback) {
        try {
            if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
                const message = chrome.i18n.getMessage(key);
                if (message) return message;
            }
        } catch (error) {
            if (!String(error && error.message).includes('Extension context invalidated')) {
                log('i18n lookup failed', error);
            }
        }
        return fallback;
    }

    function loadOptionsFromLocalStorage() {
        const savedVolume = localStorage.getItem(STORAGE_KEYS.volume);
        const savedMuteStatus = localStorage.getItem(STORAGE_KEYS.muted);
        const savedMuteExplicit = localStorage.getItem(STORAGE_KEYS.mutedExplicit);
        const savedPlaybackRate = localStorage.getItem(STORAGE_KEYS.playbackRate);
        const savedControllerVisible = localStorage.getItem(STORAGE_KEYS.controllerVisible);
        const savedDebugRemoteVisible = localStorage.getItem(STORAGE_KEYS.debugRemoteVisible);

        if (savedVolume !== null && !Number.isNaN(parseFloat(savedVolume))) {
            options.volumeSliderV = clamp(parseFloat(savedVolume), 0, 1);
        }

        if (savedMuteExplicit === 'true' && savedMuteStatus !== null) {
            options.volumeMute = savedMuteStatus === 'true';
        }

        if (savedPlaybackRate !== null && !Number.isNaN(parseFloat(savedPlaybackRate))) {
            options.playbackRateV = clamp(parseFloat(savedPlaybackRate), 0.25, 4);
        }

        if (savedControllerVisible !== null) {
            options.controllerVisibleV = savedControllerVisible === 'true';
        }

        if (savedDebugRemoteVisible !== null) {
            options.debugRemoteVisibleV = savedDebugRemoteVisible === 'true';
        }

        const savedDonatePromptSeenCount = parseInt(localStorage.getItem(STORAGE_KEYS.donatePromptSeenCount) || '0', 10);
        const savedDonatePromptNextAt = parseInt(localStorage.getItem(STORAGE_KEYS.donatePromptNextAt) || '30', 10);
        const savedDonatePromptDismissed = localStorage.getItem(STORAGE_KEYS.donatePromptDismissed);

        if (Number.isFinite(savedDonatePromptSeenCount) && savedDonatePromptSeenCount >= 0) {
            donatePromptSeenCount = savedDonatePromptSeenCount;
        }

        if (Number.isFinite(savedDonatePromptNextAt) && savedDonatePromptNextAt > 0) {
            donatePromptNextAt = savedDonatePromptNextAt;
        }

        if (savedDonatePromptDismissed !== null) {
            donatePromptDismissed = savedDonatePromptDismissed === 'true';
        }

        log('loaded options', { ...options });
    }

    function loadOptionsFromExtensionStorage(callback) {
        try {
            if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
                callback();
                return;
            }

            chrome.storage.local.get({ [STORAGE_KEYS.debugRemoteVisible]: options.debugRemoteVisibleV }, result => {
                options.debugRemoteVisibleV = result[STORAGE_KEYS.debugRemoteVisible] === true;
                localStorage.setItem(STORAGE_KEYS.debugRemoteVisible, String(options.debugRemoteVisibleV));
                callback();
            });
        } catch (error) {
            if (!String(error && error.message).includes('Extension context invalidated')) {
                log('storage lookup failed', error);
            }
            callback();
        }
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function persistDonatePromptState() {
        localStorage.setItem(STORAGE_KEYS.donatePromptSeenCount, String(donatePromptSeenCount));
        localStorage.setItem(STORAGE_KEYS.donatePromptNextAt, String(donatePromptNextAt));
        localStorage.setItem(STORAGE_KEYS.donatePromptDismissed, String(donatePromptDismissed));
    }

    function openDonatePage() {
        try {
            window.open(DONATION_URL, '_blank', 'noopener,noreferrer');
        } catch (error) {
            log('failed to open donate page', error);
            location.href = DONATION_URL;
        }
    }

    function getVideos() {
        return Array.from(document.querySelectorAll('video'));
    }

    function isVisibleVideo(video) {
        const rect = video.getBoundingClientRect();
        return rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth;
    }

    function getVisibleArea(video) {
        const rect = video.getBoundingClientRect();
        const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
        const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        return width * height;
    }

    function pickActiveVideo() {
        const videos = getVideos();
        const playing = videos.find(video => !video.paused && !video.ended && isVisibleVideo(video));
        if (playing) return playing;

        return videos
            .filter(isVisibleVideo)
            .sort((a, b) => getVisibleArea(b) - getVisibleArea(a))[0] || videos[0] || null;
    }

    function markActiveVideo(video) {
        getVideos().forEach(candidate => {
            candidate.style.outline = '';
            candidate.style.outlineOffset = '';
            if (candidate === video) {
                candidate.dataset.instagramVideoControllerActive = 'true';
            } else if (candidate.dataset.instagramVideoControllerActive === 'true') {
                delete candidate.dataset.instagramVideoControllerActive;
            }
        });
    }

    function applyVideoContainerStyle(video) {
        const container = getAncestor(video, 5);
        if (!container) return;

        container.dataset.instagramVideoControllerSquareContainer = 'true';
        container.style.setProperty('border-radius', '0', 'important');
    }

    function applySettingsToVideo(video) {
        if (!(video instanceof HTMLVideoElement)) return;

        if (options.videoControllerV) {
            video.controls = true;
        }

        video.volume = options.volumeSliderV;
        applyingMute = true;
        video.muted = options.volumeMute;
        window.setTimeout(() => {
            applyingMute = false;
        }, 0);
        video.playbackRate = options.playbackRateV;
        applyVideoContainerStyle(video);
        hideReelPageVideoNextSibling(video);

        if (video.dataset.instagramVideoControllerProcessed === 'true') return;

        video.dataset.instagramVideoControllerProcessed = 'true';
        video.addEventListener('play', () => {
            activeVideo = video;
            applySettingsToVideo(video);
            updatePanel();
        });

        video.addEventListener('volumechange', () => {
            if (applyingVolume || applyingMute) return;
            options.volumeSliderV = video.volume;
            localStorage.setItem(STORAGE_KEYS.volume, String(options.volumeSliderV));
            updatePanel();
        });

        log('processed video', video);
    }

    function processVideos() {
        if (!isSupportedPage()) {
            activeVideo = null;
            cleanupSideBox();
            hideSideBoxRestoreButton();
            markActiveVideo(null);
            updatePanel();
            return;
        }

        const videos = getVideos();
        videos.forEach(applySettingsToVideo);

        activeVideo = pickActiveVideo();
        if (activeVideo) {
            markActiveVideo(activeVideo);
        }

        if (!options.debugRemoteVisibleV) {
            updateSideBox();
        }
        updatePanel();
    }

    function createButton(label, title, onClick) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.title = title;
        button.style.cssText = `
            min-width: 34px;
            height: 30px;
            border: 1px solid rgba(255,255,255,0.22);
            border-radius: 6px;
            background: rgba(255,255,255,0.12);
            color: #fff;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
        `;
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            onClick();
            updatePanel();
        });
        return button;
    }

    function createPanel() {
        if (panel) return panel;

        panel = document.createElement('div');
        panel.id = 'instagram-video-controller-panel';
        panel.style.cssText = `
            box-sizing: border-box;
            width: 100%;
            padding: 10px;
            border-top: 1px solid rgba(255,255,255,0.16);
            background: rgba(18,18,18,0.96);
            color: #fff;
            font-family: Arial, sans-serif;
            font-size: 12px;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 8px;
        `;

        const title = document.createElement('strong');
        title.textContent = t('panelTitle', 'Instagram Video Controller');
        title.style.cssText = 'font-size: 12px; line-height: 1.2;';

        header.appendChild(title);

        statusEl = document.createElement('div');
        statusEl.style.cssText = `
            margin-bottom: 8px;
            color: #cfd8ff;
            line-height: 1.35;
            word-break: break-word;
        `;

        const row1 = document.createElement('div');
        row1.style.cssText = 'display: flex; gap: 6px; margin-bottom: 8px;';
        row1.appendChild(createButton(t('buttonPlay', 'Play'), t('tooltipPlay', 'Play or pause active video'), togglePlay));
        row1.appendChild(createButton(t('buttonMute', 'Mute'), t('tooltipMute', 'Mute or unmute all videos'), toggleMute));
        row1.appendChild(createButton(t('buttonControls', 'Controls'), t('tooltipControls', 'Toggle native video controls'), toggleNativeControls));
        row1.appendChild(createButton(t('buttonFind', 'Find'), t('tooltipFind', 'Rescan videos'), processVideos));

        const row2 = document.createElement('div');
        row2.style.cssText = 'display: flex; gap: 6px; margin-bottom: 8px;';
        row2.appendChild(createButton('-3s', t('tooltipBack', 'Back 3 seconds'), () => seekActive(-options.backwardIntervalV)));
        row2.appendChild(createButton('+3s', t('tooltipForward', 'Forward 3 seconds'), () => seekActive(options.forwardIntervalV)));
        row2.appendChild(createButton('-0.25x', t('tooltipSlowDown', 'Slow down'), () => setPlaybackRate(options.playbackRateV - 0.25)));
        row2.appendChild(createButton('+0.25x', t('tooltipSpeedUp', 'Speed up'), () => setPlaybackRate(options.playbackRateV + 0.25)));

        const row3 = document.createElement('div');
        row3.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 8px;';
        row3.appendChild(createButton(t('buttonHideBox', 'Hide box'), t('tooltipHideBox', 'Hide the side box'), hideSideBox));
        row3.appendChild(createButton(t('donate', 'Donate'), t('tooltipDonate', 'Support the developer'), handleDonateNow));

        const volumeLabel = document.createElement('label');
        volumeLabel.textContent = t('volumeLabel', 'Volume');
        volumeLabel.style.cssText = 'display: block; margin-bottom: 4px;';

        const volumeSlider = document.createElement('input');
        volumeSlider.id = 'instagram-video-controller-volume';
        volumeSlider.type = 'range';
        volumeSlider.min = '0';
        volumeSlider.max = '1';
        volumeSlider.step = '0.01';
        volumeSlider.style.cssText = 'width: 100%;';
        volumeSlider.addEventListener('input', () => {
            setVolume(parseFloat(volumeSlider.value));
        });

        panel.appendChild(header);
        panel.appendChild(statusEl);
        panel.appendChild(row1);
        panel.appendChild(row2);
        panel.appendChild(row3);
        panel.appendChild(volumeLabel);
        panel.appendChild(volumeSlider);

        return panel;
    }

    function showMiniButton() {
        if (document.getElementById('instagram-video-controller-mini')) return;

        const mini = document.createElement('button');
        mini.id = 'instagram-video-controller-mini';
        mini.type = 'button';
        mini.textContent = 'IVC';
        mini.title = t('tooltipShowController', 'Show Instagram Video Controller');
        mini.style.cssText = `
            position: fixed;
            left: 16px;
            bottom: 16px;
            z-index: 2147483647;
            width: 48px;
            height: 32px;
            border: 0;
            border-radius: 6px;
            background: #2f8cff;
            color: #fff;
            cursor: pointer;
            font: 700 12px Arial, sans-serif;
            box-shadow: 0 6px 18px rgba(0,0,0,0.35);
        `;
        mini.addEventListener('click', () => {
            options.controllerVisibleV = true;
            localStorage.setItem(STORAGE_KEYS.controllerVisible, 'true');
            mini.remove();
            createPanel().style.display = 'block';
            updatePanel();
        });
        document.documentElement.appendChild(mini);
    }

    function updatePanel() {
        createPanel().style.display = 'block';

        if (!activeVideo || !document.contains(activeVideo)) {
            activeVideo = pickActiveVideo();
        }

        if (activeVideo) {
            markActiveVideo(activeVideo);
        }

        if (!options.debugRemoteVisibleV) {
            updateSideBox();
        }

        const volumeSlider = document.getElementById('instagram-video-controller-volume');
        if (volumeSlider) {
            volumeSlider.value = String(options.volumeSliderV);
        }

        if (!statusEl) return;

        statusEl.textContent = activeVideo
            ? `${activeVideo.paused ? t('statusPaused', 'Paused') : t('statusPlaying', 'Playing')} | ${options.volumeMute ? t('statusMuted', 'Muted') : t('statusUnmuted', 'Unmuted')} | ${t('statusVolumeShort', 'Vol')} ${Math.round(options.volumeSliderV * 100)}% | ${options.playbackRateV.toFixed(2)}x`
            : t('statusNoActiveVideo', 'No active video detected');
    }

    function getAncestor(el, levels) {
        let current = el;
        for (let i = 0; i < levels && current; i++) {
            current = current.parentElement;
        }
        return current;
    }

    function isSingleReelPage() {
        return /^\/reel\/[^/]+\/?/.test(location.pathname);
    }

    function isReelsPage() {
        return /^\/reels\/?/.test(location.pathname);
    }

    function isPostPage() {
        return /^\/p\/[^/]+\/?/.test(location.pathname);
    }

    function isStoriesPage() {
        return /^\/stories\/[^/]+(?:\/[^/]+)?\/?/.test(location.pathname);
    }

    function usesDirectVideoSiblingAnchor() {
        return isPostPage();
    }

    function isSupportedPage() {
        return isSingleReelPage() || isReelsPage() || isPostPage() || isStoriesPage();
    }

    function getInsertAnchorFromParent(parent) {
        if (!parent) return null;

        return Array.from(parent.children)
            .find(child => child !== sideBox && child !== sideBoxRestoreButton) || null;
    }

    function findSideBoxAnchor(video) {
        if ((isSingleReelPage() || isStoriesPage()) && video) {
            const pageAnchor = getAncestor(video, isSingleReelPage() ? 9 : 15);
            if (pageAnchor && pageAnchor.parentElement) {
                const parentAnchor = getInsertAnchorFromParent(pageAnchor.parentElement);
                if (parentAnchor) {
                    return parentAnchor;
                }
            }
        }

        if (usesDirectVideoSiblingAnchor()) {
            const directAnchor = video && video.nextElementSibling;
            if (directAnchor && directAnchor !== sideBox && directAnchor !== sideBoxRestoreButton) {
                return directAnchor;
            }
        }

        if (isReelsPage()) {
            const reelAnchorLevels = [9, 8, 7, 6];
            for (const level of reelAnchorLevels) {
                const reelContainer = getAncestor(video, level);
                if (!reelContainer || !reelContainer.parentElement) continue;

                const siblings = Array.from(reelContainer.parentElement.children)
                    .filter(child => child !== sideBox && child !== sideBoxRestoreButton);

                if (siblings.length >= 2) {
                    return siblings[0];
                }
            }
        }

        const anchorLevels = 7;
        const layoutAnchor = getAncestor(video, anchorLevels);
        return layoutAnchor && layoutAnchor.parentElement
            ? getInsertAnchorFromParent(layoutAnchor.parentElement) || layoutAnchor
            : getInsertAnchorFromParent(video.parentElement) || video.parentElement;
    }

    function getReelPageSideBoxMaxWidth(anchor) {
        if (!isSingleReelPage() || !anchor || !anchor.parentElement) return 0;

        const siblings = Array.from(anchor.parentElement.children)
            .filter(child => child !== sideBox && child !== sideBoxRestoreButton);
        const lastSibling = siblings[siblings.length - 1];
        if (!lastSibling) return 0;

        return Math.round(lastSibling.getBoundingClientRect().width || lastSibling.offsetWidth || 0);
    }

    function cleanupSideBox() {
        if (sideBoxResizeObserver) {
            sideBoxResizeObserver.disconnect();
            sideBoxResizeObserver = null;
        }

        if (sideBox) {
            sideBox.remove();
            sideBox = null;
            sideBoxVideo = null;
            sideBoxInfo = null;
            sideBoxControls = null;
        }

        donatePrompt = null;
    }

    function hideSideBoxRestoreButton() {
        if (!sideBoxRestoreButton) return;
        sideBoxRestoreButton.remove();
        sideBoxRestoreButton = null;
    }

    function updateSideBoxRestoreButton(video) {
        if (!video || !document.contains(video) || !isVisibleVideo(video)) {
            hideSideBoxRestoreButton();
            return;
        }

        const anchor = findSideBoxAnchor(video);
        if (!anchor || !anchor.parentElement) {
            hideSideBoxRestoreButton();
            return;
        }

        if (!sideBoxRestoreButton) {
            sideBoxRestoreButton = document.createElement('div');
            sideBoxRestoreButton.id = 'instagram-video-controller-show-box-slot';
            sideBoxRestoreButton.style.cssText = `
                box-sizing: border-box;
                flex: 0 0 auto;
                align-self: stretch;
                position: relative;
                display: flex;
                align-items: flex-end;
                justify-content: flex-start;
                pointer-events: none;
            `;

            const button = document.createElement('button');
            button.id = 'instagram-video-controller-show-box';
            button.type = 'button';
            button.textContent = t('buttonShowBox', 'Show box');
            button.title = t('tooltipShowBox', 'Show the side box');
            button.style.cssText = `
                min-width: 74px;
                height: 30px;
                border: 0;
                border-radius: 6px;
                background: #2f8cff;
                color: #fff;
                cursor: pointer;
                font: 700 12px Arial, sans-serif;
                box-shadow: 0 6px 18px rgba(0,0,0,0.35);
                pointer-events: auto;
            `;
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                showSideBox();
            });
            sideBoxRestoreButton.appendChild(button);
        }

        if (sideBoxRestoreButton.nextElementSibling !== anchor) {
            anchor.parentElement.insertBefore(sideBoxRestoreButton, anchor);
        }

        const width = Math.round(video.offsetWidth || video.getBoundingClientRect().width);
        const height = Math.round(video.offsetHeight || video.getBoundingClientRect().height);
        if (width > 0) {
            sideBoxRestoreButton.style.width = `${width}px`;
            sideBoxRestoreButton.style.minWidth = `${width}px`;
            sideBoxRestoreButton.style.maxWidth = `${width}px`;
        }
        if (height > 0) {
            sideBoxRestoreButton.style.height = `${height}px`;
            sideBoxRestoreButton.style.minHeight = `${height}px`;
            sideBoxRestoreButton.style.maxHeight = `${height}px`;
        }
    }

    function createSideBox(video) {
        cleanupSideBox();

        sideBox = document.createElement('div');
        sideBox.id = 'instagram-video-controller-side-box';
        sideBox.dataset.instagramVideoControllerSideBox = 'true';
        sideBox.style.cssText = `
            box-sizing: border-box;
            flex: 0 0 auto;
            align-self: stretch;
            position: relative;
            overflow: hidden;
            background: #000;
            pointer-events: auto;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            color: #fff;
        `;

        sideBoxInfo = document.createElement('div');
        sideBoxInfo.id = 'instagram-video-controller-side-info';
        sideBoxInfo.style.cssText = `
            box-sizing: border-box;
            width: 100%;
            min-height: 0;
            overflow: auto;
            padding: 12px;
            color: #fff;
            font-family: Arial, sans-serif;
            font-size: 14px;
            line-height: 1.35;
        `;

        sideBoxControls = document.createElement('div');
        sideBoxControls.id = 'instagram-video-controller-side-controls';
        sideBoxControls.style.cssText = `
            box-sizing: border-box;
            width: 100%;
            flex: 0 0 auto;
        `;

        sideBox.appendChild(sideBoxInfo);
        sideBox.appendChild(sideBoxControls);
        sideBoxControls.appendChild(createPanel());
        sideBoxVideo = video;
        return sideBox;
    }

    function createDonatePrompt() {
        if (donatePrompt) return donatePrompt;

        donatePrompt = document.createElement('div');
        donatePrompt.id = 'instagram-video-controller-donate-prompt';
        donatePrompt.style.cssText = `
            position: absolute;
            right: 12px;
            bottom: 12px;
            z-index: 3;
            width: min(236px, calc(100% - 24px));
            padding: 10px;
            border: 1px solid rgba(255,255,255,0.18);
            border-radius: 6px;
            background: rgba(255,255,255,0.96);
            color: #111;
            box-shadow: 0 10px 24px rgba(0,0,0,0.3);
            font: 12px/1.4 Arial, sans-serif;
        `;

        const message = document.createElement('div');
        message.textContent = t(
            'donatePromptMessage',
            '잘 사용하고 계신가요? 앱이 마음에 드신다면 후원 부탁드립니다.'
        );
        message.style.cssText = 'margin-bottom: 8px;';

        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end;';

        const donateButton = createButton(
            t('donate', 'Donate'),
            t('tooltipDonate', 'Support the developer'),
            handleDonateNow
        );
        donateButton.style.minWidth = '68px';
        donateButton.style.height = '28px';
        donateButton.style.background = '#2f8cff';
        donateButton.style.border = '0';

        const laterButton = createButton(
            t('donatePromptLater', 'Later'),
            t('donatePromptLaterTooltip', 'Hide this prompt for now'),
            handleDonateLater
        );
        laterButton.style.height = '28px';
        laterButton.style.background = '#f3f4f6';
        laterButton.style.border = '1px solid rgba(17,17,17,0.14)';
        laterButton.style.color = '#111';
        laterButton.style.boxShadow = 'none';

        const dismissButton = createButton(
            t('donatePromptNever', 'Never again'),
            t('donatePromptNeverTooltip', 'Do not show this prompt again'),
            handleDonateDismissForever
        );
        dismissButton.style.height = '28px';
        dismissButton.style.background = '#e5e7eb';
        dismissButton.style.border = '1px solid rgba(17,17,17,0.16)';
        dismissButton.style.color = '#111';
        dismissButton.style.boxShadow = 'none';

        actions.appendChild(donateButton);
        actions.appendChild(laterButton);
        actions.appendChild(dismissButton);

        donatePrompt.appendChild(message);
        donatePrompt.appendChild(actions);
        return donatePrompt;
    }

    function hideDonatePrompt() {
        if (!donatePrompt) return;
        donatePrompt.remove();
        donatePrompt = null;
    }

    function shouldShowDonatePrompt() {
        return !donatePromptDismissed && donatePromptSeenCount >= donatePromptNextAt;
    }

    function updateDonatePromptVisibility() {
        if (!sideBox) {
            hideDonatePrompt();
            return;
        }

        if (!shouldShowDonatePrompt()) {
            hideDonatePrompt();
            return;
        }

        const prompt = createDonatePrompt();
        if (prompt.parentElement !== sideBox) {
            sideBox.appendChild(prompt);
        }
    }

    function recordSideBoxShown() {
        donatePromptSeenCount += 1;
        persistDonatePromptState();
    }

    function sizeSideBoxToVideo(video) {
        if (!sideBox || !video) return;

        const anchor = findSideBoxAnchor(video);
        const maxWidth = getReelPageSideBoxMaxWidth(anchor);
        const width = maxWidth || Math.round(video.offsetWidth || video.getBoundingClientRect().width);
        const height = Math.round(video.offsetHeight || video.getBoundingClientRect().height);
        if (width <= 0 || height <= 0) return;

        sideBox.style.width = `${width}px`;
        sideBox.style.minWidth = `${width}px`;
        sideBox.style.maxWidth = `${width}px`;
        sideBox.style.height = `${height}px`;
        sideBox.style.minHeight = `${height}px`;
        sideBox.style.maxHeight = `${height}px`;
    }

    function isDescriptionMoreButton(button) {
        if (!(button instanceof Element)) return false;
        if (button.getAttribute('aria-disabled') === 'true') return false;
        if (button.getAttribute('aria-label')) return false;

        const text = button.textContent || '';
        const hiddenMore = button.querySelector('span[aria-hidden="true"]');
        const autoText = button.querySelector('[dir="auto"]');
        return (text.includes('더 보기') || text.includes('더보기') || text.toLowerCase().includes('more')) &&
            hiddenMore &&
            autoText &&
            !button.querySelector('svg');
    }

    function findMoreButton(root) {
        if (!root) return null;

        return Array.from(root.querySelectorAll('[role="button"]'))
            .find(isDescriptionMoreButton) || null;
    }

    function clickMoreButton(root) {
        const moreButton = findMoreButton(root);
        if (!moreButton || moreButton.dataset.instagramVideoControllerClickedMore === 'true') return;

        moreButton.dataset.instagramVideoControllerClickedMore = 'true';
        moreButton.click();
        log('clicked more button', moreButton);
    }

    function findInfoElementByMoreButton(video) {
        const overlay = getVideoOverlay(video);
        const moreButton = findMoreButton(overlay);
        if (!moreButton) return null;

        const candidates = [];
        let current = moreButton;
        while (current && current.parentElement && current !== overlay) {
            current = current.parentElement;
            if (current !== overlay) {
                candidates.push(current);
            }
        }

        return candidates.find(candidate =>
            candidate.querySelector('a[role="link"]') &&
            candidate.querySelector('[role="presentation"]') &&
            candidate.contains(moreButton)
        ) || candidates.find(candidate =>
            candidate.querySelector('[role="presentation"]') &&
            candidate.contains(moreButton)
        ) || moreButton.parentElement;
    }

    function prepareMovedInfoElement(infoElement) {
        infoElement.dataset.instagramVideoControllerMovedInfo = 'true';
        infoElement.style.maxHeight = 'none';
        infoElement.style.height = 'auto';
        infoElement.style.overflow = 'visible';
        infoElement.style.pointerEvents = 'auto';
        infoElement.style.color = '#fff';

        Array.from(infoElement.querySelectorAll('*')).forEach(child => {
            child.style.pointerEvents = 'auto';
            child.style.color = 'inherit';
        });
    }

    function hasMovedInfoForVideo(video) {
        const infoElement = movedInfoByVideo.get(video);
        return infoElement &&
            infoElement.dataset.instagramVideoControllerMovedInfo === 'true';
    }

    function attachMovedInfoToSideBox(video) {
        if (!sideBoxInfo || !hasMovedInfoForVideo(video)) return false;

        const infoElement = movedInfoByVideo.get(video);
        delete sideBoxInfo.dataset.instagramVideoControllerEmptyInfo;
        if (infoElement.parentElement !== sideBoxInfo) {
            sideBoxInfo.replaceChildren();
            sideBoxInfo.appendChild(infoElement);
        }
        return true;
    }

    function moveVideoOverlayInfoToSideBox(video) {
        if (!sideBoxInfo || !video) return false;

        if (attachMovedInfoToSideBox(video)) {
            clickMoreButton(movedInfoByVideo.get(video));
            return true;
        }

        const overlay = getVideoOverlay(video);
        restoreVideoClickOverlayForInfoSearch(overlay);
        clickMoreButton(overlay);

        let infoElement = findInfoElementByMoreButton(video);
        if (!infoElement) {
            if (sideBoxInfo.children.length === 0 && !sideBoxInfo.dataset.instagramVideoControllerEmptyInfo) {
                sideBoxInfo.dataset.instagramVideoControllerEmptyInfo = 'true';
                sideBoxInfo.textContent = t('noVideoInfo', 'No video info area detected.');
            }
            return false;
        }

        delete sideBoxInfo.dataset.instagramVideoControllerEmptyInfo;

        if (infoElement.parentElement !== sideBoxInfo) {
            sideBoxInfo.replaceChildren();
            prepareMovedInfoElement(infoElement);
            sideBoxInfo.appendChild(infoElement);
        }
        movedInfoByVideo.set(video, infoElement);

        clickMoreButton(infoElement);
        return true;
    }

    function restoreVideoClickOverlayForInfoSearch(overlay) {
        if (!overlay || overlay.dataset.instagramVideoControllerInfoMoved === 'true') return;

        if (overlay.dataset.instagramVideoControllerHiddenClickOverlay === 'true') {
            overlay.style.removeProperty('display');
            overlay.style.removeProperty('pointer-events');
            delete overlay.dataset.instagramVideoControllerHiddenClickOverlay;
        }
    }

    function getVideoOverlay(video) {
        return video && video.nextElementSibling;
    }

    function findPlaybackClickOverlay(overlay) {
        if (!overlay) return null;

        const labels = ['재생', '일시정지', 'play', 'pause'];
        return Array.from(overlay.querySelectorAll('[role="button"]'))
            .find(button => {
                const label = `${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`.toLowerCase();
                return labels.some(item => label.includes(item));
            }) || null;
    }

    function hideVideoClickOverlay(overlay) {
        const playbackOverlay = findPlaybackClickOverlay(overlay);
        if (!playbackOverlay || playbackOverlay.dataset.instagramVideoControllerMovedInfo === 'true') return;

        playbackOverlay.dataset.instagramVideoControllerHiddenClickOverlay = 'true';
        playbackOverlay.style.setProperty('display', 'none', 'important');
        playbackOverlay.style.setProperty('pointer-events', 'none', 'important');
    }

    function findVideoPlayerElement(video) {
        const overlay = getVideoOverlay(video);
        return (overlay && overlay.querySelector('[aria-label="Video player"]'))
            || (video && video.parentElement && video.parentElement.querySelector('[aria-label="Video player"]'))
            || document.querySelector('[aria-label="Video player"]');
    }

    function hideVideoPlayerElement(video) {
        const videoPlayer = findVideoPlayerElement(video);
        if (!videoPlayer) return false;

        videoPlayer.dataset.instagramVideoControllerHiddenVideoPlayer = 'true';
        videoPlayer.style.setProperty('display', 'none', 'important');
        return true;
    }

    function hideVideoNextOverlay(video) {
        const overlay = getVideoOverlay(video);
        if (!overlay) return false;

        overlay.dataset.instagramVideoControllerHiddenOverlay = 'true';
        overlay.style.setProperty('display', 'none', 'important');
        overlay.style.setProperty('pointer-events', 'none', 'important');
        return true;
    }

    function hideReelPageVideoNextSibling(video) {
        if (!isSingleReelPage()) return false;

        const sibling = getVideoOverlay(video);
        if (!sibling) return false;

        sibling.dataset.instagramVideoControllerHiddenReelSibling = 'true';
        sibling.style.setProperty('display', 'none', 'important');
        return true;
    }

    function updateSideBox() {
        if (!isSupportedPage()) {
            cleanupSideBox();
            hideSideBoxRestoreButton();
            return;
        }

        if (!activeVideo || !document.contains(activeVideo) || !isVisibleVideo(activeVideo)) {
            cleanupSideBox();
            hideSideBoxRestoreButton();
            return;
        }

        const hiddenReelSibling = hideReelPageVideoNextSibling(activeVideo);

        if (!options.sideBoxVisibleV) {
            cleanupSideBox();
            updateSideBoxRestoreButton(activeVideo);
            return;
        }

        hideSideBoxRestoreButton();

        const anchor = findSideBoxAnchor(activeVideo);
        if (!anchor || !anchor.parentElement) {
            cleanupSideBox();
            return;
        }

        if (!sideBox || sideBoxVideo !== activeVideo || sideBox.nextElementSibling !== anchor) {
            const box = createSideBox(activeVideo);
            anchor.parentElement.insertBefore(box, anchor);
            recordSideBoxShown();

            if (!isSingleReelPage()) {
                sideBoxResizeObserver = new ResizeObserver(() => {
                    sizeSideBoxToVideo(activeVideo);
                });
                sideBoxResizeObserver.observe(activeVideo);
            }
        }

        sizeSideBoxToVideo(activeVideo);
        updateDonatePromptVisibility();
        const overlay = getVideoOverlay(activeVideo);
        const movedInfo = moveVideoOverlayInfoToSideBox(activeVideo);
        if (movedInfo) {
            hideVideoClickOverlay(overlay);
            if (!hiddenReelSibling) {
                hideVideoNextOverlay(activeVideo);
            }
        }
    }

    function withActiveVideo(callback) {
        if (!activeVideo || !document.contains(activeVideo)) {
            activeVideo = pickActiveVideo();
        }
        if (!activeVideo) {
            log('no active video');
            updatePanel();
            return;
        }
        callback(activeVideo);
        applySettingsToVideo(activeVideo);
    }

    function togglePlay() {
        withActiveVideo(video => {
            if (video.paused) {
                video.play().catch(error => log('play failed', error));
            } else {
                video.pause();
            }
        });
    }

    function toggleMute() {
        options.volumeMute = !options.volumeMute;
        localStorage.setItem(STORAGE_KEYS.muted, String(options.volumeMute));
        localStorage.setItem(STORAGE_KEYS.mutedExplicit, 'true');

        applyingMute = true;
        getVideos().forEach(video => {
            video.muted = options.volumeMute;
        });
        window.setTimeout(() => {
            applyingMute = false;
        }, 0);
    }

    function toggleNativeControls() {
        options.videoControllerV = !options.videoControllerV;
        getVideos().forEach(video => {
            video.controls = options.videoControllerV;
        });
    }

    function setSideBoxVisible(visible) {
        options.sideBoxVisibleV = visible;
        updateSideBox();
    }

    function hideSideBox() {
        setSideBoxVisible(false);
    }

    function showSideBox() {
        setSideBoxVisible(true);
        updatePanel();
    }

    function handleDonateNow() {
        donatePromptDismissed = true;
        persistDonatePromptState();
        hideDonatePrompt();
        openDonatePage();
    }

    function handleDonateLater() {
        donatePromptNextAt = donatePromptSeenCount + 30;
        persistDonatePromptState();
        hideDonatePrompt();
    }

    function handleDonateDismissForever() {
        donatePromptDismissed = true;
        persistDonatePromptState();
        hideDonatePrompt();
    }

    function toggleSideBox() {
        setSideBoxVisible(!options.sideBoxVisibleV);
    }

    function seekActive(seconds) {
        withActiveVideo(video => {
            if (Number.isFinite(video.duration)) {
                video.currentTime = clamp(video.currentTime + seconds, 0, video.duration);
            } else {
                video.currentTime = Math.max(0, video.currentTime + seconds);
            }
        });
    }

    function setPlaybackRate(rate) {
        options.playbackRateV = clamp(rate, 0.25, 4);
        localStorage.setItem(STORAGE_KEYS.playbackRate, String(options.playbackRateV));
        getVideos().forEach(video => {
            video.playbackRate = options.playbackRateV;
        });
    }

    function setVolume(volume) {
        options.volumeSliderV = clamp(volume, 0, 1);
        localStorage.setItem(STORAGE_KEYS.volume, String(options.volumeSliderV));

        applyingVolume = true;
        getVideos().forEach(video => {
            video.volume = options.volumeSliderV;
        });
        applyingVolume = false;
        updatePanel();
    }

    function installVideoObserver() {
        if (observer) return;

        observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node.matches('video') || node.querySelector('video')) {
                        log('video node detected');
                        processVideos();
                        return;
                    }
                }
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    function installKeyboardShortcuts() {
        document.addEventListener('keydown', event => {
            if (event.target && (
                event.target.tagName === 'INPUT' ||
                event.target.tagName === 'TEXTAREA' ||
                event.target.isContentEditable
            )) return;

            if (event.code === 'KeyM') {
                toggleMute();
                updatePanel();
            } else if (event.code === 'Comma') {
                setPlaybackRate(options.playbackRateV - 0.25);
            } else if (event.code === 'Period') {
                setPlaybackRate(options.playbackRateV + 0.25);
            } else if (event.code === 'KeyB') {
                toggleSideBox();
            }
        }, true);
    }

    function installViewportListeners() {
        window.addEventListener('resize', updateSideBox, { passive: true });
        window.addEventListener('scroll', updateSideBox, { passive: true, capture: true });
    }

    function createDebugPanel() {
        if (debugPanel) return debugPanel;

        debugPanel = document.createElement('div');
        debugPanel.id = 'instagram-video-controller-debug-panel';
        debugPanel.style.cssText = `
            position: fixed;
            right: 16px;
            top: 80px;
            z-index: 2147483647;
            width: 300px;
            max-height: calc(100vh - 100px);
            overflow: auto;
            box-sizing: border-box;
            padding: 10px;
            border: 1px solid rgba(255,255,255,0.22);
            border-radius: 8px;
            background: rgba(12,12,12,0.94);
            color: #fff;
            font-family: Arial, sans-serif;
            font-size: 12px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.35);
        `;

        const title = document.createElement('strong');
        title.textContent = 'IVC Debug Steps';
        title.style.cssText = 'display:block; margin-bottom:8px; font-size:13px;';
        debugPanel.appendChild(title);

        const steps = [
            ['1. Find videos', debugFindVideos],
            ['2. Pick active video', debugPickActiveVideo],
            ['3. Apply video settings', debugApplyVideoSettings],
            ['4. Find side anchor', debugFindSideAnchor],
            ['5. Create side box', debugCreateSideBox],
            ['6. Size side box', debugSizeSideBox],
            ['7. Move info', debugMoveInfo],
            ['8. Hide next overlay', debugHideNextOverlay],
            ['Run 1-2-3-4-5-6-7-8', debugRunFullSequence],
            ['Cleanup side box', () => {
                cleanupSideBox();
                debugAnchor = null;
                debugOverlay = null;
                debugInfoElement = null;
                debugLog('cleaned side box');
            }]
        ];

        steps.forEach(([label, handler]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.style.cssText = `
                display: block;
                width: 100%;
                min-height: 30px;
                margin-bottom: 6px;
                border: 1px solid rgba(255,255,255,0.22);
                border-radius: 6px;
                background: rgba(255,255,255,0.12);
                color: #fff;
                cursor: pointer;
                text-align: left;
                font-size: 12px;
            `;
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                try {
                    handler();
                } catch (error) {
                    debugLog(`error: ${error.message}`);
                    console.error(LOG_PREFIX, error);
                }
            });
            debugPanel.appendChild(button);
        });

        debugOutput = document.createElement('pre');
        debugOutput.style.cssText = `
            white-space: pre-wrap;
            word-break: break-word;
            max-height: 220px;
            overflow: auto;
            margin: 8px 0 0;
            padding: 8px;
            border-radius: 6px;
            background: rgba(255,255,255,0.08);
            color: #cfd8ff;
            font: 11px Consolas, monospace;
        `;
        debugPanel.appendChild(debugOutput);
        document.documentElement.appendChild(debugPanel);
        debugLog('debug mode ready');
        return debugPanel;
    }

    function removeDebugPanel() {
        if (debugPanel) {
            debugPanel.remove();
            debugPanel = null;
            debugOutput = null;
        }
    }

    function debugLog(message, value) {
        const text = value === undefined ? message : `${message}: ${formatDebugValue(value)}`;
        log('[debug]', text);
        if (!debugOutput) return;
        const now = new Date().toLocaleTimeString();
        debugOutput.textContent = `[${now}] ${text}\n${debugOutput.textContent}`;
    }

    function formatDebugValue(value) {
        if (value instanceof Element) {
            const rect = value.getBoundingClientRect();
            const id = value.id ? `#${value.id}` : '';
            const classes = value.className && typeof value.className === 'string'
                ? `.${value.className.trim().split(/\s+/).slice(0, 4).join('.')}`
                : '';
            return `<${value.tagName.toLowerCase()}${id}${classes}> ${Math.round(rect.width)}x${Math.round(rect.height)}`;
        }
        if (Array.isArray(value)) return `${value.length} item(s)`;
        if (value && typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    function requireActiveVideo() {
        if (!activeVideo || !document.contains(activeVideo)) {
            activeVideo = pickActiveVideo();
        }
        if (!activeVideo) {
            debugLog('no active video');
            return null;
        }
        return activeVideo;
    }

    function debugFindVideos() {
        const videos = getVideos();
        debugLog('videos found', videos);
        videos.forEach(applySettingsToVideo);
    }

    function debugPickActiveVideo() {
        activeVideo = pickActiveVideo();
        if (activeVideo) markActiveVideo(activeVideo);
        debugLog('active video', activeVideo || 'none');
    }

    function debugApplyVideoSettings() {
        const video = requireActiveVideo();
        if (!video) return;
        applySettingsToVideo(video);
        debugLog('applied settings', {
            controls: video.controls,
            muted: video.muted,
            volume: video.volume,
            playbackRate: video.playbackRate
        });
    }

    function debugFindSideAnchor() {
        const video = requireActiveVideo();
        if (!video) return;
        debugAnchor = findSideBoxAnchor(video);
        debugLog('side anchor', debugAnchor || 'none');
    }

    function debugCreateSideBox() {
        const video = requireActiveVideo();
        if (!video) return;
        if (!debugAnchor || !document.contains(debugAnchor)) {
            debugAnchor = findSideBoxAnchor(video);
        }
        if (!debugAnchor || !debugAnchor.parentElement) {
            debugLog('side anchor missing');
            return;
        }
        const box = createSideBox(video);
        debugAnchor.parentElement.insertBefore(box, debugAnchor);
        debugLog('created side box', box);
    }

    function debugSizeSideBox() {
        const video = requireActiveVideo();
        if (!video) return;
        sizeSideBoxToVideo(video);
        debugLog('sized side box', sideBox || 'none');
    }

    function debugFindOverlay() {
        const video = requireActiveVideo();
        if (!video) return;
        debugOverlay = getVideoOverlay(video);
        debugLog('video next sibling overlay', debugOverlay || 'none');
    }

    function debugRestoreOverlay() {
        if (!debugOverlay) debugFindOverlay();
        restoreVideoClickOverlayForInfoSearch(debugOverlay);
        debugLog('restored overlay for search', debugOverlay || 'none');
    }

    function debugClickMore() {
        if (!debugOverlay) debugFindOverlay();
        clickMoreButton(debugOverlay);
        debugLog('clicked more in overlay', debugOverlay || 'none');
    }

    function debugFindDescriptionMore() {
        const video = requireActiveVideo();
        if (!video) return;
        debugOverlay = getVideoOverlay(video);
        debugInfoElement = findMoreButton(debugOverlay);
        debugLog('description more button', debugInfoElement || 'none');
    }

    function debugFindInfoByMore() {
        const video = requireActiveVideo();
        if (!video) return;
        debugInfoElement = findInfoElementByMoreButton(video);
        debugLog('info by more element', debugInfoElement || 'none');
    }

    function debugMoveInfo() {
        const video = requireActiveVideo();
        if (!video) return;
        if (!sideBoxInfo) {
            debugLog('side box info container missing');
            return;
        }
        if (attachMovedInfoToSideBox(video)) {
            debugInfoElement = movedInfoByVideo.get(video);
            clickMoreButton(debugInfoElement);
            debugLog('restored moved info element', debugInfoElement);
            return;
        }
        if (!debugOverlay) debugOverlay = getVideoOverlay(video);
        restoreVideoClickOverlayForInfoSearch(debugOverlay);
        clickMoreButton(debugOverlay);
        debugInfoElement = findInfoElementByMoreButton(video);
        if (!debugInfoElement) {
            debugLog('info element not found');
            return;
        }
        sideBoxInfo.replaceChildren();
        prepareMovedInfoElement(debugInfoElement);
        sideBoxInfo.appendChild(debugInfoElement);
        movedInfoByVideo.set(video, debugInfoElement);
        clickMoreButton(debugInfoElement);
        debugLog('moved info element', debugInfoElement);
    }

    function debugHideOverlay() {
        if (!debugOverlay) debugFindOverlay();
        hideVideoClickOverlay(debugOverlay);
        debugLog('hidden overlay', debugOverlay || 'none');
    }

    function debugHideVideoPlayer() {
        const video = requireActiveVideo();
        if (!video) return;
        const hidden = hideVideoPlayerElement(video);
        debugLog('hidden aria-label=Video player', hidden ? findVideoPlayerElement(video) : 'none');
    }

    function debugHideNextOverlay() {
        const video = requireActiveVideo();
        if (!video) return;
        const overlay = getVideoOverlay(video);
        const hidden = hideVideoNextOverlay(video);
        debugLog('hidden video next overlay', hidden ? overlay : 'none');
    }

    function debugRunFullSequence() {
        debugFindVideos();
        debugPickActiveVideo();
        debugApplyVideoSettings();
        debugFindSideAnchor();
        debugCreateSideBox();
        debugSizeSideBox();
        debugMoveInfo();
        if (debugInfoElement && debugInfoElement.parentElement === sideBoxInfo) {
            debugHideNextOverlay();
        } else {
            debugLog('skip hiding next overlay because info was not moved');
        }
        updatePanel();
        debugLog('1-2-3-4-5-6-7-8 sequence complete');
    }

    function startScanning() {
        processVideos();
        if (options.debugRemoteVisibleV) return;
        if (scanTimer) clearInterval(scanTimer);
        scanTimer = setInterval(processVideos, 1500);
    }

    function applyDebugRemoteVisibility(enabled) {
        options.debugRemoteVisibleV = enabled;
        localStorage.setItem(STORAGE_KEYS.debugRemoteVisible, String(enabled));

        if (enabled) {
            if (scanTimer) {
                clearInterval(scanTimer);
                scanTimer = null;
            }
            createDebugPanel();
        } else {
            removeDebugPanel();
            startScanning();
        }
    }

    function installOptionListeners() {
        try {
            if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;

            chrome.storage.onChanged.addListener((changes, areaName) => {
                if (areaName !== 'local' || !changes[STORAGE_KEYS.debugRemoteVisible]) return;
                applyDebugRemoteVisibility(changes[STORAGE_KEYS.debugRemoteVisible].newValue === true);
            });
        } catch (error) {
            if (!String(error && error.message).includes('Extension context invalidated')) {
                log('storage listener install failed', error);
            }
        }
    }

    function initialize() {
        log('content script loaded', location.href);
        loadOptionsFromLocalStorage();
        loadOptionsFromExtensionStorage(() => {
            createPanel();
            if (options.debugRemoteVisibleV) createDebugPanel();
            installVideoObserver();
            installKeyboardShortcuts();
            installViewportListeners();
            installOptionListeners();
            startScanning();
        });
    }

    initialize();
})();
