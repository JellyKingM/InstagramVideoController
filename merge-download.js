(async function () {
    const statusEl = document.getElementById('status');
    let mp4boxModule = null;

    function setStatus(text) {
        statusEl.textContent = text;
    }

    function wait(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    function getToken() {
        const params = new URLSearchParams(location.search);
        return params.get('token') || '';
    }

    async function loadJob(token) {
        return chrome.runtime.sendMessage({ getMergeJob: true, token });
    }

    async function clearJob(token) {
        try {
            await chrome.runtime.sendMessage({ clearMergeJob: true, token });
        } catch (_error) {
        }
    }

    async function ensureMp4Box() {
        if (mp4boxModule && typeof mp4boxModule.createFile === 'function') {
            return;
        }

        mp4boxModule = await import(chrome.runtime.getURL('vendor/mp4box.all.js'));

        if (!mp4boxModule || typeof mp4boxModule.createFile !== 'function') {
            throw new Error('MP4Box library not loaded.');
        }
    }

    function getCreateFile() {
        if (!mp4boxModule || typeof mp4boxModule.createFile !== 'function') {
            throw new Error('MP4Box library not loaded.');
        }
        return mp4boxModule.createFile;
    }

    async function fetchArrayBuffer(url, statusText) {
        setStatus(statusText);
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            throw new Error(`Fetch failed: ${response.status}`);
        }
        return response.arrayBuffer();
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

    function appendWholeBuffer(mp4boxFile, arrayBuffer) {
        const buffer = arrayBuffer.slice(0);
        buffer.fileStart = 0;
        mp4boxFile.appendBuffer(buffer);
        mp4boxFile.flush();
    }

    function getPrimaryTrack(info, kind) {
        if (kind === 'video') {
            return (info.videoTracks && info.videoTracks[0]) || info.tracks.find(track => track.video);
        }
        if (kind === 'audio') {
            return (info.audioTracks && info.audioTracks[0]) || info.tracks.find(track => track.audio);
        }
        return info.tracks[0] || null;
    }

    function parseMp4ForSamples(arrayBuffer, kind) {
        return new Promise((resolve, reject) => {
            const mp4boxFile = getCreateFile()();
            let trackInfo = null;
            let expectedSamples = 0;
            const allSamples = [];
            let resolved = false;

            function finish() {
                if (resolved) return;
                if (!trackInfo) return;
                if (allSamples.length < expectedSamples) return;
                resolved = true;
                const trak = mp4boxFile.getTrackById(trackInfo.id);
                const sampleDescription = trak && trak.mdia && trak.mdia.minf && trak.mdia.minf.stbl
                    ? trak.mdia.minf.stbl.stsd.entries[0]
                    : null;
                resolve({
                    info: trackInfo,
                    trak,
                    sampleDescription,
                    samples: allSamples
                });
            }

            mp4boxFile.onError = error => {
                if (resolved) return;
                resolved = true;
                reject(new Error(`${kind} parse failed: ${error}`));
            };

            mp4boxFile.onReady = info => {
                trackInfo = getPrimaryTrack(info, kind);
                if (!trackInfo) {
                    resolved = true;
                    reject(new Error(`No ${kind} track found.`));
                    return;
                }
                expectedSamples = Number(trackInfo.nb_samples || 0);
                mp4boxFile.setExtractionOptions(trackInfo.id, null, {
                    nbSamples: Math.max(expectedSamples, 1)
                });
                mp4boxFile.start();
            };

            mp4boxFile.onSamples = (trackId, user, samples) => {
                if (!trackInfo || trackId !== trackInfo.id) {
                    return;
                }
                allSamples.push(...samples);
                finish();
            };

            appendWholeBuffer(mp4boxFile, arrayBuffer);

            window.setTimeout(() => {
                if (!resolved && trackInfo && allSamples.length >= expectedSamples) {
                    finish();
                } else if (!resolved && trackInfo && allSamples.length > 0) {
                    resolved = true;
                    const trak = mp4boxFile.getTrackById(trackInfo.id);
                    const sampleDescription = trak && trak.mdia && trak.mdia.minf && trak.mdia.minf.stbl
                        ? trak.mdia.minf.stbl.stsd.entries[0]
                        : null;
                    resolve({
                        info: trackInfo,
                        trak,
                        sampleDescription,
                        samples: allSamples
                    });
                } else if (!resolved) {
                    resolved = true;
                    reject(new Error(`No ${kind} samples extracted.`));
                }
            }, 200);
        });
    }

    function cloneDescriptionBoxes(sampleDescription) {
        if (!sampleDescription || !Array.isArray(sampleDescription.boxes)) {
            return [];
        }
        return sampleDescription.boxes.slice();
    }

    function buildTrackOptions(parsed, nextId) {
        const { info, sampleDescription } = parsed;
        const isVideo = !!info.video;
        const type = sampleDescription && sampleDescription.type
            ? sampleDescription.type
            : (isVideo ? 'avc1' : 'mp4a');

        const options = {
            id: nextId,
            type,
            timescale: info.timescale,
            media_duration: info.duration,
            duration: info.movie_duration || info.duration,
            language: info.language || 'und',
            hdlr: isVideo ? 'vide' : 'soun',
            name: isVideo ? 'VideoHandler' : 'SoundHandler',
            default_sample_description_index: 1,
            description_boxes: cloneDescriptionBoxes(sampleDescription)
        };

        if (isVideo) {
            options.width = Math.round(info.video.width || info.track_width || 0);
            options.height = Math.round(info.video.height || info.track_height || 0);
        } else {
            options.channel_count = info.audio.channel_count || 2;
            options.samplesize = info.audio.sample_size || 16;
            options.samplerate = info.audio.sample_rate || info.timescale;
        }

        return options;
    }

    function mergeSamplesByDts(videoSamples, audioSamples) {
        const merged = [];
        let videoIndex = 0;
        let audioIndex = 0;

        while (videoIndex < videoSamples.length || audioIndex < audioSamples.length) {
            const nextVideo = videoSamples[videoIndex];
            const nextAudio = audioSamples[audioIndex];

            if (!nextAudio || (nextVideo && nextVideo.dts <= nextAudio.dts)) {
                merged.push({ kind: 'video', sample: nextVideo });
                videoIndex += 1;
            } else {
                merged.push({ kind: 'audio', sample: nextAudio });
                audioIndex += 1;
            }
        }

        return merged;
    }

    function toUint8Array(sampleData) {
        if (sampleData instanceof Uint8Array) {
            return sampleData;
        }
        return new Uint8Array(sampleData);
    }

    function remuxToMp4(videoParsed, audioParsed) {
        const output = getCreateFile()();
        const videoTrackId = output.addTrack(buildTrackOptions(videoParsed, 1));
        const audioTrackId = output.addTrack(buildTrackOptions(audioParsed, 2));
        const orderedSamples = mergeSamplesByDts(videoParsed.samples, audioParsed.samples);

        orderedSamples.forEach(({ kind, sample }) => {
            output.addSample(kind === 'video' ? videoTrackId : audioTrackId, toUint8Array(sample.data), {
                sample_description_index: 1,
                duration: sample.duration,
                cts: sample.cts,
                dts: sample.dts,
                is_sync: !!sample.is_rap,
                offset: 0
            });
        });

        const stream = output.getBuffer();
        return stream.buffer.slice(0);
    }

    async function run() {
        await ensureMp4Box();

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

        setStatus('Fetching video track...');
        const videoBuffer = await fetchArrayBuffer(job.bundle.video.url, 'Fetching video track...');
        const audioBuffer = await fetchArrayBuffer(job.bundle.audio.url, 'Fetching audio track...');

        setStatus('Parsing video track...');
        const videoParsed = await parseMp4ForSamples(videoBuffer, 'video');
        setStatus(`Video samples: ${videoParsed.samples.length}`);

        setStatus('Parsing audio track...');
        const audioParsed = await parseMp4ForSamples(audioBuffer, 'audio');
        setStatus(`Audio samples: ${audioParsed.samples.length}`);

        setStatus('Remuxing tracks to MP4...');
        const mergedBuffer = remuxToMp4(videoParsed, audioParsed);
        const mergedBlob = new Blob([mergedBuffer], { type: 'video/mp4' });

        setStatus('Saving merged MP4...');
        await downloadBlob(mergedBlob, job.filename || 'instagram-video.mp4');
        await clearJob(token);
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
