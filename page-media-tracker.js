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
    const mediaSourceEntries = new Map();
    const mediaSourceDebug = new Map();
    const mediaSourceMeta = new Map();
    const recentMediaFetches = [];
    const MAX_RECENT_FETCHES = 400;
    const RECENT_FETCH_TTL_MS = 15000;

    const blobUrlToVideoElement = new Map();

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
                    if (msId === id) blobUrlToMediaSourceId.delete(blobUrl);
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
        
        // 고정된 duration이 있으면 그것을 우선 사용
        const effectiveDurationHint = (meta && meta.stickyDuration) || durationHint || 0;

        const candidates = recentMediaFetches.filter(item =>
            !item.used &&
            item.at >= Math.max(0, createdAt - 800) &&
            item.at >= Math.max(0, lastClaimAt - 120)
        );

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
            // 재생 시간이 명시된 후보 중 힌트와 맞는 것만 남김
            // 재생 시간이 없는 후보는 일단 유지 (나중에 byteLength 등으로 확인 가능하므로)
            scopedCandidates = scopedCandidates.filter(item => {
                const itemDuration = Number(item.duration || 0);
                if (itemDuration <= 0) return true;
                // 허용 오차 기능 삭제: 소수점 2자리까지 일치해야 함
                return itemDuration.toFixed(2) === effectiveDurationHint.toFixed(2);
            });
        }

        if (Number.isFinite(expectedByteLength) && expectedByteLength > 0) {
            const sameLengthCandidates = scopedCandidates.filter(item => item.byteLength === expectedByteLength);
            if (sameLengthCandidates.length > 0) {
                scopedCandidates = sameLengthCandidates;
            }
        }

        scopedCandidates.sort((a, b) => compareRecentFetches(a, b, meta));
        const item = scopedCandidates[0];
        item.used = true;

        if (meta) {
            meta.lastClaimAt = item.at;
            if (!meta.preferredAssetKey && item.assetKey) {
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
            }
        } catch (_error) {
        }
        return result;
    };

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
                if (meta && !meta.stickyDuration) {
                    const efg = url.includes('efg=') ? new URL(url).searchParams.get('efg') : '';
                    const urlMeta = parseEfgPayload(efg);
                    const urlDur = Number(urlMeta.duration_s || 0);
                    if (urlDur > 0) {
                        meta.stickyDuration = urlDur;
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
        const mediaSourceId = blobUrlToMediaSourceId.get(blobUrl) || '';
        const entries = mediaSourceId ? [...(mediaSourceEntries.get(mediaSourceId) || [])] : [];
        const urls = entries.map(entry => entry.url);
        const debug = mediaSourceId ? { ...(mediaSourceDebug.get(mediaSourceId) || {}) } : {};
        document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
            detail: {
                requestId,
                blobUrl,
                mediaSourceId,
                entries,
                urls,
                debug
            }
        }));
    }, true);
})();
