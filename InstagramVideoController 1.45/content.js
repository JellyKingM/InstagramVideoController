(function () {
    'use strict';

    const LOG_PREFIX = '[InstagramVideoController]';
    const STORAGE_KEYS = {
        volume: 'volumeSliderV',
        muted: 'volumeMute',
        playbackRate: 'playbackRateV',
        controllerVisible: 'controllerVisibleV',
        sideBoxVisible: 'sideBoxVisibleV'
    };

    const options = {
        videoControllerV: true,
        volumeMute: false,
        volumeSliderV: 0.5,
        playbackRateV: 1,
        backwardIntervalV: 3,
        forwardIntervalV: 3,
        controllerVisibleV: true,
        sideBoxVisibleV: true
    };

    let panel = null;
    let statusEl = null;
    let activeVideo = null;
    let observer = null;
    let scanTimer = null;
    let applyingVolume = false;
    let sideBox = null;
    let sideBoxVideo = null;
    let sideBoxResizeObserver = null;
    let sideBoxInfo = null;
    let sideBoxControls = null;

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function loadOptionsFromLocalStorage() {
        const savedVolume = localStorage.getItem(STORAGE_KEYS.volume);
        const savedMuteStatus = localStorage.getItem(STORAGE_KEYS.muted);
        const savedPlaybackRate = localStorage.getItem(STORAGE_KEYS.playbackRate);
        const savedControllerVisible = localStorage.getItem(STORAGE_KEYS.controllerVisible);
        const savedSideBoxVisible = localStorage.getItem(STORAGE_KEYS.sideBoxVisible);

        if (savedVolume !== null && !Number.isNaN(parseFloat(savedVolume))) {
            options.volumeSliderV = clamp(parseFloat(savedVolume), 0, 1);
        }

        if (savedMuteStatus !== null) {
            options.volumeMute = savedMuteStatus === 'true';
        }

        if (savedPlaybackRate !== null && !Number.isNaN(parseFloat(savedPlaybackRate))) {
            options.playbackRateV = clamp(parseFloat(savedPlaybackRate), 0.25, 4);
        }

        if (savedControllerVisible !== null) {
            options.controllerVisibleV = savedControllerVisible === 'true';
        }

        if (savedSideBoxVisible !== null) {
            options.sideBoxVisibleV = savedSideBoxVisible === 'true';
        }

        log('loaded options', { ...options });
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
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

    function applySettingsToVideo(video) {
        if (!(video instanceof HTMLVideoElement)) return;

        if (options.videoControllerV) {
            video.controls = true;
        }

        video.volume = options.volumeSliderV;
        video.muted = options.volumeMute;
        video.playbackRate = options.playbackRateV;

        if (video.dataset.instagramVideoControllerProcessed === 'true') return;

        video.dataset.instagramVideoControllerProcessed = 'true';
        video.addEventListener('play', () => {
            activeVideo = video;
            applySettingsToVideo(video);
            updatePanel();
        });

        video.addEventListener('volumechange', () => {
            if (applyingVolume) return;
            options.volumeSliderV = video.volume;
            options.volumeMute = video.muted;
            localStorage.setItem(STORAGE_KEYS.volume, String(options.volumeSliderV));
            localStorage.setItem(STORAGE_KEYS.muted, String(options.volumeMute));
            updatePanel();
        });

        log('processed video', video);
    }

    function processVideos() {
        const videos = getVideos();
        videos.forEach(applySettingsToVideo);

        activeVideo = pickActiveVideo();
        if (activeVideo) {
            markActiveVideo(activeVideo);
        }

        updateSideBox();
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
        title.textContent = 'Instagram Video Controller';
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
        row1.appendChild(createButton('Play', 'Play or pause active video', togglePlay));
        row1.appendChild(createButton('Mute', 'Mute or unmute all videos', toggleMute));
        row1.appendChild(createButton('Ctl', 'Toggle native video controls', toggleNativeControls));
        row1.appendChild(createButton('Find', 'Rescan videos', processVideos));

        const row2 = document.createElement('div');
        row2.style.cssText = 'display: flex; gap: 6px; margin-bottom: 8px;';
        row2.appendChild(createButton('-3s', 'Back 3 seconds', () => seekActive(-options.backwardIntervalV)));
        row2.appendChild(createButton('+3s', 'Forward 3 seconds', () => seekActive(options.forwardIntervalV)));
        row2.appendChild(createButton('-0.25x', 'Slow down', () => setPlaybackRate(options.playbackRateV - 0.25)));
        row2.appendChild(createButton('+0.25x', 'Speed up', () => setPlaybackRate(options.playbackRateV + 0.25)));

        const row3 = document.createElement('div');
        row3.style.cssText = 'display: flex; gap: 6px; margin-bottom: 8px;';
        row3.appendChild(createButton('Box', 'Toggle same-size black box on the left of active video', toggleSideBox));

        const volumeLabel = document.createElement('label');
        volumeLabel.textContent = 'Volume';
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
        mini.title = 'Show Instagram Video Controller';
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

        const videos = getVideos();
        if (!activeVideo || !document.contains(activeVideo)) {
            activeVideo = pickActiveVideo();
        }

        if (activeVideo) {
            markActiveVideo(activeVideo);
        }

        updateSideBox();

        const volumeSlider = document.getElementById('instagram-video-controller-volume');
        if (volumeSlider) {
            volumeSlider.value = String(options.volumeSliderV);
        }

        if (!statusEl) return;

        statusEl.textContent = activeVideo
            ? `Videos: ${videos.length} | ${activeVideo.paused ? 'Paused' : 'Playing'} | ${options.volumeMute ? 'Muted' : 'Unmuted'} | Vol ${Math.round(options.volumeSliderV * 100)}% | ${options.playbackRateV.toFixed(2)}x | Box ${options.sideBoxVisibleV ? 'On' : 'Off'}`
            : `Videos: ${videos.length} | No active video detected`;
    }

    function getAncestor(el, levels) {
        let current = el;
        for (let i = 0; i < levels && current; i++) {
            current = current.parentElement;
        }
        return current;
    }

    function findSideBoxAnchor(video) {
        const oldLayoutAnchor = getAncestor(video, 7);
        return oldLayoutAnchor && oldLayoutAnchor.parentElement
            ? oldLayoutAnchor
            : video.parentElement;
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

    function sizeSideBoxToVideo(video) {
        if (!sideBox || !video) return;

        const width = Math.round(video.offsetWidth || video.getBoundingClientRect().width);
        const height = Math.round(video.offsetHeight || video.getBoundingClientRect().height);
        if (width <= 0 || height <= 0) return;

        sideBox.style.width = `${width}px`;
        sideBox.style.minWidth = `${width}px`;
        sideBox.style.height = `${height}px`;
        sideBox.style.minHeight = `${height}px`;
    }

    function findLegacyInfoElement(video) {
        let redElement = video.nextElementSibling;
        for (let i = 0; i < 5 && redElement; i++) {
            redElement = redElement.children && redElement.children[0];
        }

        return redElement &&
            redElement.nextElementSibling &&
            redElement.nextElementSibling.children &&
            redElement.nextElementSibling.children[0]
            ? redElement.nextElementSibling.children[0]
            : null;
    }

    function findMoreButton(root) {
        if (!root) return null;

        return Array.from(root.querySelectorAll('[role="button"]'))
            .find(button => {
                if (button.getAttribute('aria-disabled') === 'true') return false;
                const text = button.textContent || '';
                return text.includes('더 보기') ||
                    text.includes('더보기') ||
                    text.toLowerCase().includes('more');
            }) || null;
    }

    function clickMoreButton(root) {
        const moreButton = findMoreButton(root);
        if (!moreButton || moreButton.dataset.instagramVideoControllerClickedMore === 'true') return;

        moreButton.dataset.instagramVideoControllerClickedMore = 'true';
        moreButton.click();
        log('clicked more button', moreButton);
    }

    function findInfoElementByMoreButton(video) {
        const overlay = video.nextElementSibling;
        const moreButton = findMoreButton(overlay);
        if (!moreButton) return null;

        let current = moreButton;
        for (let i = 0; i < 4 && current.parentElement && current.parentElement !== overlay; i++) {
            current = current.parentElement;
        }
        return current;
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

    function moveVideoOverlayInfoToSideBox(video) {
        if (!sideBoxInfo || !video) return;

        const overlay = video.nextElementSibling;
        clickMoreButton(overlay);

        let infoElement = findLegacyInfoElement(video) || findInfoElementByMoreButton(video);
        if (!infoElement) {
            if (!sideBoxInfo.dataset.instagramVideoControllerEmptyInfo) {
                sideBoxInfo.dataset.instagramVideoControllerEmptyInfo = 'true';
                sideBoxInfo.textContent = 'No video info area detected.';
            }
            return;
        }

        delete sideBoxInfo.dataset.instagramVideoControllerEmptyInfo;

        if (infoElement.parentElement !== sideBoxInfo) {
            sideBoxInfo.replaceChildren();
            prepareMovedInfoElement(infoElement);
            sideBoxInfo.appendChild(infoElement);
        }

        clickMoreButton(infoElement);
    }

    function hideVideoClickOverlay(video) {
        const overlay = video.nextElementSibling;
        if (!overlay || overlay.dataset.instagramVideoControllerMovedInfo === 'true') return;

        overlay.dataset.instagramVideoControllerHiddenClickOverlay = 'true';
        overlay.style.setProperty('display', 'none', 'important');
        overlay.style.setProperty('pointer-events', 'none', 'important');
    }

    function updateSideBox() {
        if (!options.sideBoxVisibleV || !activeVideo || !document.contains(activeVideo) || !isVisibleVideo(activeVideo)) {
            cleanupSideBox();
            return;
        }

        const anchor = findSideBoxAnchor(activeVideo);
        if (!anchor || !anchor.parentElement) {
            cleanupSideBox();
            return;
        }

        if (!sideBox || sideBoxVideo !== activeVideo || sideBox.nextElementSibling !== anchor) {
            const box = createSideBox(activeVideo);
            anchor.parentElement.insertBefore(box, anchor);

            sideBoxResizeObserver = new ResizeObserver(() => {
                sizeSideBoxToVideo(activeVideo);
            });
            sideBoxResizeObserver.observe(activeVideo);
        }

        sizeSideBoxToVideo(activeVideo);
        moveVideoOverlayInfoToSideBox(activeVideo);
        hideVideoClickOverlay(activeVideo);
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

        getVideos().forEach(video => {
            video.muted = options.volumeMute;
        });
    }

    function toggleNativeControls() {
        options.videoControllerV = !options.videoControllerV;
        getVideos().forEach(video => {
            video.controls = options.videoControllerV;
        });
    }

    function toggleSideBox() {
        options.sideBoxVisibleV = !options.sideBoxVisibleV;
        localStorage.setItem(STORAGE_KEYS.sideBoxVisible, String(options.sideBoxVisibleV));
        updateSideBox();
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

    function startScanning() {
        processVideos();
        if (scanTimer) clearInterval(scanTimer);
        scanTimer = setInterval(processVideos, 1500);
    }

    function initialize() {
        log('content script loaded', location.href);
        loadOptionsFromLocalStorage();
        createPanel();
        installVideoObserver();
        installKeyboardShortcuts();
        installViewportListeners();
        startScanning();
    }

    initialize();
})();
