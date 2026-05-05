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

    let mediaSourceCounter = 0;

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

    function pushRecentFetchUrl(url) {
        if (!isMediaRequestUrl(url)) return;
        recentMediaFetches.push({
            url,
            at: Date.now(),
            used: false,
            assetKey: getAssetKeyForUrl(url),
            rangeLength: getRangeLengthFromUrl(url)
        });
        pruneRecentFetches();
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

    function claimRecentFetchUrl(mediaSourceId) {
        pruneRecentFetches();
        const meta = mediaSourceId ? mediaSourceMeta.get(mediaSourceId) : null;
        const createdAt = meta ? meta.createdAt : 0;
        const lastClaimAt = meta ? meta.lastClaimAt : 0;

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
        const existingIndex = list.indexOf(url);
        if (existingIndex >= 0) {
            list.splice(existingIndex, 1);
        }
        list.push(url);
        if (list.length > MAX_URLS_PER_SOURCE) {
            list.splice(0, list.length - MAX_URLS_PER_SOURCE);
        }
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
        const preferredBeforeCount = meta ? meta.claimedCount : 0;
        const aSubstantial = a.rangeLength >= 65536 ? 1 : 0;
        const bSubstantial = b.rangeLength >= 65536 ? 1 : 0;
        if (aSubstantial !== bSubstantial) {
            return bSubstantial - aSubstantial;
        }

        if (preferredBeforeCount === 0) {
            if (a.at !== b.at) {
                return a.at - b.at;
            }
            return b.rangeLength - a.rangeLength;
        }

        if (a.at !== b.at) {
            return a.at - b.at;
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
            sourceBufferToMediaSourceId.set(sourceBuffer, getMediaSourceId(this));
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
                    pushRecentFetchUrl(response.url);
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
            if (mediaSourceId) {
                getMediaDebugEntry(mediaSourceId).appendCount += 1;
            }
            const rawBuffer = buffer instanceof ArrayBuffer
                ? buffer
                : (ArrayBuffer.isView(buffer) ? buffer.buffer : null);
            const url = viewToUrl.get(buffer) ||
                arrayBufferToUrl.get(buffer) ||
                (rawBuffer ? arrayBufferToUrl.get(rawBuffer) : '') ||
                claimRecentFetchUrl(mediaSourceId);
            if (mediaSourceId && url) {
                if (!viewToUrl.get(buffer) && !arrayBufferToUrl.get(buffer) && !(rawBuffer ? arrayBufferToUrl.get(rawBuffer) : '')) {
                    getMediaDebugEntry(mediaSourceId).heuristicCount += 1;
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
                            pushRecentFetchUrl(response.url);
                        } catch (_error) {
                        }
                    }).catch(() => {});
                }
            } catch (_error) {
            }
            return response;
        });
    };

    document.addEventListener(REQUEST_EVENT, event => {
        const detail = event && event.detail ? event.detail : {};
        const requestId = detail.requestId;
        const blobUrl = detail.blobUrl;
        const mediaSourceId = blobUrlToMediaSourceId.get(blobUrl) || '';
        const urls = mediaSourceId ? [...(mediaSourceEntries.get(mediaSourceId) || [])] : [];
        const debug = mediaSourceId ? { ...(mediaSourceDebug.get(mediaSourceId) || {}) } : {};
        document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
            detail: {
                requestId,
                blobUrl,
                mediaSourceId,
                urls,
                debug
            }
        }));
    }, true);
})();
