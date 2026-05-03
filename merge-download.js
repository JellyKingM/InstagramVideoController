(async function () {
    const statusEl = document.getElementById('status');

    function setStatus(text) {
        statusEl.textContent = text;
        console.log('[InstagramVideoController merge]', text);
    }

    function wait(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    function getToken() {
        const params = new URLSearchParams(location.search);
        return params.get('token') || '';
    }

    function waitForEvent(target, eventName) {
        return new Promise(resolve => {
            target.addEventListener(eventName, resolve, { once: true });
        });
    }

    async function loadJob(token) {
        return chrome.runtime.sendMessage({ getMergeJob: true, token });
    }

    async function clearJob(token) {
        try {
            await chrome.runtime.sendMessage({ clearMergeJob: true, token });
        } catch (error) {
            console.log('[InstagramVideoController merge]', 'failed to clear job', error);
        }
    }

    async function downloadBlob(blob, filename) {
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    }

    async function fetchAsObjectUrl(url, statusText) {
        setStatus(statusText);
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            throw new Error(`Fetch failed: ${response.status}`);
        }
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    }

    async function run() {
        const token = getToken();
        if (!token) {
            setStatus('Missing merge token.');
            return;
        }

        const job = await loadJob(token);
        if (!job || !job.bundle || !job.bundle.video || !job.bundle.audio) {
            setStatus('Merge job not found.');
            return;
        }

        const videoBlobUrl = await fetchAsObjectUrl(job.bundle.video.url, 'Fetching video track...');
        const audioBlobUrl = await fetchAsObjectUrl(job.bundle.audio.url, 'Fetching audio track...');

        const videoEl = document.createElement('video');
        const audioEl = document.createElement('audio');
        videoEl.crossOrigin = 'anonymous';
        audioEl.crossOrigin = 'anonymous';
        videoEl.playsInline = true;
        audioEl.playsInline = true;
        videoEl.muted = true;
        audioEl.muted = false;
        audioEl.volume = 1;
        videoEl.src = videoBlobUrl;
        audioEl.src = audioBlobUrl;
        videoEl.style.display = 'none';
        audioEl.style.display = 'none';
        document.body.appendChild(videoEl);
        document.body.appendChild(audioEl);

        setStatus('Loading video and audio...');
        await Promise.all([
            waitForEvent(videoEl, 'canplaythrough'),
            waitForEvent(audioEl, 'canplaythrough')
        ]);

        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
            ? 'video/webm;codecs=vp9,opus'
            : 'video/webm;codecs=vp8,opus';
        const chunks = [];

        setStatus('Merging... This runs in real time.');
        await Promise.allSettled([
            videoEl.play(),
            audioEl.play()
        ]);
        await wait(200);

        const videoStream = videoEl.captureStream();
        const audioStream = audioEl.captureStream();
        const stream = new MediaStream();
        videoStream.getVideoTracks().forEach(track => {
            stream.addTrack(track);
        });
        audioStream.getAudioTracks().forEach(track => {
            stream.addTrack(track);
        });

        if (stream.getVideoTracks().length === 0) {
            throw new Error('No video track captured.');
        }
        if (stream.getAudioTracks().length === 0) {
            throw new Error('No audio track captured.');
        }

        const recorder = new MediaRecorder(stream, { mimeType });
        recorder.addEventListener('dataavailable', event => {
            if (event.data && event.data.size > 0) {
                chunks.push(event.data);
            }
        });

        const stopPromise = new Promise(resolve => {
            recorder.addEventListener('stop', resolve, { once: true });
        });

        recorder.start(1000);

        const finished = new Promise(resolve => {
            let done = 0;
            const markDone = () => {
                done += 1;
                if (done >= 2) resolve();
            };
            videoEl.addEventListener('ended', markDone, { once: true });
            audioEl.addEventListener('ended', markDone, { once: true });
        });

        await finished;
        recorder.stop();
        await stopPromise;

        const blob = new Blob(chunks, { type: mimeType });
        setStatus('Saving merged file...');
        await downloadBlob(blob, job.filename || 'instagram-video.webm');
        await clearJob(token);
        URL.revokeObjectURL(videoBlobUrl);
        URL.revokeObjectURL(audioBlobUrl);
        setStatus('Done. This tab will close.');
        await wait(1200);
        window.close();
    }

    try {
        await run();
    } catch (error) {
        setStatus(`Merge failed: ${error && error.message ? error.message : error}`);
    }
})();
