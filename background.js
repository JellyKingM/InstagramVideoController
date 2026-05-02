importScripts('shared.js');

const mediaRequestsByTab = new Map();
const pinnedMediaByTab = new Map();
const MEDIA_REQUEST_LIMIT = 80;
const MEDIA_REQUEST_TTL_MS = 10 * 60 * 1000;
const RECENT_MEDIA_WINDOW_MS = 20 * 1000;

chrome.runtime.onInstalled.addListener(function () {
    chrome.contextMenus.create({
        title: chrome.i18n.getMessage('donate') || 'Donate to Developer',
        contexts: ['action'],
        id: IVC_SHARED.IDS.donationMenu
    });
});

chrome.contextMenus.onClicked.addListener(function (info) {
    if (info.menuItemId === IVC_SHARED.IDS.donationMenu) {
        chrome.tabs.create({ url: IVC_SHARED.LINKS.donate });
    }
});

chrome.action.onClicked.addListener(function () {
    chrome.tabs.create({ url: IVC_SHARED.LINKS.developer });
});

chrome.webRequest.onCompleted.addListener(function (details) {
    try {
        if (details.tabId < 0 || details.statusCode < 200 || details.statusCode >= 400) {
            return;
        }

        const candidate = buildMediaRequestCandidate(details.url);
        if (!candidate) return;

        const list = mediaRequestsByTab.get(details.tabId) || [];
        list.push(candidate);
        pruneMediaRequests(list);
        mediaRequestsByTab.set(details.tabId, list);
        console.log('[InstagramVideoController]', 'captured media request', candidate);
    } catch (error) {
        console.log('[InstagramVideoController]', 'capture media request failed', error);
    }
}, {
    urls: [
        'https://*.cdninstagram.com/*',
        'https://*.fbcdn.net/*'
    ]
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.redirect) {
        chrome.tabs.create({ url: message.redirect });
        return;
    }

    if (message.downloadCapturedVideo) {
        const tabId = sender && sender.tab ? sender.tab.id : -1;
        const bundle = pinnedMediaByTab.get(tabId) || pickBestMediaBundleForTab(tabId);
        if (!bundle || !bundle.video) {
            sendResponse({
                ok: false,
                error: 'no captured media request'
            });
            return;
        }

        const videoUrl = stripByteRangeParams(bundle.video.url);
        const videoFilename = buildCapturedMediaFilename(bundle.video);
        console.log('[InstagramVideoController]', 'download captured media', {
            tabId,
            bundle,
            videoUrl,
            videoFilename
        });

        chrome.downloads.download({
            url: videoUrl,
            filename: videoFilename,
            saveAs: false
        }, function (videoDownloadId) {
            if (chrome.runtime.lastError) {
                sendResponse({
                    ok: false,
                    error: chrome.runtime.lastError.message,
                    bundle
                });
                return;
            }

            if (bundle.audio) {
                chrome.downloads.download({
                    url: stripByteRangeParams(bundle.audio.url),
                    filename: buildCapturedMediaFilename(bundle.audio),
                    saveAs: false
                }, function (audioDownloadId) {
                    sendResponse({
                        ok: true,
                        videoDownloadId,
                        audioDownloadId: chrome.runtime.lastError ? null : audioDownloadId,
                        separateAudio: true,
                        bundle
                    });
                });
                return;
            }

            sendResponse({
                ok: true,
                videoDownloadId,
                separateAudio: false,
                bundle
            });
        });
        return true;
    }

    if (message.pinCapturedVideo) {
        const tabId = sender && sender.tab ? sender.tab.id : -1;
        const bundle = pickBestMediaBundleForTab(tabId);
        if (bundle && bundle.video) {
            pinnedMediaByTab.set(tabId, bundle);
            sendResponse({
                ok: true,
                bundle
            });
            return;
        }

        sendResponse({
            ok: false,
            error: 'no media bundle to pin'
        });
        return;
    }

    if (message.downloadVideo && message.downloadVideo.url) {
        console.log('[InstagramVideoController]', 'download request', message.downloadVideo);
        chrome.downloads.download({
            url: message.downloadVideo.url,
            filename: message.downloadVideo.filename || 'instagram-video.mp4',
            saveAs: false
        }, function (downloadId) {
            if (chrome.runtime.lastError) {
                console.log('[InstagramVideoController]', 'download error', chrome.runtime.lastError.message);
                sendResponse({
                    ok: false,
                    error: chrome.runtime.lastError.message
                });
                return;
            }

            console.log('[InstagramVideoController]', 'download started', downloadId);
            sendResponse({
                ok: true,
                downloadId
            });
        });
        return true;
    }
});

