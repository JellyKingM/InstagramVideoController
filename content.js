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
    const MEDIA_TRACKER_REQUEST_EVENT = 'instagram-video-controller-media-map-request';
    const MEDIA_TRACKER_RESPONSE_EVENT = 'instagram-video-controller-media-map-response';

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
    let floatingLogButton = null;
    let donatePrompt = null;
    let movedInfoByVideo = new WeakMap();
    let expandedInfoByVideo = new WeakSet();
    let movedInfoColorObserverByVideo = new WeakMap();
    let restoreInfoTimerByVideo = new WeakMap();
    let debugPanel = null;
    let debugOutput = null;
    let debugAnchor = null;
    let debugOverlay = null;
    let debugInfoElement = null;
    let downloadButtonEl = null;
    let downloadButtonResetTimer = null;
    let donatePromptSeenCount = 0;
    let donatePromptNextAt = 30;
    let donatePromptDismissed = false;
    let wideReelsInfoObserver = null;
    let pinMediaTimer = null;
    let movedInfoStash = null;
    let pendingSideBoxVideo = null;
    let mediaHintStartedAt = 0;
    let userInteractionAt = 0;
    let fullscreenVideo = null;
    let internalLogs = [];
    let capturedMediaBundleByVideo = new WeakMap();
    let mediaHintStartedAtByVideo = new WeakMap();
    let mediaIdentityByVideo = new WeakMap();
    let lockedSideBoxBundle = null;
    let lockedSideBoxIdentity = '';
    let sideBoxVideoIdentity = '';
    let sideBoxCreatedAt = 0;
    let lastRejectedBundleInfo = null;
    let manualPauseByVideo = new WeakMap();
    let internalPlayRequestAtByVideo = new WeakMap();
    let hiddenWideInfoWrapperByVideo = new WeakMap();
    let lastReexpandLogAtByVideo = new WeakMap();
    const MAX_INTERNAL_LOGS = 120;

    function log(...args) {
        try {
            const rendered = args.map(renderLogValue).join(' ');
            internalLogs.push(`[${new Date().toISOString()}] ${rendered}`);
            if (internalLogs.length > MAX_INTERNAL_LOGS) {
                internalLogs = internalLogs.slice(-MAX_INTERNAL_LOGS);
            }
        } catch (error) {
            console.log(LOG_PREFIX, 'failed to record internal log', error);
        }
        console.log(LOG_PREFIX, ...args);
    }

    function buildConciseInternalLogLines() {
        const importantPatterns = [
            'video download diagnostics',
            'tracked blob media urls',
            'tracked blob media download started',
            'tracked blob media download failed',
            'explicit media bundle download started',
            'explicit media bundle download failed',
            'captured media download started',
            'pin captured media failed',
            'pin captured media before download',
            'pinned captured media',
            'rejecting pinned media due to duration mismatch',
            'performance video download started',
            'video download fallback',
            'skipping stale locked sidebox bundle'
        ];

        return internalLogs
            .filter(line => importantPatterns.some(pattern => line.includes(pattern)))
            .slice(-20);
    }

    function renderLogValue(value) {
        if (value instanceof HTMLVideoElement) {
            return describeVideo(value);
        }
        if (value instanceof Element) {
            return describeElement(value);
        }
        if (value instanceof Error) {
            return `${value.name}: ${value.message}`;
        }
        if (typeof value === 'string') {
            return truncateForLog(value, 220);
        }
        try {
            return truncateForLog(JSON.stringify(value), 320);
        } catch (error) {
            return truncateForLog(String(value), 220);
        }
    }

    function truncateForLog(text, maxLength = 220) {
        const stringValue = String(text || '');
        if (stringValue.length <= maxLength) {
            return stringValue;
        }
        return `${stringValue.slice(0, maxLength)}...(+${stringValue.length - maxLength})`;
    }

    function shortenUrlForLog(url) {
        if (!url) return '';
        if (url.startsWith('blob:')) {
            const blobId = url.split('/').pop() || url;
            return `blob:${blobId}`;
        }
        try {
            const parsed = new URL(url);
            const pathTail = parsed.pathname.split('/').filter(Boolean).pop() || '';
            const assetId = parsed.searchParams.get('xpv_asset_id') || '';
            const duration = parsed.searchParams.get('bytestart') || '';
            const tag = parsed.searchParams.get('efg') ? 'efg' : '';
            return `${parsed.hostname}/${pathTail}${assetId ? `?asset=${assetId}` : ''}${duration ? `&start=${duration}` : ''}${tag ? '&efg=1' : ''}`;
        } catch (error) {
            return truncateForLog(url, 120);
        }
    }

    function summarizeBundleForLog(bundle) {
        if (!bundle || !bundle.video) return 'null';
        return JSON.stringify({
            videoAssetId: bundle.video.assetId || '',
            videoDuration: Number(bundle.video.duration || 0),
            videoUrl: shortenUrlForLog(bundle.video.url || ''),
            audioAssetId: bundle.audio && bundle.audio.assetId || '',
            audioDuration: bundle.audio ? Number(bundle.audio.duration || 0) : 0,
            audioUrl: bundle.audio ? shortenUrlForLog(bundle.audio.url || '') : ''
        });
    }

    function describeElement(element) {
        if (!(element instanceof Element)) return String(element);
        const id = element.id ? `#${element.id}` : '';
        const className = typeof element.className === 'string' && element.className.trim()
            ? `.${element.className.trim().replace(/\s+/g, '.')}`
            : '';
        return `<${element.tagName.toLowerCase()}${id}${className}>`;
    }

    function describeVideo(video) {
        if (!(video instanceof HTMLVideoElement)) return String(video);
        const rect = video.getBoundingClientRect();
        return `video{currentTime=${Number(video.currentTime || 0).toFixed(2)},duration=${Number(video.duration || 0).toFixed(2)},paused=${video.paused},muted=${video.muted},volume=${Number(video.volume || 0).toFixed(2)},size=${Math.round(rect.width)}x${Math.round(rect.height)}}`;
    }

    async function exportInternalLogs() {
        try {
            const currentDownloadFileName = (() => {
                try {
                    const targetVideo = getDownloadTargetVideo();
                    if (targetVideo instanceof HTMLVideoElement) {
                        return getDownloadFileName(targetVideo.currentSrc || targetVideo.src || location.href);
                    }
                } catch (error) {
                    return '';
                }
                return '';
            })();

            const downloadDebugLines = await buildDownloadDebugLines();
            const conciseInternalLogs = buildConciseInternalLogLines();
            const lines = [
                'Instagram Video Controller internal log',
                `time=${new Date().toISOString()}`,
                `url=${location.href}`,
                `activeVideo=${renderLogValue(activeVideo)}`,
                `sideBoxVideo=${renderLogValue(sideBoxVideo)}`,
                `sideBoxVideoIdentity=${sideBoxVideoIdentity || ''}`,
                `sideBoxCreatedAt=${sideBoxCreatedAt || 0}`,
                `lockedSideBoxIdentity=${lockedSideBoxIdentity || ''}`,
                `lockedSideBoxBundle=${summarizeBundleForLog(lockedSideBoxBundle)}`,
                `lastRejectedBundleInfo=${renderLogValue(lastRejectedBundleInfo)}`,
                `currentDownloadFileName=${currentDownloadFileName}`,
                '',
                '=== download debug ===',
                ...downloadDebugLines,
                '',
                '=== internal logs ===',
                ...(conciseInternalLogs.length > 0 ? conciseInternalLogs : ['(no download-relevant internal logs)'])
            ];
            const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = `instagram-video-controller-log-${Date.now()}.txt`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => {
                try {
                    URL.revokeObjectURL(blobUrl);
                } catch (_error) {
                }
            }, 30000);
        } catch (_error) {
        }
    }

    async function buildDownloadDebugLines() {
        const lines = [];
        const targetVideo = getDownloadTargetVideo();
        const allVideos = getVideos();
        const videoSnapshots = allVideos.map((video, index) => describeVideoDebug(video, index));

        lines.push(`pageVideoCount=${allVideos.length}`);
        lines.push(`targetVideoIndex=${targetVideo instanceof HTMLVideoElement ? allVideos.indexOf(targetVideo) : -1}`);
        lines.push(`targetVideoIdentity=${targetVideo instanceof HTMLVideoElement ? getVideoIdentity(targetVideo) : ''}`);
        lines.push(`targetVideoHint=${targetVideo instanceof HTMLVideoElement ? JSON.stringify(buildVideoMediaHint(targetVideo)) : '{}'}`);

        if (targetVideo instanceof HTMLVideoElement) {
            const hint = buildVideoMediaHint(targetVideo);
            const trackedMedia = await getTrackedMediaUrlsForBlob(targetVideo.currentSrc || targetVideo.src || '');
            const focusedEntries = focusTrackedMediaEntries(trackedMedia.entries || [], hint);
            lines.push(`targetTrackedMediaSourceId=${trackedMedia.mediaSourceId || ''}`);
            lines.push(`targetTrackedUrlCount=${trackedMedia.urls.length}`);
            lines.push(`targetTrackedEntryCount=${Array.isArray(trackedMedia.entries) ? trackedMedia.entries.length : 0}`);
            lines.push(`targetFocusedEntryCount=${focusedEntries.length}`);
            lines.push(`targetFocusedAssetKey=${focusedEntries[0] && focusedEntries[0].assetKey ? focusedEntries[0].assetKey : ''}`);
            lines.push(`targetTrackedAppendCount=${trackedMedia.debug && trackedMedia.debug.appendCount || 0}`);
            lines.push(`targetTrackedMatchCount=${trackedMedia.debug && trackedMedia.debug.trackedCount || 0}`);
            lines.push(`targetTrackedHeuristicCount=${trackedMedia.debug && trackedMedia.debug.heuristicCount || 0}`);
            lines.push(`targetTrackedLastUrl=${shortenUrlForLog(trackedMedia.debug && trackedMedia.debug.lastUrl || '')}`);
            summarizeTrackedMediaGroups(trackedMedia.entries || trackedMedia.urls).slice(0, 6).forEach((summary, index) => {
                lines.push(`targetTrackedGroup[${index}]=${summary}`);
            });
            summarizeTrackedMediaGroups(focusedEntries).slice(0, 3).forEach((summary, index) => {
                lines.push(`targetFocusedGroup[${index}]=${summary}`);
            });
        }

        lines.push(`lockedBundleVideoUrl=${lockedSideBoxBundle && lockedSideBoxBundle.video ? shortenUrlForLog(lockedSideBoxBundle.video.url || '') : ''}`);
        lines.push(`lockedBundleAudioUrl=${lockedSideBoxBundle && lockedSideBoxBundle.audio ? shortenUrlForLog(lockedSideBoxBundle.audio.url || '') : ''}`);
        lines.push(`lockedBundleVideoAssetId=${lockedSideBoxBundle && lockedSideBoxBundle.video ? lockedSideBoxBundle.video.assetId || '' : ''}`);
        lines.push(`lockedBundleVideoDuration=${lockedSideBoxBundle && lockedSideBoxBundle.video ? Number(lockedSideBoxBundle.video.duration || 0) : 0}`);

        lines.push('--- page videos ---');
        videoSnapshots.forEach(snapshot => {
            lines.push(snapshot);
        });

        return lines;
    }

    function describeVideoDebug(video, index) {
        if (!(video instanceof HTMLVideoElement)) {
            return `[${index}] invalid-video`;
        }

        const rect = video.getBoundingClientRect();
        const currentSrc = video.currentSrc || '';
        const src = video.src || '';
        const identity = getVideoIdentity(video);
        const flags = [
            video === activeVideo ? 'active' : '',
            video === sideBoxVideo ? 'sidebox' : '',
            isVisibleVideo(video) ? 'visible' : 'hidden',
            video.paused ? 'paused' : 'playing'
        ].filter(Boolean).join(',');

        return [
            `[${index}]`,
            `flags=${flags}`,
            `identity=${identity}`,
            `duration=${Number(video.duration || 0).toFixed(3)}`,
            `currentTime=${Number(video.currentTime || 0).toFixed(3)}`,
            `size=${Math.round(rect.width)}x${Math.round(rect.height)}`,
            `rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.right)},${Math.round(rect.bottom)}`,
            `currentSrc=${shortenUrlForLog(currentSrc)}`,
            `src=${shortenUrlForLog(src)}`
        ].join(' | ');
    }

    function summarizeTrackedMediaGroups(items) {
        const groups = new Map();

        for (const item of items || []) {
            const candidate = buildDebugMediaCandidate(item);
            if (!candidate) continue;
            const key = candidate.assetId || candidate.url;
            if (!groups.has(key)) {
                groups.set(key, {
                    assetId: candidate.assetId || 'no-asset',
                    durations: new Set(),
                    videoCount: 0,
                    audioCount: 0,
                    maxRange: 0
                });
            }
            const group = groups.get(key);
            if (candidate.duration > 0) {
                group.durations.add(candidate.duration.toFixed(3));
            }
            if (candidate.isAudio) {
                group.audioCount += 1;
            } else if (candidate.isVideo) {
                group.videoCount += 1;
            }
            group.maxRange = Math.max(group.maxRange, candidate.rangeLength);
        }

        return Array.from(groups.values()).map(group =>
            `asset=${group.assetId} durations=${Array.from(group.durations).join('/')} video=${group.videoCount} audio=${group.audioCount} maxRange=${group.maxRange}`
        );
    }

    function buildDebugMediaCandidate(item) {
        const url = typeof item === 'string' ? item : item && item.url;
        if (!url || !/\.mp4($|\?)/i.test(url)) return null;
        try {
            const parsed = new URL(url);
            const meta = parseDebugEfgPayload(parsed.searchParams.get('efg'));
            const tag = String(meta.vencode_tag || '').toLowerCase();
            const duration = Number(meta.duration_s || 0);
            const byteStart = Number(parsed.searchParams.get('bytestart') || -1);
            const byteEnd = Number(parsed.searchParams.get('byteend') || -1);
            return {
                url,
                assetId: meta.xpv_asset_id || '',
                duration,
                isAudio: /audio/.test(tag),
                isVideo: /vp9|avc|h264|basic|dash/.test(tag) && !/audio/.test(tag),
                rangeLength: byteStart >= 0 && byteEnd >= byteStart ? byteEnd - byteStart : 0,
                capturedAt: item && typeof item === 'object' && Number.isFinite(item.at) ? Number(item.at) : 0
            };
        } catch (_error) {
            return null;
        }
    }

    function focusTrackedMediaEntries(entries, hint) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return [];
        }

        const targetCapturedAt = Number(hint && hint.targetCapturedAt) || 0;
        const targetDuration = Number(hint && hint.duration) || 0;
        const decorated = entries
            .map((entry, index) => ({
                entry,
                index,
                candidate: buildDebugMediaCandidate(entry)
            }))
            .filter(item => item.candidate);

        if (decorated.length === 0) {
            return [];
        }

        const tail = decorated.slice(-16);
        const tailVideos = tail.filter(item => item.candidate.isVideo);
        const orderedVideos = tailVideos.sort((left, right) =>
            compareFocusedTrackedCandidates(left, right, targetDuration, targetCapturedAt)
        );
        const anchor = orderedVideos[0] || tail[tail.length - 1];

        if (!anchor) {
            return [];
        }

        const assetKey = anchor.candidate.assetId || anchor.entry.assetKey || '';
        if (!assetKey) {
            return [anchor.entry];
        }

        return decorated
            .filter(item => (item.candidate.assetId || item.entry.assetKey || '') === assetKey)
            .map(item => item.entry);
    }

    function compareFocusedTrackedCandidates(left, right, targetDuration, targetCapturedAt) {
        const leftDurationDelta = targetDuration > 0 ? Math.abs(Number(left.candidate.duration || 0) - targetDuration) : Number.POSITIVE_INFINITY;
        const rightDurationDelta = targetDuration > 0 ? Math.abs(Number(right.candidate.duration || 0) - targetDuration) : Number.POSITIVE_INFINITY;
        const leftDurationBucket = leftDurationDelta <= 0.35 ? 0 : leftDurationDelta <= 1 ? 1 : 2;
        const rightDurationBucket = rightDurationDelta <= 0.35 ? 0 : rightDurationDelta <= 1 ? 1 : 2;
        if (leftDurationBucket !== rightDurationBucket) {
            return leftDurationBucket - rightDurationBucket;
        }
        if (leftDurationDelta !== rightDurationDelta) {
            return leftDurationDelta - rightDurationDelta;
        }

        if (targetCapturedAt > 0) {
            const leftBefore = Number(left.entry && left.entry.at) <= targetCapturedAt ? 1 : 0;
            const rightBefore = Number(right.entry && right.entry.at) <= targetCapturedAt ? 1 : 0;
            if (leftBefore !== rightBefore) {
                return rightBefore - leftBefore;
            }
            const leftTimeDelta = Math.abs(Number(left.entry && left.entry.at) - targetCapturedAt);
            const rightTimeDelta = Math.abs(Number(right.entry && right.entry.at) - targetCapturedAt);
            if (leftTimeDelta !== rightTimeDelta) {
                return leftTimeDelta - rightTimeDelta;
            }
        }

        const leftRange = Number(left.entry && left.entry.rangeLength) || 0;
        const rightRange = Number(right.entry && right.entry.rangeLength) || 0;
        if (leftRange !== rightRange) {
            return rightRange - leftRange;
        }

        return right.index - left.index;
    }

    function parseDebugEfgPayload(rawValue) {
        if (!rawValue) return {};
        try {
            return JSON.parse(atob(rawValue));
        } catch (_error) {
            try {
                return JSON.parse(atob(decodeURIComponent(rawValue)));
            } catch (_nestedError) {
                return {};
            }
        }
    }

    function ensurePageDownloadBridge() {
        if (document.getElementById('instagram-video-controller-download-bridge')) return;

        const script = document.createElement('script');
        script.id = 'instagram-video-controller-download-bridge';
        script.src = chrome.runtime.getURL('page-download-bridge.js');
        document.documentElement.appendChild(script);
    }

    function getTrackedMediaUrlsForBlob(blobUrl) {
        return new Promise(resolve => {
            if (!blobUrl || !blobUrl.startsWith('blob:')) {
                resolve({ blobUrl, urls: [], mediaSourceId: '' });
                return;
            }

            const requestId = `media-map-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            let settled = false;

            const finish = detail => {
                if (settled) return;
                settled = true;
                document.removeEventListener(MEDIA_TRACKER_RESPONSE_EVENT, onResponse, true);
                resolve(detail || { blobUrl, urls: [], mediaSourceId: '' });
            };

            const onResponse = event => {
                const detail = event && event.detail ? event.detail : {};
                if (detail.requestId !== requestId) return;
                finish(detail);
            };

            document.addEventListener(MEDIA_TRACKER_RESPONSE_EVENT, onResponse, true);
            document.dispatchEvent(new CustomEvent(MEDIA_TRACKER_REQUEST_EVENT, {
                detail: { requestId, blobUrl }
            }));

            window.setTimeout(() => finish({ blobUrl, urls: [], entries: [], mediaSourceId: '' }), 1500);
        });
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
        if (pendingSideBoxVideo && document.contains(pendingSideBoxVideo) && isVisibleVideo(pendingSideBoxVideo)) {
            return pendingSideBoxVideo;
        }

        if (sideBoxVideo && document.contains(sideBoxVideo) && isVisibleVideo(sideBoxVideo)) {
            return sideBoxVideo;
        }

        const videos = getVideos();
        const eligibleVideos = videos.filter(isEligibleVideo);
        const playing = eligibleVideos.find(video => !video.paused && !video.ended);
        if (playing) return playing;

        if (eligibleVideos.length > 0) {
            return eligibleVideos
                .sort((a, b) => {
                    const areaDiff = getVisibleArea(b) - getVisibleArea(a);
                    if (areaDiff !== 0) return areaDiff;

                    const centerA = getVideoCenterDistance(a);
                    const centerB = getVideoCenterDistance(b);
                    if (centerA !== centerB) return centerA - centerB;

                    return getDomDepth(b) - getDomDepth(a);
                })[0] || null;
        }

        if (isPostPage()) {
            return null;
        }

        return videos[0] || null;
    }

    function getVideoCenterDistance(video) {
        const rect = video.getBoundingClientRect();
        const centerX = rect.left + (rect.width / 2);
        const centerY = rect.top + (rect.height / 2);
        const viewportCenterX = window.innerWidth / 2;
        const viewportCenterY = window.innerHeight / 2;
        return Math.abs(centerX - viewportCenterX) + Math.abs(centerY - viewportCenterY);
    }

    function getDomDepth(element) {
        let depth = 0;
        let current = element;
        while (current && current.parentElement) {
            depth += 1;
            current = current.parentElement;
        }
        return depth;
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
        mediaHintStartedAt = Date.now();
        mediaHintStartedAtByVideo.set(video, mediaHintStartedAt);
        video.playbackRate = options.playbackRateV;
        applyVideoContainerStyle(video);
        applyStandalonePostLayoutStyle(video);
        hideReelPageVideoNextSibling(video);

        if (video.dataset.instagramVideoControllerProcessed === 'true') return;

        video.dataset.instagramVideoControllerProcessed = 'true';
        video.addEventListener('play', () => {
            const lastInternalPlayAt = Number(internalPlayRequestAtByVideo.get(video) || '0');
            const recentUserInteraction = Date.now() - userInteractionAt < 1200;
            if (manualPauseByVideo.get(video) && Date.now() - lastInternalPlayAt > 1200 && !recentUserInteraction) {
                log('blocking forced resume after manual pause', describeVideo(video));
                window.setTimeout(() => {
                    if (!video.paused) {
                        video.pause();
                    }
                }, 0);
                return;
            }
            manualPauseByVideo.set(video, false);
            if (isVisibleVideo(video) || video === sideBoxVideo) {
                activeVideo = video;
            }
            mediaHintStartedAt = Date.now();
            mediaHintStartedAtByVideo.set(video, mediaHintStartedAt);
            applySettingsToVideo(video);
            schedulePinCapturedMedia(video, 800);
            updatePanel();
        });

        video.addEventListener('loadeddata', () => {
            if (video === activeVideo || video === sideBoxVideo) {
                mediaHintStartedAt = Date.now();
                mediaHintStartedAtByVideo.set(video, mediaHintStartedAt);
                schedulePinCapturedMedia(video, 1200);
            }
        });

        video.addEventListener('click', () => {
            userInteractionAt = Date.now();
            scheduleRestoreInfoAfterInteraction(video);
        }, true);

        video.addEventListener('dblclick', () => {
            userInteractionAt = Date.now();
            scheduleRestoreInfoAfterInteraction(video);
        }, true);

        video.addEventListener('pointerup', () => {
            userInteractionAt = Date.now();
            scheduleRestoreInfoAfterInteraction(video);
        }, true);

        video.addEventListener('pause', () => {
            const lastInternalPlayAt = Number(internalPlayRequestAtByVideo.get(video) || '0');
            const recentUserInteraction = Date.now() - userInteractionAt < 1200;
            if (recentUserInteraction || Date.now() - lastInternalPlayAt > 1200) {
                manualPauseByVideo.set(video, true);
                log('manual pause remembered', describeVideo(video));
            }
        });

        video.addEventListener('volumechange', () => {
            if (applyingVolume || applyingMute) return;

            const needsRestore =
                Math.abs(video.volume - options.volumeSliderV) > 0.01 ||
                video.muted !== options.volumeMute;

            if (needsRestore) {
                applyingVolume = true;
                applyingMute = true;
                video.volume = options.volumeSliderV;
                video.muted = options.volumeMute;
                window.setTimeout(() => {
                    applyingVolume = false;
                    applyingMute = false;
                }, 0);
            }
            updatePanel();
        });

        log('processed video', video);
    }

    function processVideos() {
        updateFloatingLogButton();

        if (!isSupportedPage()) {
            activeVideo = null;
            cleanupSideBox();
            hideSideBoxRestoreButton();
            removeFloatingLogButton();
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

    function setDownloadButtonState(label, disabled, title = '') {
        if (!downloadButtonEl) return;
        downloadButtonEl.textContent = label;
        downloadButtonEl.disabled = disabled;
        downloadButtonEl.title = title || downloadButtonEl.title;
        downloadButtonEl.style.opacity = disabled ? '0.72' : '1';
        downloadButtonEl.style.cursor = disabled ? 'default' : 'pointer';
    }

    function scheduleDownloadButtonReset(delay = 2200) {
        if (downloadButtonResetTimer) {
            clearTimeout(downloadButtonResetTimer);
        }
        downloadButtonResetTimer = window.setTimeout(() => {
            downloadButtonResetTimer = null;
            setDownloadButtonState(
                t('buttonDownloadVideo', 'Download video'),
                false,
                t('tooltipDownloadVideo', 'Download the active video')
            );
        }, delay);
    }

    function ensureMovedInfoStash() {
        if (movedInfoStash && document.contains(movedInfoStash)) {
            return movedInfoStash;
        }

        movedInfoStash = document.createElement('div');
        movedInfoStash.id = 'instagram-video-controller-info-stash';
        movedInfoStash.style.cssText = 'display:none !important;';
        document.documentElement.appendChild(movedInfoStash);
        return movedInfoStash;
    }

    function getDownloadTargetVideo() {
        if (sideBoxVideo && document.contains(sideBoxVideo) && isVisibleVideo(sideBoxVideo)) {
            return sideBoxVideo;
        }

        if (activeVideo && document.contains(activeVideo) && isVisibleVideo(activeVideo)) {
            return activeVideo;
        }

        return pickActiveVideo();
    }

    function buildVideoMediaHint(video) {
        const startedAt = mediaHintStartedAtByVideo.get(video) || mediaHintStartedAt || 0;
        const sideboxTime = isCurrentSideBoxVideoIdentity(video) && sideBoxCreatedAt > 0 ? sideBoxCreatedAt : 0;
        let targetTime = startedAt > 0 ? startedAt : sideboxTime;

        if (startedAt > 0 && sideboxTime > 0 && Math.abs(startedAt - sideboxTime) <= 3000) {
            targetTime = sideboxTime;
        }

        const hint = {
            duration: Number(video && video.duration) || 0,
            currentTime: Number(video && video.currentTime) || 0,
            capturedAfter: targetTime > 0 ? Math.max(0, targetTime - 4000) : 0
        };

        if (targetTime > 0) {
            hint.capturedBefore = targetTime + 1200;
            hint.targetCapturedAt = targetTime;
            hint.preferBefore = true;
        }

        if (hint.capturedBefore > 0 && hint.capturedAfter > hint.capturedBefore) {
            hint.capturedAfter = Math.max(0, hint.capturedBefore - 4000);
        }

        return hint;
    }

    function isBundleDurationCompatible(video, bundle, tolerance = 0.35) {
        if (!(video instanceof HTMLVideoElement) || !bundle || !bundle.video) {
            return false;
        }

        const videoDuration = Number(video.duration || 0);
        const bundleDuration = Number(bundle.video.duration || 0);

        if (!(videoDuration > 0) || !(bundleDuration > 0)) {
            return true;
        }

        return Math.abs(videoDuration - bundleDuration) <= tolerance;
    }

    function getVideoIdentity(video) {
        if (!(video instanceof HTMLVideoElement)) return '';
        return `${video.currentSrc || video.src || ''}::${Number(video.duration || 0).toFixed(3)}`;
    }

    function isCurrentSideBoxVideoIdentity(video) {
        return video instanceof HTMLVideoElement &&
            video === sideBoxVideo &&
            !!sideBoxVideoIdentity &&
            getVideoIdentity(video) === sideBoxVideoIdentity;
    }

    function shouldReplaceCapturedBundle(video, nextBundle) {
        if (!(video instanceof HTMLVideoElement)) return true;
        if (!nextBundle || !nextBundle.video) return false;

        const existingBundle = capturedMediaBundleByVideo.get(video);
        if (!existingBundle || !existingBundle.video) return true;

        const videoDuration = Number(video.duration || 0);
        const existingDelta = videoDuration > 0 ? Math.abs(Number(existingBundle.video.duration || 0) - videoDuration) : 0;
        const nextDelta = videoDuration > 0 ? Math.abs(Number(nextBundle.video.duration || 0) - videoDuration) : 0;

        if (existingDelta <= 0.35 && nextDelta > 0.35) {
            log('skipping bundle replacement due to worse duration match', {
                video: describeVideo(video),
                existing: existingBundle.video,
                next: nextBundle.video
            });
            return false;
        }

        return true;
    }

    function pinCapturedMediaForVideo(video) {
        if (!(video instanceof HTMLVideoElement)) {
            return Promise.resolve({ ok: false, error: 'invalid target video' });
        }

        try {
            const hint = buildVideoMediaHint(video);
            return new Promise(resolve => {
                chrome.runtime.sendMessage({ pinCapturedVideo: true, hint }, response => {
                    if (chrome.runtime.lastError) {
                        const failure = {
                            ok: false,
                            error: chrome.runtime.lastError.message
                        };
                        log('pin captured media failed', failure);
                        resolve(failure);
                        return;
                    }
                    if (response && response.ok && response.bundle && !isBundleDurationCompatible(video, response.bundle)) {
                        const failure = {
                            ok: false,
                            error: 'bundle duration mismatch',
                            expectedDuration: Number(video.duration || 0),
                            actualDuration: Number(response.bundle.video && response.bundle.video.duration || 0),
                            bundle: response.bundle
                        };
                        lastRejectedBundleInfo = {
                            expectedDuration: failure.expectedDuration,
                            actualDuration: failure.actualDuration,
                            assetId: response.bundle.video && response.bundle.video.assetId || '',
                            tag: response.bundle.video && response.bundle.video.tag || ''
                        };
                        log('rejecting pinned media due to duration mismatch', {
                            video: describeVideo(video),
                            failure
                        });
                        resolve(failure);
                        return;
                    }
                    if (response && response.ok && response.bundle && shouldReplaceCapturedBundle(video, response.bundle)) {
                        capturedMediaBundleByVideo.set(video, response.bundle);
                        mediaIdentityByVideo.set(video, getVideoIdentity(video));
                        if (isCurrentSideBoxVideoIdentity(video) && !lockedSideBoxBundle) {
                            lockedSideBoxBundle = response.bundle;
                            lockedSideBoxIdentity = sideBoxVideoIdentity;
                        }
                    }
                    log('pinned captured media', response);
                    resolve(response || { ok: false, error: 'empty pin response' });
                });
            });
        } catch (error) {
            log('pin captured media exception', error);
            return Promise.resolve({ ok: false, error: String(error && error.message || error) });
        }
    }

    function pinCapturedMediaForCurrentTarget() {
        const targetVideo = getDownloadTargetVideo();
        if (!(targetVideo instanceof HTMLVideoElement)) return;
        pinCapturedMediaForVideo(targetVideo);
    }

    function schedulePinCapturedMedia(video = null, delay = 900) {
        if (pinMediaTimer) {
            clearTimeout(pinMediaTimer);
        }

        pinMediaTimer = window.setTimeout(() => {
            pinMediaTimer = null;
            const targetVideo = video instanceof HTMLVideoElement ? video : getDownloadTargetVideo();
            if (targetVideo instanceof HTMLVideoElement) {
                pinCapturedMediaForVideo(targetVideo);
            }
        }, delay);
    }

    async function downloadActiveVideo() {
        const targetVideo = getDownloadTargetVideo();
        if (!targetVideo) return;

        activeVideo = targetVideo;
        setDownloadButtonState('Downloading...', true, 'Downloading current video');

        const diagnostics = getVideoDownloadDiagnostics(targetVideo);
        log('video download diagnostics', diagnostics);

        const sourceUrl = diagnostics.primaryUrl;
        if (!sourceUrl) return;

        try {
            if (diagnostics.guessedType === 'blob') {
                const trackedMedia = await getTrackedMediaUrlsForBlob(sourceUrl);
                const hint = buildVideoMediaHint(targetVideo);
                const focusedEntries = focusTrackedMediaEntries(trackedMedia.entries || [], hint);
                const downloadEntries = focusedEntries.length > 0
                    ? focusedEntries
                    : (trackedMedia.entries || []);
                const downloadUrls = downloadEntries
                    .map(entry => typeof entry === 'string' ? entry : entry && entry.url)
                    .filter(Boolean);
                log('tracked blob media urls', {
                    blobUrl: sourceUrl,
                    mediaSourceId: trackedMedia.mediaSourceId,
                    urlCount: trackedMedia.urls.length,
                    focusedUrlCount: downloadUrls.length,
                    focusedAssetKey: focusedEntries[0] && focusedEntries[0].assetKey ? focusedEntries[0].assetKey : '',
                    debug: trackedMedia.debug || {},
                    urls: downloadUrls
                });

                if (downloadUrls.length > 0) {
                    const trackedResponse = await chrome.runtime.sendMessage({
                        downloadTrackedBlobUrls: {
                            entries: downloadEntries,
                            urls: downloadUrls,
                            hint,
                            filename: getDownloadFileName(sourceUrl)
                        }
                    });
                    if (trackedResponse && trackedResponse.ok) {
                        log('tracked blob media download started', trackedResponse);
                        if (trackedResponse.mergeStarted) {
                            setDownloadButtonState('Merging...', true, 'Merging audio and video in a background tab');
                            scheduleDownloadButtonReset(5000);
                        } else {
                            setDownloadButtonState('Started', true, 'Download started');
                            scheduleDownloadButtonReset(1800);
                        }
                        return;
                    }
                    log('tracked blob media download failed', trackedResponse);
                }

                const currentIdentity = getVideoIdentity(targetVideo);
                const cachedIdentity = mediaIdentityByVideo.get(targetVideo) || '';
                const sideboxIdentityMatches = targetVideo !== sideBoxVideo || (
                    !!sideBoxVideoIdentity &&
                    currentIdentity === sideBoxVideoIdentity &&
                    lockedSideBoxIdentity === sideBoxVideoIdentity
                );
                const directBundle = targetVideo === sideBoxVideo &&
                    lockedSideBoxBundle &&
                    sideboxIdentityMatches
                    ? lockedSideBoxBundle
                    : capturedMediaBundleByVideo.get(targetVideo);
                if (directBundle && directBundle.video && directBundle.video.url &&
                    (targetVideo === sideBoxVideo || currentIdentity === cachedIdentity)) {
                    const explicitResponse = await chrome.runtime.sendMessage({
                        downloadMediaBundle: {
                            bundle: directBundle,
                            filename: getDownloadFileName(sourceUrl)
                        }
                    });
                    if (explicitResponse && explicitResponse.ok) {
                        log('explicit media bundle download started', explicitResponse);
                        if (explicitResponse.mergeStarted) {
                            setDownloadButtonState('Merging...', true, 'Merging audio and video in a background tab');
                            scheduleDownloadButtonReset(5000);
                        } else {
                            setDownloadButtonState('Started', true, 'Download started');
                            scheduleDownloadButtonReset(1800);
                        }
                        return;
                    }
                    log('explicit media bundle download failed', explicitResponse);
                }

                if (targetVideo === sideBoxVideo && !sideboxIdentityMatches) {
                    log('skipping stale locked sidebox bundle', {
                        currentIdentity,
                        sideBoxVideoIdentity,
                        lockedSideBoxIdentity
                    });
                }

                const capturedResponse = targetVideo === sideBoxVideo && lockedSideBoxBundle
                    ? { ok: false, error: sideboxIdentityMatches ? 'locked sidebox bundle download failed' : 'stale sidebox identity' }
                    : await downloadCapturedVideoWithRetry(targetVideo);
                if (capturedResponse && capturedResponse.ok) {
                    log('captured media download started', capturedResponse);
                    if (capturedResponse.mergeStarted) {
                        setDownloadButtonState('Merging...', true, 'Merging audio and video in a background tab');
                        scheduleDownloadButtonReset(5000);
                    } else {
                        setDownloadButtonState('Started', true, 'Download started');
                        scheduleDownloadButtonReset(1800);
                    }
                    return;
                }

                const performanceUrl = targetVideo === sideBoxVideo ? '' : findPerformanceVideoUrl(targetVideo);
                if (performanceUrl) {
                    const response = await chrome.runtime.sendMessage({
                        downloadVideo: {
                            url: performanceUrl,
                            filename: getDownloadFileName(performanceUrl)
                        }
                    });
                    if (response && response.ok) {
                        log('performance video download started', {
                            url: performanceUrl,
                            downloadId: response.downloadId
                        });
                        setDownloadButtonState('Started', true, 'Download started');
                        scheduleDownloadButtonReset(1800);
                        return;
                    }
                }

                throw new Error(capturedResponse && capturedResponse.error
                    ? capturedResponse.error
                    : 'no matching media request for current sidebox video');
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
            setDownloadButtonState('Started', true, 'Download started');
            scheduleDownloadButtonReset(1800);
        } catch (error) {
            log('video download fallback', error);
            const errorMessage = String(error && error.message || error);
            if (errorMessage.includes('Extension context invalidated')) {
                setDownloadButtonState('Reload page', true, 'Extension was updated. Reload the Instagram page and try again.');
                scheduleDownloadButtonReset(5000);
                return;
            }
            setDownloadButtonState('Failed', true, errorMessage);
            scheduleDownloadButtonReset(2800);
            if (diagnostics.guessedType !== 'blob') {
                window.open(sourceUrl, '_blank', 'noopener,noreferrer');
            }
        }
    }

    function findPerformanceVideoUrl(video) {
        if (!window.performance || !window.performance.getEntriesByType) return '';

        const hintDuration = Number(video && video.duration) || 0;
        const entries = window.performance.getEntriesByType('resource')
            .filter(entry =>
                typeof entry.name === 'string' &&
                /\.mp4($|\?)/i.test(entry.name)
            )
            .map(entry => ({
                name: entry.name,
                startTime: Number(entry.startTime) || 0,
                durationHint: extractDurationHintFromUrl(entry.name),
                meta: extractMediaMetaFromUrl(entry.name)
            }));

        const filtered = hintDuration > 0
            ? entries.filter(entry =>
                entry.durationHint > 0 &&
                Math.abs(entry.durationHint - hintDuration) <= 0.35
            )
            : entries;

        const pool = filtered.length > 0 ? filtered : entries;
        const videoOnly = pool.filter(entry => !entry.meta.isAudio);
        const candidate = (videoOnly.length > 0 ? videoOnly : pool)
            .sort((a, b) => {
                if (b.startTime !== a.startTime) return b.startTime - a.startTime;
                return Number(b.meta.bitrate || 0) - Number(a.meta.bitrate || 0);
            })[0];

        return candidate ? stripByteRangeFromUrl(candidate.name) : '';
    }

    function extractMediaMetaFromUrl(url) {
        try {
            const parsed = new URL(url);
            const efg = parsed.searchParams.get('efg');
            if (!efg) return { isAudio: false, bitrate: 0 };
            const decoded = JSON.parse(atob(efg));
            const tag = String(decoded.vencode_tag || '').toLowerCase();
            return {
                isAudio: /audio/.test(tag),
                bitrate: Number(decoded.bitrate || 0)
            };
        } catch (error) {
            return { isAudio: false, bitrate: 0 };
        }
    }

    function extractDurationHintFromUrl(url) {
        try {
            const parsed = new URL(url);
            const efg = parsed.searchParams.get('efg');
            if (!efg) return 0;
            const decoded = JSON.parse(atob(efg));
            return Number(decoded.duration_s || 0);
        } catch (error) {
            return 0;
        }
    }

    function stripByteRangeFromUrl(url) {
        try {
            const parsed = new URL(url);
            parsed.searchParams.delete('bytestart');
            parsed.searchParams.delete('byteend');
            return parsed.toString();
        } catch (error) {
            return url;
        }
    }

    async function downloadCapturedVideoWithRetry(video) {
        const delays = [0, 800, 1500];

        for (const delay of delays) {
            if (delay > 0) {
                await wait(delay);
            }

            const pinResponse = await pinCapturedMediaForVideo(video);
            log('pin captured media before download', pinResponse);

            if (!pinResponse || !pinResponse.ok || !pinResponse.bundle) {
                continue;
            }

            const response = await chrome.runtime.sendMessage({
                downloadMediaBundle: {
                    bundle: pinResponse.bundle,
                    filename: getDownloadFileName(video.currentSrc || video.src || '')
                }
            });
            if (response && response.ok) {
                return response;
            }
        }

        return {
            ok: false,
            error: 'no captured media request'
        };
    }

    function wait(ms) {
        return new Promise(resolve => {
            window.setTimeout(resolve, ms);
        });
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
        const descriptiveName = buildDescriptiveVideoFileName();
        if (descriptiveName) {
            return descriptiveName;
        }

        try {
            const shortcode = sanitizeFileNamePart(getCurrentShortcode()) || 'instagram';
            return `${shortcode}.mp4`;
        } catch (error) {
            const shortcode = sanitizeFileNamePart(getCurrentShortcode()) || 'instagram-video';
            return `${shortcode}.mp4`;
        }
    }

    function buildDescriptiveVideoFileName() {
        const publisher = sanitizeFileNamePart(getPublisherNameForDownload()) || 'instagram';
        const snippet = sanitizeFileNamePart(getInfoSnippetForDownload());
        const shortcode = sanitizeFileNamePart(getCurrentShortcode());
        const parts = [publisher];
        if (shortcode) {
            parts.push(shortcode);
        }
        if (snippet && snippet !== publisher && snippet !== shortcode) {
            parts.push(snippet);
        }
        if (parts.length === 1) {
            parts.push('video');
        }
        return `${parts.join('_')}.mp4`;
    }

    function getPublisherNameForDownload() {
        const roots = [];
        if (sideBoxInfo && document.contains(sideBoxInfo)) {
            roots.push(sideBoxInfo);
        }
        if (sideBox && document.contains(sideBox)) {
            roots.push(sideBox);
        }
        if (activeVideo && document.contains(activeVideo)) {
            const overlay = getVideoOverlay(activeVideo);
            if (overlay) roots.push(overlay);
        }

        for (const root of roots) {
            const link = root.querySelector('a[href^="/"][role="link"], a[href^="/"]');
            const text = normalizeText(link && link.textContent);
            if (text) return text;
        }

        return '';
    }

    function getInfoSnippetForDownload() {
        const publisher = normalizeText(getPublisherNameForDownload());
        const roots = [];
        if (sideBoxInfo && document.contains(sideBoxInfo)) {
            roots.push(sideBoxInfo);
        }
        if (sideBox && document.contains(sideBox)) {
            roots.push(sideBox);
        }

        for (const root of roots) {
            const chunks = collectMeaningfulTextChunks(root);
            for (const chunk of chunks) {
                const normalized = normalizeText(chunk);
                if (!normalized) continue;
                if (publisher && normalized === publisher) continue;
                if (publisher && normalized.startsWith(`${publisher} `)) continue;
                const compact = Array.from(normalized).slice(0, 12).join('');
                if (compact) return compact;
            }
        }

        return '';
    }

    function collectMeaningfulTextChunks(root) {
        if (!(root instanceof Element)) return [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const chunks = [];

        while (walker.nextNode()) {
            const textNode = walker.currentNode;
            const parent = textNode.parentElement;
            if (!parent) continue;
            if (parent.closest('button, svg, script, style')) continue;
            if (parent.closest('#instagram-video-controller-panel, #instagram-video-controller-side-controls')) continue;
            const text = normalizeText(textNode.textContent);
            if (!text || text.length < 2) continue;
            chunks.push(text);
        }

        return chunks;
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function sanitizeFileNamePart(value) {
        return normalizeText(value)
            .replace(/[\\/:*?"<>|]/g, '')
            .replace(/[.]+$/g, '')
            .slice(0, 40);
    }

    function getCurrentShortcode() {
        try {
            const path = String(location.pathname || '');
            const match = path.match(/\/(?:reels?|p|stories)\/([^/?#]+)/i);
            return match ? match[1] : '';
        } catch (error) {
            return '';
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

        const row1Right = document.createElement('div');
        row1Right.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end;';

        const downloadButton = createButton(
            t('buttonDownloadVideo', 'Download video'),
            t('tooltipDownloadVideo', 'Download the active video'),
            downloadActiveVideo
        );
        downloadButtonEl = downloadButton;

        const saveLogButton = createButton(
            t('buttonSaveLog', 'Save log'),
            t('tooltipSaveLog', 'Save extension internal logs to a text file'),
            exportInternalLogs
        );

        row1.appendChild(row1Left);
        row1Right.appendChild(downloadButton);
        row1Right.appendChild(saveLogButton);
        row1.appendChild(row1Right);

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
        if (sideBoxVideo && sideBoxInfo) {
            const movedInfo = movedInfoByVideo.get(sideBoxVideo);
            if (movedInfo instanceof Element && sideBoxInfo.contains(movedInfo)) {
                ensureMovedInfoStash().appendChild(movedInfo);
                log('preserved moved info before sidebox cleanup', {
                    video: describeVideo(sideBoxVideo),
                    info: describeElement(movedInfo)
                });
            }
        }

        if (sideBoxVideo) {
            const hiddenWrapper = hiddenWideInfoWrapperByVideo.get(sideBoxVideo);
            if (hiddenWrapper instanceof Element) {
                hiddenWrapper.style.removeProperty('display');
                hiddenWrapper.style.removeProperty('visibility');
                hiddenWrapper.style.removeProperty('pointer-events');
                hiddenWideInfoWrapperByVideo.delete(sideBoxVideo);
            }
        }

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

        lockedSideBoxBundle = null;
        lockedSideBoxIdentity = '';
        sideBoxVideoIdentity = '';
        sideBoxCreatedAt = 0;
        lastRejectedBundleInfo = null;

        donatePrompt = null;
    }

    function hideSideBoxRestoreButton() {
        if (!sideBoxRestoreButton) return;
        sideBoxRestoreButton.remove();
        sideBoxRestoreButton = null;
    }

    function removeFloatingLogButton() {
        if (!floatingLogButton) return;
        floatingLogButton.remove();
        floatingLogButton = null;
    }

    function updateFloatingLogButton() {
        if (!isSupportedPage()) {
            removeFloatingLogButton();
            return;
        }

        if (!floatingLogButton) {
            floatingLogButton = document.createElement('button');
            floatingLogButton.type = 'button';
            floatingLogButton.id = 'instagram-video-controller-save-log-floating';
            floatingLogButton.textContent = t('buttonSaveLog', 'Save log');
            floatingLogButton.title = t('tooltipSaveLog', 'Save extension internal logs to a text file');
            floatingLogButton.style.cssText = `
                position: fixed;
                left: 16px;
                bottom: 16px;
                z-index: 2147483647;
                min-width: 82px;
                height: 32px;
                border: 0;
                border-radius: 6px;
                background: rgba(18,18,18,0.96);
                color: #fff;
                cursor: pointer;
                font: 700 12px Arial, sans-serif;
                box-shadow: 0 6px 18px rgba(0,0,0,0.35);
                opacity: 0.92;
            `;
            floatingLogButton.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                exportInternalLogs();
            });
            document.documentElement.appendChild(floatingLogButton);
        }
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
        sideBoxVideoIdentity = getVideoIdentity(video);
        sideBoxCreatedAt = Date.now();
        lockedSideBoxBundle = null;
        lockedSideBoxIdentity = '';
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
        if (!moreButton) return;
        const lastClickAt = Number(moreButton.dataset.instagramVideoControllerClickedMoreAt || '0');
        if (Date.now() - lastClickAt < 400) return;

        moreButton.dataset.instagramVideoControllerClickedMoreAt = String(Date.now());
        moreButton.click();
        log('clicked more button', moreButton);
    }

    function clickMoreButtonForVideo(video) {
        const moreButton = findMoreButtonForVideo(video);
        if (!moreButton) return false;
        const lastClickAt = Number(moreButton.dataset.instagramVideoControllerClickedMoreAt || '0');
        if (Date.now() - lastClickAt < 400) return false;

        moreButton.dataset.instagramVideoControllerClickedMoreAt = String(Date.now());
        moreButton.click();
        if (video) {
            expandedInfoByVideo.add(video);
        }
        log('clicked more button for video', moreButton);
        return true;
    }

    function getFixedInfoElementForVideo(video) {
        if (!video) return null;

        if (isReelsPage()) {
            if (isWideReelsVideo(video)) {
                const wideInfoElement = getWideReelsInfoElement(video);
                if (wideInfoElement) {
                    return wideInfoElement;
                }
            }

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

    function getWideReelsInfoElement(video) {
        const seventhParent = getAncestor(video, 7);
        if (!(seventhParent instanceof Element)) {
            log('wide reels path missing ancestor', { level: 7, video: describeVideo(video) });
            return null;
        }

        const rawSibling = seventhParent.nextElementSibling;
        if (!(rawSibling instanceof Element)) {
            log('wide reels path missing next sibling', { seventhParent: describeElement(seventhParent) });
            return null;
        }

        const sibling = rawSibling;

        const targetChild = sibling.children.length >= 4
            ? sibling.children[3]
            : null;
        if (!(targetChild instanceof Element)) {
            const subtreeCandidate = findWideReelsInfoInSiblingSubtree(sibling);
            if (subtreeCandidate) {
                log('wide reels subtree fallback candidate', describeElement(subtreeCandidate));
                return subtreeCandidate;
            }
            log('wide reels path missing fourth child', {
                sibling: describeElement(sibling),
                childCount: sibling.children.length
            });
            return null;
        }

        const lastSibling = targetChild.parentElement && targetChild.parentElement.lastElementChild
            ? targetChild.parentElement.lastElementChild
            : null;
        if (!(lastSibling instanceof Element)) {
            log('wide reels path missing last sibling', {
                targetChild: describeElement(targetChild),
                siblingCount: targetChild.parentElement ? targetChild.parentElement.children.length : 0
            });
            return null;
        }

        const subtreeCandidate = findWideReelsInfoInSiblingSubtree(lastSibling);
        if (subtreeCandidate) {
            return subtreeCandidate;
        }

        return findWideReelsInfoInSiblingSubtree(sibling);
    }

    function findWideReelsInfoInSiblingSubtree(sibling) {
        if (!(sibling instanceof Element)) return null;

        const exactInfoRoot = sibling.querySelector('div.x78zum5.xdt5ytf.xr1yuqi.x6ikm8r.x10wlt62.xgpatz3');
        if (exactInfoRoot instanceof Element) {
            return exactInfoRoot;
        }

        const candidates = Array.from(sibling.querySelectorAll('div'))
            .filter(candidate =>
                !candidate.querySelector('video') &&
                candidate.querySelector('a[role="link"]') &&
                candidate.querySelector('[role="presentation"]') &&
                (
                    candidate.querySelector('[role="button"]') ||
                    findCollapsedMoreButton(candidate) ||
                    candidate.querySelector('.x1xmf6yo')
                )
            );

        candidates.sort((a, b) => getElementDepth(b) - getElementDepth(a));
        return candidates[0] || null;
    }

    function getElementDepth(element) {
        let depth = 0;
        let current = element;
        while (current && current.parentElement) {
            depth += 1;
            current = current.parentElement;
        }
        return depth;
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
        infoElement.style.width = 'auto';
        infoElement.style.maxWidth = 'none';
        infoElement.style.minWidth = '0';
        infoElement.style.overflow = 'visible';
        infoElement.style.pointerEvents = 'auto';
        infoElement.style.position = 'static';
        infoElement.style.inset = 'auto';
        infoElement.style.left = 'auto';
        infoElement.style.top = 'auto';
        infoElement.style.right = 'auto';
        infoElement.style.bottom = 'auto';
        infoElement.style.transform = 'none';
        infoElement.style.setProperty('color', '#fff', 'important');

        Array.from(infoElement.querySelectorAll('*')).forEach(child => {
            child.style.pointerEvents = 'auto';
            child.style.position = 'static';
            child.style.inset = 'auto';
            child.style.left = 'auto';
            child.style.top = 'auto';
            child.style.right = 'auto';
            child.style.bottom = 'auto';
            child.style.transform = 'none';
            child.style.setProperty('color', '#fff', 'important');
        });
    }

    function applyWhiteTextToInfoElement(infoElement) {
        if (!(infoElement instanceof Element)) return;

        infoElement.style.setProperty('color', '#fff', 'important');
        Array.from(infoElement.querySelectorAll('*')).forEach(child => {
            child.style.setProperty('color', '#fff', 'important');
        });
    }

    function installMovedInfoColorObserver(video, infoElement) {
        if (!(video instanceof HTMLVideoElement) || !(infoElement instanceof Element)) return;

        const existing = movedInfoColorObserverByVideo.get(video);
        if (existing) {
            existing.disconnect();
        }

        const observer = new MutationObserver(() => {
            applyWhiteTextToInfoElement(infoElement);
            ensureInfoElementExpanded(infoElement);
        });

        observer.observe(infoElement, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
        });

        movedInfoColorObserverByVideo.set(video, observer);
    }

    function isCollapsedMoreButton(button) {
        if (!(button instanceof Element)) return false;
        if (isStructureCollapsedMoreButton(button)) return true;

        const hiddenMore = button.querySelector('span[aria-hidden="true"]');
        if (hiddenMore && /(더 보기|more|see more)/i.test(hiddenMore.textContent || '')) {
            return true;
        }

        return /(더 보기|more|see more)/i.test(button.textContent || '');
    }

    function findCollapsedMoreButton(root) {
        if (!(root instanceof Element)) return null;
        return Array.from(root.querySelectorAll('[role="button"]')).find(isCollapsedMoreButton) || null;
    }

    function isStructureCollapsedMoreButton(button) {
        if (!(button instanceof Element)) return false;

        const wrapper = button.querySelector(':scope > .x1xmf6yo');
        if (!(wrapper instanceof Element)) return false;

        const directDiv = Array.from(wrapper.children).find(child =>
            child instanceof HTMLDivElement &&
            child.getAttribute('dir') === 'auto'
        );
        const directSpan = Array.from(wrapper.children).find(child =>
            child instanceof HTMLSpanElement &&
            child.getAttribute('dir') === 'auto'
        );

        return !!directDiv && !directSpan;
    }

    function hasMovedInfoForVideo(video) {
        const infoElement = movedInfoByVideo.get(video);
        return infoElement &&
            infoElement.dataset.instagramVideoControllerMovedInfo === 'true';
    }

    function isWideReelsVideo(video) {
        if (!video || !isReelsPage()) return false;

        const rect = video.getBoundingClientRect();
        return rect.width > rect.height;
    }

    function stashMovedInfoForVideo(video, infoElement) {
        if (!(video instanceof HTMLVideoElement) || !(infoElement instanceof Element)) return false;

        if (isWideReelsVideo(video)) {
            const originalInfoElement = infoElement;
            const narrowedInfoElement = getWideReelsDisplayInfoElement(infoElement);
            if (narrowedInfoElement instanceof Element) {
                infoElement = narrowedInfoElement;
            }
            if (originalInfoElement !== infoElement) {
                originalInfoElement.style.setProperty('display', 'none', 'important');
                originalInfoElement.style.setProperty('visibility', 'hidden', 'important');
                originalInfoElement.style.setProperty('pointer-events', 'none', 'important');
                hiddenWideInfoWrapperByVideo.set(video, originalInfoElement);
            }
        }

        prepareMovedInfoElement(infoElement);
        movedInfoByVideo.set(video, infoElement);
        installMovedInfoColorObserver(video, infoElement);
        ensureMovedInfoStash().appendChild(infoElement);
        log('stashed moved info', {
            video: describeVideo(video),
            info: describeElement(infoElement)
        });
        return true;
    }

    function getWideReelsDisplayInfoElement(infoElement) {
        if (!(infoElement instanceof Element)) return infoElement;

        const exactRoot = infoElement.matches('div.x78zum5.xdt5ytf.xr1yuqi.x6ikm8r.x10wlt62.xgpatz3')
            ? infoElement
            : infoElement.querySelector('div.x78zum5.xdt5ytf.xr1yuqi.x6ikm8r.x10wlt62.xgpatz3');

        if (exactRoot instanceof Element) {
            const fourthChild = exactRoot.children.length >= 4 ? exactRoot.children[3] : null;
            const lastSibling = fourthChild instanceof Element && fourthChild.parentElement
                ? fourthChild.parentElement.lastElementChild
                : null;
            if (lastSibling instanceof Element && !lastSibling.querySelector('video')) {
                const focusedCandidate = findWideReelsFocusedInfoCandidate(lastSibling);
                return focusedCandidate || lastSibling;
            }
            return exactRoot;
        }

        let narrowedElement = null;
        const stack = [infoElement];

        while (stack.length > 0) {
            const current = stack.pop();
            if (!(current instanceof Element)) continue;

            if (current.children.length >= 4) {
                const candidate = current.lastElementChild;
                if (candidate instanceof Element && !candidate.querySelector('video')) {
                    narrowedElement = candidate;
                }
            }

            for (let index = current.children.length - 1; index >= 0; index -= 1) {
                stack.push(current.children[index]);
            }
        }

        return narrowedElement || infoElement;
    }

    function findWideReelsFocusedInfoCandidate(root) {
        if (!(root instanceof Element)) return null;

        const candidates = [root, ...Array.from(root.querySelectorAll('div'))]
            .filter(candidate =>
                candidate instanceof Element &&
                !candidate.querySelector('video') &&
                !candidate.querySelector('[aria-label="Video player"]') &&
                (
                    candidate.querySelector('a[role="link"]') ||
                    candidate.querySelector('a[href^="/"]')
                ) &&
                (
                    candidate.querySelector('[role="presentation"]') ||
                    candidate.querySelector('.x1xmf6yo')
                )
            );

        candidates.sort((a, b) => {
            const aArea = getElementArea(a);
            const bArea = getElementArea(b);
            if (aArea !== bArea) return aArea - bArea;
            return getElementDepth(b) - getElementDepth(a);
        });

        return candidates[0] || null;
    }

    function getElementArea(element) {
        if (!(element instanceof Element)) return Number.POSITIVE_INFINITY;
        const rect = element.getBoundingClientRect();
        const width = Math.max(0, rect.width || element.offsetWidth || 0);
        const height = Math.max(0, rect.height || element.offsetHeight || 0);
        return width * height;
    }

    function sanitizeWideReelsInfoElement(infoElement) {
        if (!(infoElement instanceof Element)) return;

        Array.from(infoElement.querySelectorAll('[aria-label="Video player"]')).forEach(element => {
            element.style.setProperty('display', 'none', 'important');
            element.style.setProperty('pointer-events', 'none', 'important');
        });
    }

    function preCaptureWideReelsInfo(video) {
        if (!isWideReelsVideo(video) || hasMovedInfoForVideo(video)) return false;

        const fixedWideInfo = getWideReelsInfoElement(video);
        if (fixedWideInfo) {
            log('wide reels fixed info candidate', describeElement(fixedWideInfo));
            const collapsedButton = findCollapsedMoreButton(fixedWideInfo);
            if (collapsedButton) {
                const lastClickAt = Number(collapsedButton.dataset.instagramVideoControllerClickedMoreAt || '0');
                if (Date.now() - lastClickAt >= 400) {
                    collapsedButton.dataset.instagramVideoControllerClickedMoreAt = String(Date.now());
                    log('wide reels pre-capture clicking collapsed button', describeElement(collapsedButton));
                    collapsedButton.click();
                    window.setTimeout(() => {
                        if (!document.contains(video) || hasMovedInfoForVideo(video)) return;
                        if (preCaptureWideReelsInfo(video)) {
                            activeVideo = video;
                            updateSideBox();
                        }
                    }, 350);
                }
                return false;
            }
            return stashMovedInfoForVideo(video, fixedWideInfo);
        }

        log('wide reels fixed info candidate missing', describeVideo(video));
        return false;
    }

    function ensureInfoElementExpanded(infoElement) {
        applyWhiteTextToInfoElement(infoElement);

        const moreButton = findCollapsedMoreButton(infoElement) || findMoreButton(infoElement);
        if (!moreButton) return;
        if (!isCollapsedMoreButton(moreButton)) return;
        const lastClickAt = Number(moreButton.dataset.instagramVideoControllerClickedMoreAt || '0');
        if (Date.now() - lastClickAt < 400) return;

        moreButton.dataset.instagramVideoControllerClickedMoreAt = String(Date.now());
        const ownerVideo = sideBoxVideo && hasMovedInfoForVideo(sideBoxVideo) ? sideBoxVideo : null;
        const lastReexpandLogAt = ownerVideo ? Number(lastReexpandLogAtByVideo.get(ownerVideo) || 0) : 0;
        if (!ownerVideo || Date.now() - lastReexpandLogAt >= 5000) {
            log('re-expanding collapsed info', describeElement(moreButton));
            if (ownerVideo) {
                lastReexpandLogAtByVideo.set(ownerVideo, Date.now());
            }
        }
        moreButton.click();
    }

    function ensureMovedInfoExpanded(video) {
        const infoElement = movedInfoByVideo.get(video);
        if (!(infoElement instanceof Element)) return;
        ensureInfoElementExpanded(infoElement);
    }

    function scheduleRestoreInfoAfterInteraction(video) {
        if (!video) return;

        const existingTimer = restoreInfoTimerByVideo.get(video);
        if (existingTimer) {
            existingTimer.forEach(timerId => clearTimeout(timerId));
        }

        const timers = [250, 700, 1400].map(delay => window.setTimeout(() => {
            if (!document.contains(video)) return;
            if (!hasMovedInfoForVideo(video)) return;
            log('restoring moved info after interaction', {
                video: describeVideo(video),
                delay
            });
            ensureMovedInfoExpanded(video);
        }, delay));

        const cleanupTimer = window.setTimeout(() => {
            restoreInfoTimerByVideo.delete(video);
        }, 1600);

        timers.push(cleanupTimer);
        restoreInfoTimerByVideo.set(video, timers);
    }

    function clearWideReelsInfoObserver() {
        if (!wideReelsInfoObserver) return;
        wideReelsInfoObserver.disconnect();
        wideReelsInfoObserver = null;
        pendingSideBoxVideo = null;
    }

    function waitForWideReelsInfo(video) {
        if (!isWideReelsVideo(video) || hasMovedInfoForVideo(video)) {
            clearWideReelsInfoObserver();
            return;
        }

        clearWideReelsInfoObserver();
        pendingSideBoxVideo = video;

        const seventhParent = getAncestor(video, 7);
        const root = (seventhParent && seventhParent.nextElementSibling) || getAncestor(video, 10) || video.parentElement;
        if (!root) return;

        log('waiting for wide reels info', {
            video: describeVideo(video),
            root: describeElement(root)
        });
        wideReelsInfoObserver = new MutationObserver(() => {
            if (!document.contains(video)) {
                clearWideReelsInfoObserver();
                return;
            }

            if (preCaptureWideReelsInfo(video)) {
                clearWideReelsInfoObserver();
                activeVideo = video;
                log('wide reels info captured after observer', describeVideo(video));
                updateSideBox();
            }
        });

        wideReelsInfoObserver.observe(root, {
            childList: true,
            subtree: true
        });
    }

    function attachMovedInfoToSideBox(video) {
        if (!sideBoxInfo || !hasMovedInfoForVideo(video)) return false;

        let infoElement = movedInfoByVideo.get(video);
        delete sideBoxInfo.dataset.instagramVideoControllerEmptyInfo;
        if (infoElement.parentElement !== sideBoxInfo) {
            sideBoxInfo.replaceChildren();
            sideBoxInfo.appendChild(infoElement);
        }

        if (isWideReelsVideo(video)) {
            const narrowedInfoElement = getWideReelsDisplayInfoElement(infoElement);
            if (narrowedInfoElement instanceof Element && narrowedInfoElement !== infoElement) {
                sideBoxInfo.replaceChildren(narrowedInfoElement);
                infoElement = narrowedInfoElement;
                movedInfoByVideo.set(video, infoElement);
                installMovedInfoColorObserver(video, infoElement);
                applyWhiteTextToInfoElement(infoElement);
            }
            sanitizeWideReelsInfoElement(infoElement);
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
            applyWhiteTextToInfoElement(movedInfoByVideo.get(video));
            ensureMovedInfoExpanded(video);
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
        installMovedInfoColorObserver(video, infoElement);
        applyWhiteTextToInfoElement(infoElement);
        ensureMovedInfoExpanded(video);
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
        updateFloatingLogButton();

        if (!isSupportedPage()) {
            cleanupSideBox();
            hideSideBoxRestoreButton();
            removeFloatingLogButton();
            clearWideReelsInfoObserver();
            return;
        }

        if (isPostPage() && activeVideo && !isEligibleVideo(activeVideo)) {
            cleanupSideBox();
            hideSideBoxRestoreButton();
            clearWideReelsInfoObserver();
            return;
        }

        if (!activeVideo || !document.contains(activeVideo) || !isVisibleVideo(activeVideo)) {
            cleanupSideBox();
            hideSideBoxRestoreButton();
            clearWideReelsInfoObserver();
            return;
        }

        if (isWideReelsVideo(activeVideo) && !hasMovedInfoForVideo(activeVideo)) {
            log('wide reels sidebox precheck start', describeVideo(activeVideo));
            if (!preCaptureWideReelsInfo(activeVideo)) {
                waitForWideReelsInfo(activeVideo);
                log('wide reels sidebox blocked until info captured', describeVideo(activeVideo));
                if (!options.sideBoxVisibleV) {
                    cleanupSideBox();
                    return;
                }

                hideSideBoxRestoreButton();

                const waitingAnchor = findSideBoxAnchor(activeVideo);
                if (!waitingAnchor || !waitingAnchor.parentElement) {
                    cleanupSideBox();
                    return;
                }

                if (!sideBox || sideBoxVideo !== activeVideo) {
                    const box = createSideBox(activeVideo);
                    waitingAnchor.parentElement.insertBefore(box, waitingAnchor);
                    sideBoxInfo.replaceChildren();
                    sideBoxInfo.dataset.instagramVideoControllerEmptyInfo = 'true';
                    sideBoxInfo.textContent = 'Waiting for video info...';
                    recordSideBoxShown();
                    schedulePinCapturedMedia(activeVideo, 1200);
                } else {
                    waitingAnchor.parentElement.insertBefore(sideBox, waitingAnchor);
                    sideBoxInfo.dataset.instagramVideoControllerEmptyInfo = 'true';
                    sideBoxInfo.textContent = 'Waiting for video info...';
                }

                sizeSideBoxToVideo(activeVideo);
                updateDonatePromptVisibility();
                return;
            }
            clearWideReelsInfoObserver();
            log('wide reels sidebox precheck success', describeVideo(activeVideo));
        } else {
            clearWideReelsInfoObserver();
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

        if (sideBox && sideBoxVideo === activeVideo && sideBoxVideoIdentity && sideBoxVideoIdentity !== getVideoIdentity(activeVideo)) {
            log('sidebox target identity changed; rebuilding sidebox', {
                previousIdentity: sideBoxVideoIdentity,
                currentIdentity: getVideoIdentity(activeVideo),
                video: describeVideo(activeVideo)
            });
            cleanupSideBox();
        }

        if (!sideBox || sideBoxVideo !== activeVideo) {
            const box = createSideBox(activeVideo);
            anchor.parentElement.insertBefore(box, anchor);
            recordSideBoxShown();
            schedulePinCapturedMedia(activeVideo, 1200);

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
                manualPauseByVideo.set(video, false);
                internalPlayRequestAtByVideo.set(video, Date.now());
                video.play().catch(error => log('play failed', error));
            } else {
                userInteractionAt = Date.now();
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

    function installFullscreenListeners() {
        document.addEventListener('fullscreenchange', () => {
            const currentFullscreenVideo = document.fullscreenElement instanceof HTMLVideoElement
                ? document.fullscreenElement
                : document.fullscreenElement && document.fullscreenElement.querySelector
                    ? document.fullscreenElement.querySelector('video')
                    : null;

            if (fullscreenVideo && fullscreenVideo !== currentFullscreenVideo) {
                fullscreenVideo.style.removeProperty('object-fit');
                fullscreenVideo.style.removeProperty('width');
                fullscreenVideo.style.removeProperty('height');
                fullscreenVideo = null;
            }

            if (currentFullscreenVideo instanceof HTMLVideoElement) {
                fullscreenVideo = currentFullscreenVideo;
                currentFullscreenVideo.style.setProperty('object-fit', 'contain', 'important');
                currentFullscreenVideo.style.setProperty('width', '100%', 'important');
                currentFullscreenVideo.style.setProperty('height', '100%', 'important');
                cleanupSideBox();
            } else {
                updateSideBox();
            }
        }, true);
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
            installFullscreenListeners();
            installOptionListeners();
            startScanning();
        });
    }

    initialize();
})();
