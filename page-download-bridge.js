(function () {
    'use strict';

    const requestEvent = 'instagram-video-controller-download-request';
    const resultEvent = 'instagram-video-controller-download-result';

    window.addEventListener(requestEvent, async event => {
        const detail = event && event.detail ? event.detail : {};
        const requestId = detail.requestId;
        const sourceUrl = detail.url;
        const filename = detail.filename || 'instagram-video.mp4';

        try {
            if (sourceUrl && sourceUrl.startsWith('blob:')) {
                const recordedBlob = await recordExistingBlobVideo(detail.targetId);
                const recordedUrl = URL.createObjectURL(recordedBlob);
                const recordedName = filename.replace(/\.[a-z0-9]+$/i, '') + '.webm';
                const link = document.createElement('a');
                link.href = recordedUrl;
                link.download = recordedName;
                link.style.display = 'none';
                document.documentElement.appendChild(link);
                link.click();
                window.setTimeout(() => {
                    URL.revokeObjectURL(recordedUrl);
                    link.remove();
                }, 30000);

                window.dispatchEvent(new CustomEvent(resultEvent, {
                    detail: { requestId, ok: true, mode: 'recorded-webm' }
                }));
                return;
            }

            const response = await fetch(sourceUrl);
            if (!response.ok) {
                throw new Error(`blob fetch failed: ${response.status}`);
            }

            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            link.style.display = 'none';
            document.documentElement.appendChild(link);
            link.click();
            window.setTimeout(() => {
                URL.revokeObjectURL(objectUrl);
                link.remove();
            }, 30000);

            window.dispatchEvent(new CustomEvent(resultEvent, {
                detail: { requestId, ok: true, mode: 'fetched-blob' }
            }));
        } catch (error) {
            window.dispatchEvent(new CustomEvent(resultEvent, {
                detail: {
                    requestId,
                    ok: false,
                    error: error && error.message ? error.message : String(error)
                }
            }));
        }
    });

    async function recordExistingBlobVideo(targetId) {
        const video = targetId
            ? document.querySelector(`video[data-instagram-video-controller-download-target="${targetId}"]`)
            : null;
        if (!video) {
            throw new Error('target video not found');
        }

        if (!Number.isFinite(video.duration) || video.duration <= 0) {
            throw new Error('video duration unavailable');
        }

        const stream = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
        if (!stream) {
            throw new Error('captureStream unavailable');
        }

        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
            ? 'video/webm;codecs=vp9,opus'
            : (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
                ? 'video/webm;codecs=vp8,opus'
                : 'video/webm');

        const chunks = [];
        const recorder = new MediaRecorder(stream, { mimeType });
        recorder.addEventListener('dataavailable', event => {
            if (event.data && event.data.size > 0) {
                chunks.push(event.data);
            }
        });

        const stopPromise = new Promise((resolve, reject) => {
            recorder.addEventListener('stop', resolve, { once: true });
            recorder.addEventListener('error', event => reject(event.error || new Error('media recorder failed')), { once: true });
        });

        const remainingMs = Math.max(1000, Math.ceil((video.duration - video.currentTime) * 1000) + 1000);
        recorder.start();
        if (video.paused) {
            await video.play();
        }

        await Promise.race([
            waitForEvent(video, 'ended'),
            waitForTimeout(remainingMs)
        ]);

        if (recorder.state !== 'inactive') {
            recorder.stop();
        }
        await stopPromise;

        if (chunks.length === 0) {
            throw new Error('recording produced no data');
        }

        return new Blob(chunks, { type: mimeType });
    }

    function waitForEvent(target, eventName) {
        return new Promise((resolve, reject) => {
            const onEvent = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(new Error(`${eventName} failed`));
            };
            const cleanup = () => {
                target.removeEventListener(eventName, onEvent);
                target.removeEventListener('error', onError);
            };
            target.addEventListener(eventName, onEvent, { once: true });
            target.addEventListener('error', onError, { once: true });
        });
    }

    function waitForTimeout(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }
})();