function buildMediaRequestCandidate(url) {
    if (!url || !/\.mp4($|\?)/i.test(url)) return null;

    const parsed = new URL(url);
    const params = parsed.searchParams;
    const efg = params.get('efg');
    const meta = parseEfgPayload(efg);
    const tag = String(meta.vencode_tag || '').toLowerCase();
    const bitrate = Number(meta.bitrate || 0);
    const duration = Number(meta.duration_s || 0);

    return {
        url,
        capturedAt: Date.now(),
        bitrate,
        duration,
        tag,
        assetId: meta.xpv_asset_id || '',
        byteStart: Number(params.get('bytestart') || -1),
        byteEnd: Number(params.get('byteend') || -1),
        isAudio: /audio/.test(tag),
        isVideo: /vp9|avc|h264|basic|dash/.test(tag) && !/audio/.test(tag)
    };
}

function parseEfgPayload(rawValue) {
    if (!rawValue) return {};
    try {
        const decoded = atob(rawValue);
        return JSON.parse(decoded);
    } catch (error) {
        try {
            const decoded = atob(decodeURIComponent(rawValue));
            return JSON.parse(decoded);
        } catch (nestedError) {
            return {};
        }
    }
}

function pruneMediaRequests(list) {
    const minTime = Date.now() - MEDIA_REQUEST_TTL_MS;
    const filtered = list.filter(item => item.capturedAt >= minTime);
    filtered.sort((a, b) => b.capturedAt - a.capturedAt);
    list.length = 0;
    list.push(...filtered.slice(0, MEDIA_REQUEST_LIMIT));
}

function pickBestMediaRequestForTab(tabId) {
    const list = mediaRequestsByTab.get(tabId) || [];
    pruneMediaRequests(list);
    if (list.length === 0) return null;

    const now = Date.now();
    const recentList = list.filter(item => now - item.capturedAt <= RECENT_MEDIA_WINDOW_MS);
    const videoCandidates = recentList.filter(item => item.isVideo);
    if (videoCandidates.length > 0) {
        videoCandidates.sort(compareMediaCandidates);
        return videoCandidates[0];
    }

    const fallbackVideoCandidates = list.filter(item => item.isVideo);
    if (fallbackVideoCandidates.length > 0) {
        fallbackVideoCandidates.sort(compareMediaCandidates);
        return fallbackVideoCandidates[0];
    }

    const nonAudioCandidates = recentList.filter(item => !item.isAudio);
    if (nonAudioCandidates.length > 0) {
        nonAudioCandidates.sort(compareMediaCandidates);
        return nonAudioCandidates[0];
    }

    const fallbackNonAudio = list.filter(item => !item.isAudio);
    if (fallbackNonAudio.length > 0) {
        fallbackNonAudio.sort(compareMediaCandidates);
        return fallbackNonAudio[0];
    }

    return [...list].sort(compareMediaCandidates)[0];
}

function pickBestMediaBundleForTab(tabId) {
    const list = mediaRequestsByTab.get(tabId) || [];
    pruneMediaRequests(list);
    if (list.length === 0) return null;

    const video = pickBestMediaRequestForTab(tabId);
    if (!video) return null;

    const audioCandidates = list.filter(item =>
        item.isAudio &&
        (!video.assetId || item.assetId === video.assetId)
    );

    audioCandidates.sort(compareMediaCandidates);

    return {
        video,
        audio: audioCandidates[0] || null
    };
}

function compareMediaCandidates(a, b) {
    if (b.capturedAt !== a.capturedAt) return b.capturedAt - a.capturedAt;
    if (b.bitrate !== a.bitrate) return b.bitrate - a.bitrate;

    const rangeA = getRangeLength(a);
    const rangeB = getRangeLength(b);
    if (rangeB !== rangeA) return rangeB - rangeA;

    return String(b.assetId || '').localeCompare(String(a.assetId || ''));
}

function getRangeLength(item) {
    if (!Number.isFinite(item.byteStart) || !Number.isFinite(item.byteEnd)) return 0;
    if (item.byteStart < 0 || item.byteEnd < item.byteStart) return 0;
    return item.byteEnd - item.byteStart;
}

function stripByteRangeParams(url) {
    const parsed = new URL(url);
    parsed.searchParams.delete('bytestart');
    parsed.searchParams.delete('byteend');
    return parsed.toString();
}

function buildCapturedMediaFilename(candidate) {
    const assetId = candidate.assetId || 'instagram-video';
    const suffix = candidate.isAudio ? 'audio' : 'video';
    return `${assetId}-${suffix}.mp4`;
}
