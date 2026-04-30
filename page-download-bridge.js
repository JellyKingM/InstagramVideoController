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
                detail: { requestId, ok: true }
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
})();
