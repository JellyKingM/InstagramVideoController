(function () {
    'use strict';

    const LOG_PREFIX = '[InstagramVideoController]';
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
    const PAGE_DOWNLOAD_REQUEST_EVENT = 'instagram-video-controller-download-request';
    const PAGE_DOWNLOAD_RESULT_EVENT = 'instagram-video-controller-download-result';

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

    function ensurePageDownloadBridge() {
        if (document.getElementById('instagram-video-controller-download-bridge')) return;

        const script = document.createElement('script');
        script.id = 'instagram-video-controller-download-bridge';
        script.src = chrome.runtime.getURL('page-download-bridge.js');
        document.documentElement.appendChild(script);
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
            window.open(IVC_SHARED.LINKS.donate, '_blank', 'noopener,noreferrer');
        } catch (error) {
            log('failed to open donate page', error);
            location.href = IVC_SHARED.LINKS.donate;
        }
    }

    function getVideos() {
        return Array.from(document.querySelectorAll('video'));
    }

    function isCarouselVideo(video) {
        if (!(video instanceof HTMLVideoElement)) return false;

        const slideItem = video.closest('li');
        if (slideItem && slideItem.parentElement) {
            const siblingSlides = Array.from(slideItem.parentElement.children)
                .filter(child => child.tagName === 'LI');

            if (siblingSlides.length > 1) {
                return true;
            }
        }

        const list = video.closest('ul');
        if (list) {
            const directSlides = Array.from(list.children)
                .filter(child => child.tagName === 'LI');

            if (directSlides.length > 1) {
                return true;
            }
        }

        return false;
    }

    function isEligibleVideo(video) {
        if (!(video instanceof HTMLVideoElement)) return false;
        if (!isVisibleVideo(video)) return false;

        if (isPostPage()) {
            return !isCarouselVideo(video);
        }

        return true;
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
        const eligibleVideos = videos.filter(isEligibleVideo);
        const playing = eligibleVideos.find(video => !video.paused && !video.ended);
        if (playing) return playing;

        if (eligibleVideos.length > 0) {
            return eligibleVideos
                .sort((a, b) => getVisibleArea(b) - getVisibleArea(a))[0] || null;
        }

        if (isPostPage()) {
            return null;
        }

        return videos[0] || null;
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

    function applyStandalonePostLayoutStyle(video) {
        if (!video || !isStandalonePostPageLayout()) return;

        const container = getAncestor(video, 18);
        const outerContainer = getAncestor(video, 19);
        if (!container) return;

        container.dataset.instagramVideoControllerStandalonePostLayout = 'true';
        container.style.setProperty('display', 'flex', 'important');
        container.style.setProperty('flex-wrap', 'wrap', 'important');

        if (outerContainer) {
            outerContainer.dataset.instagramVideoControllerStandalonePostOuterLayout = 'true';
            outerContainer.style.setProperty('max-width', 'none', 'important');
        }
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
        applyStandalonePostLayoutStyle(video);
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

    async function downloadActiveVideo() {
        if (!activeVideo || !document.contains(activeVideo)) {
            activeVideo = pickActiveVideo();
        }
        if (!activeVideo) return;

        const diagnostics = getVideoDownloadDiagnostics(activeVideo);
        log('video download diagnostics', diagnostics);

        const sourceUrl = diagnostics.primaryUrl;
        if (!sourceUrl) return;

        try {
            if (diagnostics.guessedType === 'blob') {
                const capturedResponse = await chrome.runtime.sendMessage({
                    downloadCapturedVideo: true
                });
                if (!capturedResponse || !capturedResponse.ok) {
                    throw new Error(capturedResponse && capturedResponse.error ? capturedResponse.error : 'captured media download failed');
                }
                log('captured media download started', capturedResponse);
                return;
            }

            const response = await chrome.runtime.sendMessage({
                downloadVideo: {
                    url: sourceUrl,
                    filename: getDownloadFileName(sourceUrl)
                }
            });
            if (!response || !response.ok) {
                throw new Error(response && response.error ? response.error : 'download request failed');
            }
            log('video download started', {
                url: sourceUrl,
                downloadId: response.downloadId
            });
        } catch (error) {
            log('video download fallback', error);
            window.open(sourceUrl, '_blank', 'noopener,noreferrer');
        }
    }

    function requestPageBlobDownload(video, sourceUrl, filename) {
        return new Promise((resolve, reject) => {
            ensurePageDownloadBridge();
            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const targetId = `ivc-download-${requestId}`;
            if (video) {
                video.dataset.instagramVideoControllerDownloadTarget = targetId;
            }

            const onResult = event => {
                const detail = event && event.detail ? event.detail : {};
                if (detail.requestId !== requestId) return;
                window.removeEventListener(PAGE_DOWNLOAD_RESULT_EVENT, onResult);
                if (video && video.dataset.instagramVideoControllerDownloadTarget === targetId) {
                    delete video.dataset.instagramVideoControllerDownloadTarget;
                }
                if (detail.ok) {
                    resolve();
                    return;
                }
                reject(new Error(detail.error || 'page blob download failed'));
            };

            window.addEventListener(PAGE_DOWNLOAD_RESULT_EVENT, onResult);
            window.dispatchEvent(new CustomEvent(PAGE_DOWNLOAD_REQUEST_EVENT, {
                detail: {
                    requestId,
                    url: sourceUrl,
                    filename,
                    targetId
                }
            }));
        });
    }

    function getVideoDownloadDiagnostics(video) {
        const sourceElements = Array.from(video ? video.querySelectorAll('source') : []);
        const sourceUrls = sourceElements
            .map(source => ({
                src: source.src || source.getAttribute('src') || '',
                type: source.type || source.getAttribute('type') || ''
            }))
            .filter(item => item.src);

        const primaryUrl = (video && (video.currentSrc || video.src)) || sourceUrls[0]?.src || '';
        return {
            primaryUrl,
            currentSrc: video ? video.currentSrc || '' : '',
            src: video ? video.src || '' : '',
            currentTime: video ? video.currentTime : null,
            duration: video ? video.duration : null,
            paused: video ? video.paused : null,
            readyState: video ? video.readyState : null,
            sourceUrls,
            guessedType: guessVideoSourceType(primaryUrl)
        };
    }

    function guessVideoSourceType(url) {
        if (!url) return 'missing';
        if (url.startsWith('blob:')) return 'blob';
        if (/\.m3u8($|\?)/i.test(url)) return 'm3u8';
        if (/\.mpd($|\?)/i.test(url)) return 'mpd';
        if (/\.mp4($|\?)/i.test(url)) return 'mp4';
        return 'unknown';
    }

    function getDownloadFileName(sourceUrl) {
        try {
            const url = new URL(sourceUrl, location.href);
            const pathName = url.pathname.split('/').filter(Boolean).pop() || 'instagram-video.mp4';
            return pathName.includes('.') ? pathName : `${pathName}.mp4`;
        } catch (error) {
            return 'instagram-video.mp4';
        }
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
        row1.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;';

        const row1Left = document.createElement('div');
        row1Left.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;';
        row1Left.appendChild(createButton(t('buttonPlay', 'Play'), t('tooltipPlay', 'Play or pause active video'), togglePlay));
        row1Left.appendChild(createButton(t('buttonMute', 'Mute'), t('tooltipMute', 'Mute or unmute all videos'), toggleMute));
        row1Left.appendChild(createButton(t('buttonControls', 'Controls'), t('tooltipControls', 'Toggle native video controls'), toggleNativeControls));
        row1Left.appendChild(createButton(t('buttonFind', 'Find'), t('tooltipFind', 'Rescan videos'), processVideos));

        const downloadButton = createButton(
            t('buttonDownloadVideo', 'Download video'),
            t('tooltipDownloadVideo', 'Download the active video'),
            downloadActiveVideo
        );
        downloadButton.style.marginLeft = 'auto';

        row1.appendChild(row1Left);
        row1.appendChild(downloadButton);

        const row2 = document.createElement('div');
        row2.style.cssText = 'display: flex; gap: 6px; margin-bottom: 8px;';
        row2.appendChild(createButton('-3s', t('tooltipBack', 'Back 3 seconds'), () => seekActive(-options.backwardIntervalV)));
        row2.appendChild(createButton('+3s', t('tooltipForward', 'Forward 3 seconds'), () => seekActive(options.forwardIntervalV)));
        row2.appendChild(createButton('-0.25x', t('tooltipSlowDown', 'Slow down'), () => setPlaybackRate(options.playbackRateV - 0.25)));
        row2.appendChild(createButton('+0.25x', t('tooltipSpeedUp', 'Speed up'), () => setPlaybackRate(options.playbackRateV + 0.25)));

        const row3 = document.createElement('div');
        row3.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 8px;';
        row3.appendChild(createButton(t('buttonHideBox', 'Hide box'), t('tooltipHideBox', 'Hide the side box'), hideSideBox));
        row3.appendChild(createButton(t('donate', 'Donate'), t('tooltipDonate', 'Support the developer'), handleDonateButton));

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

    function isStandalonePostPageLayout() {
        if (!isPostPage()) return false;

        return !!document.querySelector('div._ap3a._aaco._aacw._aacy._aad6');
    }

    function isPopupPostLayout() {
        return isPostPage() && !isStandalonePostPageLayout();
    }

    function isReelStyleLayout() {
        return isSingleReelPage() || isPopupPostLayout();
    }

    function usesDirectVideoSiblingAnchor() {
        return false;
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
        if ((isSingleReelPage() || isStoriesPage() || isPostPage()) && video) {
            const pageAnchor = getAncestor(
                video,
                isReelStyleLayout() ? 13 : (isStoriesPage() ? 19 : 17)
            );
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
            const reelAnchorLevels = [11, 10, 9, 8, 7, 6];
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

    function clampNumber(value, min, max) {
        return Math.min(Math.max(value, min), max);
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
            z-index: 2147483646;
            overflow: hidden;
            background: rgba(18, 18, 18, 0.96);
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
            background: rgba(18, 18, 18, 0.96);
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
            handleDonatePromptNow
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

        const videoRect = video.getBoundingClientRect();
        const height = Math.round(video.offsetHeight || videoRect.height);
        if (height <= 0) return;

        if (isStandalonePostPageLayout()) {
            sideBox.style.removeProperty('width');
            sideBox.style.removeProperty('min-width');
            sideBox.style.removeProperty('max-width');
        } else {
            const width = isStoriesPage()
                ? Math.round(video.offsetWidth || videoRect.width)
                : ((isReelsPage() || isReelStyleLayout()) ? 497 : 337);
            if (width <= 0) return;
            sideBox.style.setProperty('width', `${width}px`, 'important');
            sideBox.style.setProperty('min-width', `${width}px`, 'important');
            sideBox.style.setProperty('max-width', `${width}px`, 'important');
        }

        sideBox.style.setProperty('align-self', isStoriesPage() ? 'flex-start' : 'stretch', 'important');

        sideBox.style.setProperty('height', `${height}px`, 'important');
        sideBox.style.setProperty('min-height', `${height}px`, 'important');
        sideBox.style.setProperty('max-height', `${height}px`, 'important');
    }

    function isDescriptionMoreButton(button) {
        if (!(button instanceof Element)) return false;
        if (button.getAttribute('aria-disabled') === 'true') return false;
        if (button.getAttribute('aria-label')) return false;

        const text = button.textContent || '';
        const hiddenMore = button.querySelector('span[aria-hidden="true"]');
        const autoText = button.querySelector('[dir="auto"]');
        const normalizedText = text.toLowerCase();
        const hasMoreText =
            normalizedText.includes('more') ||
            normalizedText.includes('see more');
        const matchesWrapperShape =
            !!button.querySelector('.x1xmf6yo') &&
            !!autoText &&
            !button.querySelector('svg');

        return (
            (hasMoreText && hiddenMore && autoText && !button.querySelector('svg')) ||
            (matchesWrapperShape && !!button.closest('[role="presentation"]'))
        );
    }

    function findMoreButton(root) {
        if (!root) return null;

        return Array.from(root.querySelectorAll('[role="button"]'))
            .find(isDescriptionMoreButton) || null;
    }

    function getDescriptionSearchRoots(video) {
        const roots = [];
        const pushRoot = root => {
            if (!root || !(root instanceof Element)) return;
            if (video && root === video) return;
            if (video && root.contains(video) && root.tagName === 'VIDEO') return;
            if (!roots.includes(root)) roots.push(root);
        };

        pushRoot(getVideoOverlay(video));

        if (video && (isReelsPage() || isSingleReelPage())) {
            const levels = [11, 10, 9, 8];
            for (const level of levels) {
                const container = getAncestor(video, level);
                if (!container) continue;
                pushRoot(container.firstElementChild);
                pushRoot(container);
            }
        }

        return roots;
    }

    function findMoreButtonForVideo(video) {
        const roots = getDescriptionSearchRoots(video);
        for (const root of roots) {
            const button = findMoreButton(root);
            if (button) return button;
        }
        return null;
    }

    function clickMoreButton(root) {
        const moreButton = findMoreButton(root);
        if (!moreButton || moreButton.dataset.instagramVideoControllerClickedMore === 'true') return;

        moreButton.dataset.instagramVideoControllerClickedMore = 'true';
        moreButton.click();
        log('clicked more button', moreButton);
    }

    function clickMoreButtonForVideo(video) {
        const moreButton = findMoreButtonForVideo(video);
        if (!moreButton || moreButton.dataset.instagramVideoControllerClickedMore === 'true') return false;

        moreButton.dataset.instagramVideoControllerClickedMore = 'true';
        moreButton.click();
        log('clicked more button for video', moreButton);
        return true;
    }

    function getFixedInfoElementForVideo(video) {
        if (!video) return null;

        if (isReelsPage()) {
            for (const level of [11, 10, 9, 8]) {
                const root = getAncestor(video, level);
                const firstChild = root && root.firstElementChild;
                const secondChild = firstChild && firstChild.children.length >= 2
                    ? firstChild.children[1]
                    : null;
                if (!(secondChild instanceof Element)) continue;

                if (
                    secondChild.querySelector('a[role="link"]') ||
                    secondChild.querySelector('[role="presentation"]') ||
                    secondChild.querySelector('[role="button"]')
                ) {
                    return secondChild;
                }
            }

            const wideVideoRoot = getAncestor(video, 10);
            if (wideVideoRoot && wideVideoRoot.parentElement) {
                const wideVideoSibling = Array.from(wideVideoRoot.parentElement.children)
                    .find(child => child !== wideVideoRoot);

                if (
                    wideVideoSibling instanceof Element &&
                    (
                        wideVideoSibling.querySelector('a[role="link"]') ||
                        wideVideoSibling.querySelector('[role="presentation"]') ||
                        wideVideoSibling.querySelector('[role="button"]')
                    )
                ) {
                    return wideVideoSibling;
                }
            }
        }

        return null;
    }

    function getFixedInfoWrapperForVideo(video) {
        if (!video || !isReelsPage()) return null;

        const root = getAncestor(video, 11);
        const firstChild = root && root.firstElementChild;
        return firstChild instanceof Element ? firstChild : null;
    }

    function findInfoElementByMoreButton(video) {
        const fixedInfoElement = getFixedInfoElementForVideo(video);
        if (fixedInfoElement) {
            return fixedInfoElement;
        }

        const moreButton = findMoreButtonForVideo(video);
        if (!moreButton) return null;

        const candidates = [];
        let current = moreButton;
        const searchRoots = getDescriptionSearchRoots(video);
        const stopAt = searchRoots.find(root => root && root.contains(moreButton)) || null;
        while (current && current.parentElement && current !== stopAt) {
            current = current.parentElement;
            if (current !== stopAt) {
                candidates.push(current);
            }
        }

        const topLevelInfoCandidate = [...candidates].reverse().find(candidate =>
            candidate.contains(moreButton) &&
            candidate.children.length >= 2 &&
            candidate.firstElementChild &&
            candidate.querySelector('[role="presentation"]') &&
            (
                candidate.firstElementChild.querySelector('img') ||
                candidate.firstElementChild.querySelector('a[role="link"]') ||
                candidate.firstElementChild.querySelector('[role="button"]')
            )
        );
        if (topLevelInfoCandidate) {
            const infoWrapper = topLevelInfoCandidate.firstElementChild;
            const infoSection = infoWrapper && infoWrapper.children.length >= 2
                ? infoWrapper.children[1]
                : null;
            if (infoSection instanceof Element && infoSection.contains(moreButton)) {
                return infoSection;
            }
            return topLevelInfoCandidate;
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

    function applyWhiteTextToInfoElement(infoElement) {
        if (!(infoElement instanceof Element)) return;

        infoElement.style.setProperty('color', '#fff', 'important');
        Array.from(infoElement.querySelectorAll('*')).forEach(child => {
            child.style.setProperty('color', 'inherit', 'important');
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

        if (isReelStyleLayout()) {
            sideBoxInfo.replaceChildren();
            delete sideBoxInfo.dataset.instagramVideoControllerEmptyInfo;
            clickMoreButtonForVideo(video);
            const infoElement = findInfoElementByMoreButton(video);
            applyWhiteTextToInfoElement(infoElement);
            return false;
        }

        if (attachMovedInfoToSideBox(video)) {
            clickMoreButton(movedInfoByVideo.get(video));
            return true;
        }

        const overlay = getVideoOverlay(video);
        restoreVideoClickOverlayForInfoSearch(overlay);
        clickMoreButtonForVideo(video);

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

    function hideAllVideoPlayerElements() {
        if (isReelStyleLayout()) return 0;

        const players = Array.from(document.querySelectorAll('[aria-label="Video player"]'));
        players.forEach(player => {
            player.dataset.instagramVideoControllerHiddenVideoPlayer = 'true';
            player.style.setProperty('display', 'none', 'important');
        });
        return players.length;
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

        return false;
    }

    function hideReelPageClickCover(video) {
        if (!isReelStyleLayout() || !video) return false;

        const ancestor = getAncestor(video, 7);
        if (!ancestor || !ancestor.parentElement) return false;

        const siblings = Array.from(ancestor.parentElement.children)
            .filter(child => child !== sideBox && child !== sideBoxRestoreButton);
        const ancestorIndex = siblings.indexOf(ancestor);
        if (ancestorIndex < 0) return false;

        const nextSibling = siblings[ancestorIndex + 1];
        if (!nextSibling) return false;

        nextSibling.dataset.instagramVideoControllerHiddenReelClickCover = 'true';
        nextSibling.style.setProperty('display', 'none', 'important');
        return true;
    }

    function updateSideBox() {
        if (!isSupportedPage()) {
            cleanupSideBox();
            hideSideBoxRestoreButton();
            return;
        }

        if (isPostPage() && activeVideo && !isEligibleVideo(activeVideo)) {
            cleanupSideBox();
            hideSideBoxRestoreButton();
            return;
        }

        if (!activeVideo || !document.contains(activeVideo) || !isVisibleVideo(activeVideo)) {
            cleanupSideBox();
            hideSideBoxRestoreButton();
            return;
        }

        hideAllVideoPlayerElements();

        const hiddenReelSibling = hideReelPageVideoNextSibling(activeVideo);
        hideReelPageClickCover(activeVideo);

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

        if (!sideBox || sideBoxVideo !== activeVideo) {
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
        else if (sideBox.parentElement !== anchor.parentElement || sideBox.nextElementSibling !== anchor) {
            anchor.parentElement.insertBefore(sideBox, anchor);
        }

        sizeSideBoxToVideo(activeVideo);
        updateDonatePromptVisibility();
        const overlay = getVideoOverlay(activeVideo);
        const movedInfo = moveVideoOverlayInfoToSideBox(activeVideo);
        if (movedInfo) {
            if (!isReelStyleLayout()) {
                hideVideoClickOverlay(overlay);
            }
            if (!hiddenReelSibling && !isReelStyleLayout()) {
                hideVideoNextOverlay(activeVideo);
            }
            hideAllVideoPlayerElements();
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

    function handleDonateButton() {
        openDonatePage();
    }

    function handleDonatePromptNow() {
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
