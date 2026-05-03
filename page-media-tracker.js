(function () {
    'use strict';

    const REQUEST_EVENT = 'instagram-video-controller-media-map-request';
    const RESPONSE_EVENT = 'instagram-video-controller-media-map-response';
    const MAX_URLS_PER_SOURCE = 160;

    const mediaSourceIds = new WeakMap();
    const sourceBufferToMediaSourceId = new WeakMap();
    const arrayBufferToUrl = new WeakMap();
    const blobUrlToMediaSourceId = new Map();
    const mediaSourceEntries = new Map();

    let mediaSourceCounter = 0;

    function isMediaRequestUrl(url) {
        return typeof url === 'string' && /\.mp4($|\?)/i.test(url);
    }

    function getMediaSourceId(mediaSource) {
        if (!mediaSourceIds.has(mediaSource)) {
            mediaSourceCounter += 1;
            mediaSourceIds.set(mediaSource, `ms-${Date.now()}-${mediaSourceCounter}`);
        }
        return mediaSourceIds.get(mediaSource);
    }

    function getMediaEntry(id) {
        if (!mediaSourceEntries.has(id)) {
            mediaSourceEntries.set(id, []);
        }
        return mediaSourceEntries.get(id);
    }

    function trackUrlForMediaSource(id, url) {
        if (!id || !isMediaRequestUrl(url)) return;
        const list = getMediaEntry(id);
        const existingIndex = list.indexOf(url);
        if (existingIndex >= 0) {
            list.splice(existingIndex, 1);
        }
        list.push(url);
        if (list.length > MAX_URLS_PER_SOURCE) {
            list.splice(0, list.length - MAX_URLS_PER_SOURCE);
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
            const url = arrayBufferToUrl.get(buffer);
            if (mediaSourceId && url) {
                trackUrlForMediaSource(mediaSourceId, url);
            }
        } catch (_error) {
        }
        return originalAppendBuffer.apply(this, arguments);
    };

    document.addEventListener(REQUEST_EVENT, event => {
        const detail = event && event.detail ? event.detail : {};
        const requestId = detail.requestId;
        const blobUrl = detail.blobUrl;
        const mediaSourceId = blobUrlToMediaSourceId.get(blobUrl) || '';
        const urls = mediaSourceId ? [...(mediaSourceEntries.get(mediaSourceId) || [])] : [];
        document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
            detail: {
                requestId,
                blobUrl,
                mediaSourceId,
                urls
            }
        }));
    }, true);
})();
