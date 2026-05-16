(function () {
    'use strict';

    const REQUEST_EVENT = 'instagram-video-controller-media-map-request';
    const RESPONSE_EVENT = 'instagram-video-controller-media-map-response';
    const MAX_URLS_PER_SOURCE = 160;

    const mediaSourceIds = new WeakMap();
    const sourceBufferToMediaSourceId = new WeakMap();
    const arrayBufferToUrl = new WeakMap();
    const viewToUrl = new WeakMap();
    const blobUrlToMediaSourceId = new Map();
    const blobUrlToCreatedAt = new Map();
    const mediaSourceEntries = new Map();
    const mediaSourceDebug = new Map();
    const mediaSourceMeta = new Map();
    const recentMediaFetches = [];
    const MAX_RECENT_FETCHES = 400;
    const RECENT_FETCH_TTL_MS = 15000;

    const blobUrlToVideoElement = new Map();
    const MEDIA_LIFECYCLE_DURATION_DELTA = 0.35;

    let mediaSourceCounter = 0;

    // 메모리 누수 방지를 위한 주기적 청소 (Map 객체 관리)
    function pruneGlobalMaps() {
        const now = Date.now();
        const expiry = 60000; // 1분 지난 데이터 삭제
        for (const [id, meta] of mediaSourceMeta.entries()) {
            if (now - meta.createdAt > expiry && meta.claimedCount > 0) {
                mediaSourceMeta.delete(id);
                mediaSourceEntries.delete(id);
                mediaSourceDebug.delete(id);
                // 역방향 맵도 청소
                for (const [blobUrl, msId] of blobUrlToMediaSourceId.entries()) {
                    if (msId === id) {
                        blobUrlToMediaSourceId.delete(blobUrl);
                        blobUrlToCreatedAt.delete(blobUrl);
                    }
                }
            }
        }
    }
    setInterval(pruneGlobalMaps, 30000);

    function isMediaRequestUrl(url) {
        return typeof url === 'string' && /\.mp4($|\?)/i.test(url);
    }

    function getMediaSourceId(mediaSource) {
        if (!mediaSourceIds.has(mediaSource)) {
            mediaSourceCounter += 1;
            const createdAt = Date.now();
            const id = `ms-${createdAt}-${mediaSourceCounter}`;
            mediaSourceIds.set(mediaSource, id);
            mediaSourceMeta.set(id, {
                createdAt,
                lastClaimAt: createdAt,
                preferredAssetKey: '',
                claimedCount: 0
            });
        }
        return mediaSourceIds.get(mediaSource);
    }

    function getMediaEntry(id) {
        if (!mediaSourceEntries.has(id)) {
            mediaSourceEntries.set(id, []);
        }
        return mediaSourceEntries.get(id);
    }

    function getMediaDebugEntry(id) {
        if (!mediaSourceDebug.has(id)) {
            mediaSourceDebug.set(id, {
                appendCount: 0,
                trackedCount: 0,
                heuristicCount: 0,
                lastUrl: ''
            });
        }
        return mediaSourceDebug.get(id);
    }

    function pruneRecentFetches() {
        const minTime = Date.now() - RECENT_FETCH_TTL_MS;
        for (let i = recentMediaFetches.length - 1; i >= 0; i -= 1) {
            if (recentMediaFetches[i].at < minTime) {
                recentMediaFetches.splice(i, 1);
            }
        }
        if (recentMediaFetches.length > MAX_RECENT_FETCHES) {
            recentMediaFetches.splice(0, recentMediaFetches.length - MAX_RECENT_FETCHES);
        }
    }

    function claimRecentFetchUrl(mediaSourceId, expectedByteLength = 0, durationHint = 0) {
        pruneRecentFetches();
        const meta = mediaSourceId ? mediaSourceMeta.get(mediaSourceId) : null;
        const createdAt = meta ? meta.createdAt : 0;
        const lastClaimAt = meta ? meta.lastClaimAt : 0;
        const effectiveDurationHint = durationHint || (meta && meta.stickyDuration) || 0;

        const strictCandidates = recentMediaFetches.filter(item =>
            !item.used &&
            item.at >= Math.max(0, createdAt - 2000) &&
            item.at >= Math.max(0, lastClaimAt - 500)
        );
        const looseCandidates = recentMediaFetches.filter(item =>
            !item.used &&
            item.at >= Math.max(0, createdAt - 20000)
        );
        const candidates = strictCandidates.length > 0 ? strictCandidates : looseCandidates;

        if (candidates.length === 0) {
            return '';
        }

        const preferredAssetKey = meta && meta.preferredAssetKey ? meta.preferredAssetKey : '';
        let scopedCandidates = candidates;

        if (preferredAssetKey) {
            const sameAssetCandidates = candidates.filter(item => item.assetKey === preferredAssetKey);
            if (sameAssetCandidates.length > 0) {
                scopedCandidates = sameAssetCandidates;
            }
        }

        if (effectiveDurationHint > 0) {
            const durationFiltered = scopedCandidates.filter(item => {
                const itemDuration = Number(item.duration || 0);
                if (itemDuration <= 0) return false;
                return Math.abs(itemDuration - effectiveDurationHint) <= 0.35;
            });
            if (durationFiltered.length > 0) {
                scopedCandidates = durationFiltered;
            }
        }

        if (Number.isFinite(expectedByteLength) && expectedByteLength > 0) {
            const sameLengthCandidates = scopedCandidates.filter(item => item.byteLength === expectedByteLength);
            if (sameLengthCandidates.length > 0) {
                scopedCandidates = sameLengthCandidates;
            } else {
                const closeLengthCandidates = scopedCandidates.filter(item => {
                    const byteLength = Number(item.byteLength || 0);
                    if (byteLength <= 0) return false;
                    return Math.abs(byteLength - expectedByteLength) <= 1024;
                });
                if (closeLengthCandidates.length > 0) {
                    scopedCandidates = closeLengthCandidates;
                }
            }
        }

        if (scopedCandidates.length === 0) {
            scopedCandidates = candidates;
        }

        scopedCandidates.sort((a, b) => compareRecentFetches(a, b, meta));
        const item = scopedCandidates[0];
        item.used = true;

        if (meta) {
            meta.lastClaimAt = item.at;
            const itemDuration = Number(item.duration || 0);
            const durationLooksCorrect = !effectiveDurationHint || (itemDuration > 0 && Math.abs(itemDuration - effectiveDurationHint) <= 0.35);
            if (!meta.preferredAssetKey && item.assetKey && durationLooksCorrect) {
                meta.preferredAssetKey = item.assetKey;
            }
            meta.claimedCount += 1;
        }

        return item.url;
    }


    function trackUrlForMediaSource(id, url) {
        if (!id || !isMediaRequestUrl(url)) return;
        const list = getMediaEntry(id);
        const debug = getMediaDebugEntry(id);
        debug.trackedCount += 1;
        debug.lastUrl = url;
        const existingIndex = list.findIndex(entry => entry && entry.url === url);
        
        const assetKey = getAssetKeyForUrl(url);
        const efg = url.includes('efg=') ? new URL(url).searchParams.get('efg') : '';
        const meta = parseEfgPayload(efg);

        const metadata = {
            url,
            at: Date.now(),
            assetKey,
            duration: Number(meta.duration_s || 0),
            rangeLength: getRangeLengthFromUrl(url)
        };
        if (existingIndex >= 0) {
            list.splice(existingIndex, 1);
        }
        list.push(metadata);
        if (list.length > MAX_URLS_PER_SOURCE) {
            list.splice(0, list.length - MAX_URLS_PER_SOURCE);
        }
    }

    function pushRecentFetchUrl(url, byteLength = 0) {
        if (!isMediaRequestUrl(url)) return;
        const efg = url.includes('efg=') ? new URL(url).searchParams.get('efg') : '';
        const meta = parseEfgPayload(efg);
        
        recentMediaFetches.push({
            url,
            at: Date.now(),
            used: false,
            assetKey: getAssetKeyForUrl(url),
            duration: Number(meta.duration_s || 0),
            rangeLength: getRangeLengthFromUrl(url),
            byteLength: byteLength || 0
        });
        pruneRecentFetches();
    }

    function getAssetKeyForUrl(url) {
        if (!isMediaRequestUrl(url)) return '';
        try {
            const parsed = new URL(url);
            const efg = parsed.searchParams.get('efg');
            const meta = parseEfgPayload(efg);
            if (meta.xpv_asset_id) {
                return String(meta.xpv_asset_id);
            }
            return parsed.pathname.split('/').filter(Boolean).pop() || '';
        } catch (_error) {
            return '';
        }
    }

    function getRangeLengthFromUrl(url) {
        try {
            const parsed = new URL(url);
            const start = Number(parsed.searchParams.get('bytestart') || -1);
            const end = Number(parsed.searchParams.get('byteend') || -1);
            if (start < 0 || end < start) return 0;
            return end - start;
        } catch (_error) {
            return 0;
        }
    }

    function compareRecentFetches(a, b, meta) {
        // 1. 시간적 근접성 최우선 (방금 가져온 것이 내 것일 확률이 가장 높음)
        // 단, 0.1초 이내라면 크기 비교를 수행
        const timeDiff = Math.abs(a.at - b.at);
        if (timeDiff > 100) {
            return b.at - a.at; // 최신순
        }

        // 2. 실질적인 데이터 조각(Substantial) 선호
        const aSub = a.rangeLength >= 10240 ? 1 : 0; // 10KB 이상
        const bSub = b.rangeLength >= 10240 ? 1 : 0;
        if (aSub !== bSub) {
            return bSub - aSub;
        }

        // 3. 더 최신 것
        if (a.at !== b.at) {
            return b.at - a.at;
        }

        return b.rangeLength - a.rangeLength;
    }

    function getMediaSourceDurationHint(id) {
        const meta = mediaSourceMeta.get(id);
        const stickyDuration = Number(meta && meta.stickyDuration || 0);
        if (stickyDuration > 0) return stickyDuration;
        const entries = mediaSourceEntries.get(id) || [];
        for (let i = entries.length - 1; i >= 0; i -= 1) {
            const entry = entries[i];
            const duration = Number(entry && entry.duration || 0);
            if (duration > 0) {
                return duration;
            }
        }
        return 0;
    }

    function getMediaSourceLastEntryAt(id) {
        const entries = mediaSourceEntries.get(id) || [];
        let lastAt = 0;
        for (const entry of entries) {
            const at = Number(entry && entry.at || 0);
            if (at > lastAt) {
                lastAt = at;
            }
        }
        return lastAt;
    }

    function findLikelyMediaSourceIdForVideo(video) {
        if (!(video instanceof HTMLVideoElement)) return '';
        const targetDuration = Number(video.duration || 0);
        const now = Date.now();
        const candidates = [];

        for (const [id, meta] of mediaSourceMeta.entries()) {
            const entries = mediaSourceEntries.get(id) || [];
            if (entries.length === 0) continue;
            const durationHint = getMediaSourceDurationHint(id);
            const durationDelta = targetDuration > 0 && durationHint > 0
                ? Math.abs(durationHint - targetDuration)
                : Number.POSITIVE_INFINITY;
            const durationBucket = durationDelta <= 0.35 ? 0 : durationDelta <= 1 ? 1 : 2;
            const lastEntryAt = getMediaSourceLastEntryAt(id);
            const age = lastEntryAt > 0 ? now - lastEntryAt : Number.POSITIVE_INFINITY;
            const recentScore = age <= 15000 ? 0 : age <= 60000 ? 1 : 2;
            candidates.push({
                id,
                durationHint,
                durationDelta,
                durationBucket,
                lastEntryAt,
                recentScore,
                createdAt: Number(meta && meta.createdAt || 0)
            });
        }

        if (candidates.length === 0) return '';

        candidates.sort((a, b) => {
            if (a.durationBucket !== b.durationBucket) return a.durationBucket - b.durationBucket;
            if (a.durationDelta !== b.durationDelta) return a.durationDelta - b.durationDelta;
            if (a.recentScore !== b.recentScore) return a.recentScore - b.recentScore;
            if (a.lastEntryAt !== b.lastEntryAt) return b.lastEntryAt - a.lastEntryAt;
            return b.createdAt - a.createdAt;
        });

        return candidates[0].id || '';
    }

    function bindBlobUrlToLikelyMediaSource(blobUrl, video) {
        if (!blobUrl || !blobUrl.startsWith('blob:')) return '';
        if (blobUrlToMediaSourceId.has(blobUrl)) {
            return blobUrlToMediaSourceId.get(blobUrl) || '';
        }
        const mediaSourceId = findLikelyMediaSourceIdForVideo(video);
        if (!mediaSourceId) return '';
        blobUrlToMediaSourceId.set(blobUrl, mediaSourceId);
        blobUrlToCreatedAt.set(blobUrl, Date.now());
        blobUrlToVideoElement.set(blobUrl, video);
        return mediaSourceId;
    }

    function parseEfgPayload(rawValue) {
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

    const originalSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (originalSrcDescriptor && originalSrcDescriptor.set) {
        const originalSet = originalSrcDescriptor.set;
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            ...originalSrcDescriptor,
            set: function (val) {
                try {
                    if (this instanceof HTMLVideoElement && typeof val === 'string' && val.startsWith('blob:')) {
                        blobUrlToVideoElement.set(val, this);
                        if (!blobUrlToCreatedAt.has(val)) {
                            blobUrlToCreatedAt.set(val, Date.now());
                        }
                    }
                } catch (_error) {
                }
                return originalSet.apply(this, arguments);
            }
        });
    }

    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function patchedCreateObjectURL(object) {
        const result = originalCreateObjectURL(object);
        try {
            if (object instanceof MediaSource) {
                const id = getMediaSourceId(object);
                blobUrlToMediaSourceId.set(result, id);
                blobUrlToCreatedAt.set(result, Date.now());
            }
        } catch (_error) {
        }
        return result;
    };

    function onVideoLifecycleEvent(event) {
        try {
            const video = event && event.target;
            if (!(video instanceof HTMLVideoElement)) return;
            const blobUrl = video.currentSrc || video.src || '';
            if (!blobUrl || !blobUrl.startsWith('blob:')) return;
            blobUrlToVideoElement.set(blobUrl, video);
            if (!blobUrlToMediaSourceId.has(blobUrl)) {
                bindBlobUrlToLikelyMediaSource(blobUrl, video);
            }
        } catch (_error) {
        }
    }

    document.addEventListener('loadedmetadata', onVideoLifecycleEvent, true);
    document.addEventListener('loadeddata', onVideoLifecycleEvent, true);
    document.addEventListener('play', onVideoLifecycleEvent, true);

    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function patchedAddSourceBuffer() {
        const sourceBuffer = originalAddSourceBuffer.apply(this, arguments);
        try {
            const msId = getMediaSourceId(this);
            sourceBufferToMediaSourceId.set(sourceBuffer, msId);
            sourceBuffer.__parentMediaSource = this;
        } catch (_error) {
        }
        return sourceBuffer;
    };

    const originalArrayBuffer = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = function patchedArrayBuffer() {
        const response = this;
        return originalArrayBuffer.apply(this, arguments).then(buffer => {
            try {
                if (buffer && isMediaRequestUrl(response.url)) {
                    arrayBufferToUrl.set(buffer, response.url);
                    pushRecentFetchUrl(response.url, Number(buffer.byteLength || 0));
                }
            } catch (_error) {
            }
            return buffer;
        });
    };

    const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function patchedAppendBuffer(buffer) {
        try {
            const mediaSourceId = sourceBufferToMediaSourceId.get(this);
            const ms = this.__parentMediaSource;
            
            let durationHint = ms ? Number(ms.duration || 0) : 0;
            
            if (!Number.isFinite(durationHint) || durationHint <= 0) {
                const blobUrl = [...blobUrlToMediaSourceId.entries()].find(([_, id]) => id === mediaSourceId)?.[0];
                if (blobUrl) {
                    const video = blobUrlToVideoElement.get(blobUrl);
                    if (video && Number.isFinite(video.duration) && video.duration > 0) {
                        durationHint = video.duration;
                    }
                }
            }

            if (mediaSourceId) {
                getMediaDebugEntry(mediaSourceId).appendCount += 1;
            }
            const rawBuffer = buffer instanceof ArrayBuffer
                ? buffer
                : (ArrayBuffer.isView(buffer) ? buffer.buffer : null);
            const url = viewToUrl.get(buffer) ||
                arrayBufferToUrl.get(buffer) ||
                (rawBuffer ? arrayBufferToUrl.get(rawBuffer) : '') ||
                claimRecentFetchUrl(mediaSourceId, Number((rawBuffer && rawBuffer.byteLength) || (buffer && buffer.byteLength) || 0), durationHint);
            
            if (mediaSourceId && url) {
                if (!viewToUrl.get(buffer) && !arrayBufferToUrl.get(buffer) && !(rawBuffer ? arrayBufferToUrl.get(rawBuffer) : '')) {
                    getMediaDebugEntry(mediaSourceId).heuristicCount += 1;
                }
                
                // 클레임된 URL의 duration을 MS 메타데이터에 고정 (비디오 요소의 duration이 아직 없을 때를 대비)
                const meta = mediaSourceMeta.get(mediaSourceId);
                if (meta) {
                    const stickyDuration = Number(meta.stickyDuration || 0);
                    const durationShifted =
                        stickyDuration > 0 &&
                        durationHint > 0 &&
                        Math.abs(stickyDuration - durationHint) > MEDIA_LIFECYCLE_DURATION_DELTA;

                    if (durationShifted) {
                        meta.preferredAssetKey = '';
                        meta.claimedCount = 0;
                        meta.lastClaimAt = Date.now();
                        mediaSourceEntries.set(mediaSourceId, []);
                        const debugEntry = getMediaDebugEntry(mediaSourceId);
                        debugEntry.trackedCount = 0;
                        debugEntry.heuristicCount = 0;
                        debugEntry.lastUrl = '';
                    }

                    if (durationHint > 0) {
                        meta.stickyDuration = durationHint;
                    } else if (!meta.stickyDuration) {
                        const efg = url.includes('efg=') ? new URL(url).searchParams.get('efg') : '';
                        const urlMeta = parseEfgPayload(efg);
                        const urlDur = Number(urlMeta.duration_s || 0);
                        if (urlDur > 0) {
                            meta.stickyDuration = urlDur;
                        }
                    }
                }
                
                trackUrlForMediaSource(mediaSourceId, url);
            }
        } catch (_error) {
        }
        return originalAppendBuffer.apply(this, arguments);
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = function patchedFetch() {
        return originalFetch.apply(this, arguments).then(response => {
            try {
                if (response && isMediaRequestUrl(response.url)) {
                    const clonedResponse = response.clone();
                    clonedResponse.arrayBuffer().then(buffer => {
                        try {
                            arrayBufferToUrl.set(buffer, response.url);
                            viewToUrl.set(new Uint8Array(buffer), response.url);
                            pushRecentFetchUrl(response.url, Number(buffer.byteLength || 0));
                        } catch (_error) {
                        }
                    }).catch(() => {});
                }
            } catch (_error) {
            }
            return response;
        });
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
        this.__ivc_url = url;
        return originalOpen.apply(this, arguments);
    };

    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function patchedSend() {
        this.addEventListener('load', () => {
            try {
                const url = this.__ivc_url;
                if (url && isMediaRequestUrl(url) && (this.responseType === 'arraybuffer' || !this.responseType) && this.response) {
                    const buffer = this.response;
                    if (buffer instanceof ArrayBuffer) {
                        arrayBufferToUrl.set(buffer, url);
                        viewToUrl.set(new Uint8Array(buffer), url);
                        pushRecentFetchUrl(url, Number(buffer.byteLength || 0));
                    }
                }
            } catch (_error) {
            }
        });
        return originalSend.apply(this, arguments);
    };

    document.addEventListener(REQUEST_EVENT, event => {
        const detail = event && event.detail ? event.detail : {};
        const requestId = detail.requestId;
        const blobUrl = detail.blobUrl;
        let mediaSourceId = blobUrlToMediaSourceId.get(blobUrl) || '';
        if (!mediaSourceId && blobUrl) {
            const video = blobUrlToVideoElement.get(blobUrl);
            mediaSourceId = bindBlobUrlToLikelyMediaSource(blobUrl, video);
        }
        const blobCreatedAt = blobUrlToCreatedAt.get(blobUrl) || 0;
        const allEntries = mediaSourceId ? [...(mediaSourceEntries.get(mediaSourceId) || [])] : [];
        const entries = blobCreatedAt > 0
            ? allEntries.filter(entry => Number(entry && entry.at) >= (blobCreatedAt - 500))
            : allEntries;
        const urls = entries.map(entry => entry.url);
        const debug = mediaSourceId ? { ...(mediaSourceDebug.get(mediaSourceId) || {}) } : {};
        document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
            detail: {
                requestId,
                blobUrl,
                mediaSourceId,
                blobCreatedAt,
                entries,
                urls,
                debug
            }
        }));
    }, true);
})();
