// 옵션 설정 및 초기화
const options = {
    splitScreenV: true,
    alwaysShowV: true,
    videoControllerV: true,
    rememberVolumeV: true,
    volumeMute: false,
    volumeSliderV: 0.5,
    rememberVideoV: true,
    playbackRateV: 1,
    playbackStepV: 0.125,
    backwardIntervalV: 3,
    forwardIntervalV: 3
};

// 로컬 스토리지에서 옵션 불러오기
function loadOptionsFromLocalStorage() {
    console.log("Loading saved volume and mute status from localStorage");
    const savedVolume = localStorage.getItem('volumeSliderV');
    const savedMuteStatus = localStorage.getItem('volumeMute');

    if (savedVolume !== null) {
        options.volumeSliderV = parseFloat(savedVolume);
        console.log(`Loaded volume: ${options.volumeSliderV}`);
    }

    if (savedMuteStatus !== null) {
        options.volumeMute = (savedMuteStatus === 'true');
        console.log(`Loaded mute status: ${options.volumeMute}`);
    }
}

// 볼륨 상태 업데이트 및 저장
function updateVolume(newVolume) {
    console.log(`Updating volume to: ${newVolume}`);
    options.volumeSliderV = newVolume;
    localStorage.setItem('volumeSliderV', newVolume);
    applyVolumeToAllVideos();
}

// 모든 비디오에 볼륨 상태 적용
function applyVolumeToAllVideos() {
    document.querySelectorAll('video').forEach(videoElement => {
        videoElement.volume = options.volumeSliderV;
    });
}

// 음소거 상태 업데이트 및 저장
function updateMuteStatus(isMuted) {
    console.log(`Updating mute status to: ${isMuted}`);
    options.volumeMute = isMuted;
    localStorage.setItem('volumeMute', isMuted);
    applyMuteStatusToAllVideos();
    updateMuteButtonImage();
}

// 모든 비디오에 음소거 상태 적용
function applyMuteStatusToAllVideos() {
    document.querySelectorAll('video').forEach(videoElement => {
        videoElement.muted = options.volumeMute;
        console.log("Video muted status updated.");
    });
}

// 음소거 버튼 이미지 업데이트
function updateMuteButtonImage() {
    document.querySelectorAll(".muteBox img").forEach(imgElement => {
        imgElement.src = options.volumeMute ? chrome.runtime.getURL("muted.png") : chrome.runtime.getURL("unmuted.png");
        imgElement.style.margin = "auto";
        imgElement.style.display = "block";
        imgElement.style.userSelect = 'none';
        imgElement.style.pointerEvents = 'none';
    });
}

// 음소거 버튼 생성
function createMuteButton() {
    console.log("Creating mute button.");
    const muteButtonWrapper = document.createElement('div');
    muteButtonWrapper.classList.add('jellyking-mute-button');
    muteButtonWrapper.style.cssText = `
        width: 36px;
        height: 44px;
        position: relative;
        cursor: pointer;
        border-radius: 50%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        margin-bottom: 20px;
    `;

    const imgElement = document.createElement('img');
    imgElement.src = options.volumeMute ? chrome.runtime.getURL("muted.png") : chrome.runtime.getURL("unmuted.png");
    imgElement.style.cssText = `
        width: 20px;
        height: 20px;
        margin-bottom: 4px;
        user-select: none;
        pointer-events: none;
    `;
    imgElement.classList.add('jellyking-img');

    const textElement = document.createElement('span');
    textElement.textContent = options.volumeMute
        ? chrome.i18n.getMessage("muteText")
        : chrome.i18n.getMessage("unmuteText");
    textElement.style.cssText = `
        font-size: 12px;
        color: black;
        text-align: center;
        visibility: visible;
        white-space: nowrap;
    `;
    textElement.classList.add('jellyking-text');

    muteButtonWrapper.appendChild(imgElement);
    muteButtonWrapper.appendChild(textElement);

    muteButtonWrapper.addEventListener('mouseover', () => {
        muteButtonWrapper.style.opacity = '0.5';
    });

    muteButtonWrapper.addEventListener('mouseout', () => {
        muteButtonWrapper.style.opacity = '1';
    });

    muteButtonWrapper.addEventListener('click', () => {
        updateMuteStatus(!options.volumeMute);
        imgElement.src = options.volumeMute ? chrome.runtime.getURL("muted.png") : chrome.runtime.getURL("unmuted.png");
        textElement.textContent = options.volumeMute
            ? chrome.i18n.getMessage("muteText")
            : chrome.i18n.getMessage("unmuteText");
    });

    return muteButtonWrapper;
}

// 비디오에 설정 적용
function applySettingsToVideo(videoElement) {
    console.log("Applying settings to video:", videoElement);
    if (options.videoControllerV) {
        videoElement.controls = true;
    }

    // 비디오의 음소거 상태 및 볼륨 설정
    videoElement.volume = options.volumeSliderV;
    videoElement.muted = options.volumeMute;

    videoElement.addEventListener('volumechange', () => {
        updateVolume(videoElement.volume);
    });

    videoElement.addEventListener('play', () => {
        videoElement.muted = options.volumeMute;
        console.log("Video is playing, mute state applied:", videoElement.muted);
    });
}

// 비디오 처리 함수
function processUnexpandedVideos() {
    console.log("Processing unexpanded videos.");
    const videoElements = document.querySelectorAll('video');
    if (videoElements.length === 0) return;

    videoElements.forEach(videoElement => {
        if (!videoElement.dataset.processed) {
            videoElement.dataset.processed = true;
            applySettingsToVideo(videoElement);
        }
    });
}

// DOM 변경 감지
function setupDOMChangeListener() {
    console.log("Setting up DOM change listener.");
    const observer = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.tagName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
                    console.log("New video element detected.");
                    processUnexpandedVideos();
                }
            });
        });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

// 페이지가 로드되었을 때 실행되는 함수
function onPageLoad() {
    console.log("Page load detected, processing videos.");
    processUnexpandedVideos();
}

// 페이지 로드 대기
function waitForPageLoad() {
    console.log("Waiting for page load.");
    const checkInterval = setInterval(() => {
        if (document.readyState === 'complete') {
            clearInterval(checkInterval);
            onPageLoad();
        }
    }, 100);
}

// 초기화
function initialize() {
    loadOptionsFromLocalStorage();
    waitForPageLoad();
    setupDOMChangeListener();
}

// 초기화 호출
initialize();
