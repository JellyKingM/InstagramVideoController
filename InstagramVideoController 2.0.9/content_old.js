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

// 로컬 스토리지에서 볼륨과 음소거 상태 불러오기
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

// 볼륨 상태 업데이트 및 저장
const updateVolume = (newVolume) => {
    console.log(`Updating volume to: ${newVolume}`);
    options.volumeSliderV = newVolume;
    localStorage.setItem('volumeSliderV', newVolume);
    document.querySelectorAll('video').forEach(videoElement => {
        videoElement.volume = options.volumeSliderV;
    });
};

// 음소거 상태 업데이트 및 저장
const updateMuteStatus = (isMuted) => {
    console.log(`Updating mute status to: ${isMuted}`);
    options.volumeMute = isMuted;
    localStorage.setItem('volumeMute', isMuted);
    document.querySelectorAll('video').forEach(videoElement => {
        videoElement.muted = isMuted;
        console.log("Video muted status updated.");
    });

    // 음소거 버튼의 이미지 및 스타일 설정
    document.querySelectorAll(".muteBox img").forEach(imgElement => {
        imgElement.src = options.volumeMute ? chrome.runtime.getURL("muted.png") : chrome.runtime.getURL("unmuted.png");
        imgElement.style.margin = "auto";
        imgElement.style.display = "block";
        imgElement.style.userSelect = 'none';
        imgElement.style.pointerEvents = 'none';
    });
};

// 음소거 버튼 생성
const createMuteButton = () => {
    console.log("Creating mute button.");
    const muteButtonWrapper = document.createElement('div');
    muteButtonWrapper.style.width = '36px';
    muteButtonWrapper.style.height = '44px';
    muteButtonWrapper.style.position = 'relative';
    muteButtonWrapper.style.cursor = 'pointer';
    muteButtonWrapper.style.borderRadius = '50%';
    muteButtonWrapper.style.display = 'flex';
    muteButtonWrapper.style.flexDirection = 'column';
    muteButtonWrapper.style.alignItems = 'center';
    muteButtonWrapper.style.justifyContent = 'center';
    muteButtonWrapper.style.marginBottom = '20px';
    muteButtonWrapper.classList.add('jellyking-mute-button');

    const imgElement = document.createElement('img');
    imgElement.src = options.volumeMute ? chrome.runtime.getURL("muted.png") : chrome.runtime.getURL("unmuted.png");
    imgElement.style.width = '20px';
    imgElement.style.height = '20px';
    imgElement.style.marginBottom = '4px';
    imgElement.style.userSelect = 'none';
    imgElement.style.pointerEvents = 'none';
    imgElement.classList.add('jellyking-img');

    const textElement = document.createElement('span');
    textElement.textContent = options.volumeMute
        ? chrome.i18n.getMessage("muteText")
        : chrome.i18n.getMessage("unmuteText");
    textElement.style.fontSize = '12px';
    textElement.style.color = 'black';
    textElement.style.textAlign = 'center';
    textElement.style.visibility = 'visible';
    textElement.style.textWrap = 'nowrap';
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
};

const expandedVideos = {};

function processUnexpandedVideos() {
    console.log("Processing unexpanded videos.");
    const videoElements = document.querySelectorAll('video');
    if (videoElements.length == 0) return;

    videoElements.forEach(videoElement => {
        if (!videoElement.dataset.processed) {
            videoElement.dataset.processed = true;
            applySettingsToVideo(videoElement);
        }
    });

    // 메인페이지 비디오 볼륨 컨트롤러
    applyCustomVolumeControl();
    setupDOMChangeListener();
}

// 페이지 주소에 따라 다르게 작동하기
// 0. 모든 페이지에서 작동하는 기능
// 로컬 스토리지에서 볼륨과 음소거 상태를 불러오고, 모든 비디오가 재생될때마다 해당 상태를 적용한다
// 1. instagram/reels/* 의 경우
// 블랙박스에 포함되는 볼륨 슬라이더와 음소거 버튼은 로컬 스토리지 변수값으로 저장되어 모든 비디오에 동시에 적용된다
// 배속 기능은 현재 보고있는 비디오 하나에만 적용된다
// 2. instagram/reel/* 또는 instagram/p/* 의 경우
// 페이지가 열리면 해당 페이지의 가장 메인 비디오를 찾은 다음, 비디오의 다음형제 요소 A 를 찾는다
// A 요소의 자식중에 Button 에 해당하는 요소를 찾은 뒤, 해당 버튼을 비디오의 다음 형제 위치에 옮긴다
// A 요소를 display:none 으로 설정한다
// 1번의 블랙박스와 동일한 방식으로 볼륨 슬라이더와 음소거 버튼을 추가한다
// 3. 1번과 2번에 해당하지 않는 경우
// 인스타그램 메인페이지. 즉 피드 화면에 해당하는 내용으로, 화면 좌측 하단에 포지션을 이용해
// 볼륨 슬라이더와 음소거 버튼을 추가하고 위치를 고정한다. 여러개의 비디오가 페이지에 동시에 존재하기 때문에
// 비디오를 특정할 수 없으므로 배속기능은 지원하지 않는다. (비디오 컨트롤러에서 자체적으로 지원되므로)

function applySettingsToVideo(videoElement) {
    console.log("Applying settings to video:", videoElement);
    // instagram.com/reels/* 전용
    if (window.location.href.includes("reels")) {
        if (expandedVideos[videoElement.src]) {
            let seventhParent = videoElement;
            for (let i = 0; i < 7 && seventhParent; i++) {
                seventhParent = seventhParent.parentElement;
            }
            try {
                // null 체크 추가
                if (seventhParent && seventhParent.previousSibling && seventhParent.previousSibling.children[0]) {
                    seventhParent.previousSibling.children[0].style.maxHeight = '100%';
                }
            } catch (error) {
                console.error("Error in expanding video:", error);
            }
            return;
        }
        // 비디오 설명파트 찾기
        let redElement = videoElement.nextElementSibling;
        for (let i = 0; i < 5 && redElement; i++) {
            redElement = redElement.children[0];
        }
        redElement = redElement ? redElement.nextElementSibling.children[0] : null;
        redElement.classList.add("jellyking-red-element");
        redElement.style.maxHeight = '90%';
        processOptions(options, videoElement, redElement);
    }

    if (options.videoControllerV) {
        videoElement.controls = true;
    }

    let fifthParent = videoElement;
    for (let i = 0; i < 5 && fifthParent; i++) {
        fifthParent = fifthParent.parentElement;
    }
    fifthParent.classList.add("jellyking-fifth-parent");

    // fifthParent의 다음 형제 요소 찾기 및 숨기기
    if (fifthParent && fifthParent.nextElementSibling) {
        fifthParent.nextElementSibling.style.display = 'none';
        console.log("Hidden the next sibling of the fifth parent");
    } else {
        console.log("No next sibling found for the fifth parent");
    }
}

function processOptions(options, videoElement, redElement) {
    console.log("Processing options for video:", videoElement);

    if (options.rememberVideoV) {
        videoElement.playbackRate = options.playbackRateV || 1;
        videoElement.playbackStep = options.playbackStepV || 0.125;
        videoElement.forwardInterval = options.forwardIntervalV || 3;
        videoElement.backwardInterval = options.backwardIntervalV || 3;
    }

    if (options.rememberVolumeV) {
        videoElement.volume = options.volumeSliderV;
    }

    videoElement.addEventListener('volumechange', () => {
        updateVolume(videoElement.volume);
    });

    videoElement.addEventListener('play', () => {
        videoElement.muted = options.volumeMute;
        console.log("Video is playing, mute state applied:", videoElement.muted);
    });

    if (window.location.href.includes("reels") && options.splitScreenV) {
        const blackBox = document.createElement('div');
        blackBox.style.position = 'relative';

        // 1. 비디오의 다음 형제 요소(x)에 클릭 이벤트 발생
        const nextSibling = videoElement.nextElementSibling;
        if (nextSibling) {
            nextSibling.click();
            console.log("Clicked on the next sibling of the video element");

            // 2. 음소거 버튼을 블랙박스 내 볼륨 슬라이더 우측으로 이동
            const muteButton = nextSibling.querySelector('div[role="button"]');
            if (muteButton) {
                muteButton.click();
                const volumeSlider = blackBox.querySelector('input[type="range"]');
                if (volumeSlider) {
                    muteButton.style.position = 'absolute';
                    muteButton.style.right = '10px';
                    muteButton.style.bottom = '10px';
                    blackBox.appendChild(muteButton);
                    console.log("Moved mute button to the right of the volume slider");
                }
            }

            // 3. 다음 형제 요소(x)를 숨김
            nextSibling.style.display = 'none';
            console.log("Hidden the next sibling of the video element");
        }

        if (redElement && redElement.nextElementSibling) {
            blackBox.style.width = redElement.nextElementSibling.offsetWidth + 'px';
            blackBox.style.height = redElement.nextElementSibling.offsetHeight + 'px';
            blackBox.style.backgroundColor = 'black';

            redElement.parentElement.insertBefore(blackBox, redElement.nextElementSibling);
        }

        let seventhParent = videoElement;
        for (let i = 0; i < 7 && seventhParent; i++) {
            seventhParent = seventhParent.parentElement;
        }

        // 블랙박스의 마지막 자식으로 배속 및 음량 조절 슬라이더를 추가
        createVolumeSliderAndSpeedButtons(blackBox, videoElement);

        if (redElement && seventhParent) {
            blackBox.style.width = videoElement.offsetWidth + 'px';
            blackBox.style.height = videoElement.offsetHeight + 'px';
            blackBox.style.backgroundColor = 'black';

            // 빨강의 텍스트를 확장하기
            redElement.classList.add("jellyking-red-element");
            redElement.children[1].click();

            // 빨강을 블랙박스로 옮기기
            blackBox.appendChild(redElement);
            seventhParent.parentElement.insertBefore(blackBox, seventhParent);

            const observer = new ResizeObserver(entries => {
                for (const entry of entries) {
                    if (entry.target === blackBox.nextElementSibling) {
                        blackBox.style.width = entry.contentRect.width + 'px';
                        blackBox.style.height = entry.contentRect.height + 'px';
                        break;
                    }
                }
            });

            observer.observe(blackBox.nextElementSibling);
        }

        const menuTop = blackBox.nextElementSibling.nextElementSibling;

        const muteButtonWrapper = createMuteButton();
        menuTop.insertBefore(muteButtonWrapper, menuTop.firstChild);
    }

    videoElement.addEventListener('mouseover', () => {
        videoElement.controls = true;
    });

    videoElement.addEventListener('mouseout', () => {
        videoElement.controls = false;
    });

    const blueElement = videoElement.nextElementSibling;
    if (blueElement) {
        blueElement.style.display = 'none';
    }
}

// 인스타그램의 음소거 버튼을 블랙박스에 추가하는 함수
function addInstagramMuteButtonToBlackBox(blackBox) {
    console.log("Adding Instagram mute button to black box.");

    // 음소거 버튼 래퍼 생성
    const muteButtonWrapper = createMuteButton();
    muteButtonWrapper.style.position = 'absolute';
    muteButtonWrapper.style.right = '10px';  // 오른쪽에 고정
    muteButtonWrapper.style.bottom = '10px';  // 아래쪽에 고정

    // 볼륨 슬라이더의 너비를 줄이고 음소거 버튼을 그 옆에 배치
    const volumeSlider = blackBox.querySelector('input[type="range"]');
    if (volumeSlider) {  // null 체크
        volumeSlider.style.width = 'calc(100% - 50px)';  // 50px 공간을 음소거 버튼용으로 확보
    } else {
        console.error("Volume slider element not found.");
    }
}

// 페이지가 완전히 로드되었을 때 실행
function onPageLoad() {
    console.log("Page load detected, processing videos.");
    processUnexpandedVideos();
}

// 페이지 로드 상태 감지
function waitForPageLoad() {
    console.log("Waiting for page load.");
    const checkInterval = setInterval(() => {
        if (document.readyState === 'complete') {
            clearInterval(checkInterval);
            onPageLoad();
        }
    }, 100);
}

// URL 변경 감지 및 DOM 로드 대기 후 처리
let currentHref = location.href;

function handleUrlChange() {
    if (currentHref !== location.href) {
        console.log("URL change detected.");
        currentHref = location.href;
        waitForPageLoad();
    }
}

// 처음 페이지 로드 시 실행
waitForPageLoad();

// URL 변경 감지
window.addEventListener('popstate', handleUrlChange);
window.addEventListener('hashchange', handleUrlChange);

// MutationObserver를 사용하여 DOM 변경 감지 및 비디오 요소 처리
const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.tagName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
                console.log("New video element detected.");
                processUnexpandedVideos();
                // 반복 재생 시 음소거 및 볼륨 상태 유지
                node.addEventListener('ended', () => { // videoElement 대신 node 사용
                    console.log(`Video ended, restarting with mute: ${options.volumeMute}`);
                    node.muted = options.volumeMute;  // 사용자가 설정한 음소거 상태를 유지
                    node.volume = options.volumeSliderV;  // 사용자가 설정한 볼륨을 유지
                    node.play().catch(error => {
                        console.error("Autoplay failed:", error);
                    });
                });
            }
        });
    });
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// 배속 버튼 및 음량 조절 슬라이더 생성 함수
function createVolumeSliderAndSpeedButtons(blackBox, videoElement) {
    console.log("Creating volume slider and speed buttons.");
    const controlsContainer = document.createElement('div');
    controlsContainer.style.position = "absolute";
    controlsContainer.style.bottom = "0";
    controlsContainer.style.width = "100%";
    controlsContainer.style.padding = "10px";
    controlsContainer.style.boxSizing = "border-box";
    controlsContainer.style.backgroundColor = "rgba(0, 0, 0, 0.5)"; // 배경 추가

    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.min = 0;
    volumeSlider.max = 1;
    volumeSlider.step = 0.01;
    volumeSlider.value = options.volumeSliderV;
    volumeSlider.style.display = "block";
    volumeSlider.style.width = "100%"; // 슬라이더를 꽉 차게 설정
    volumeSlider.style.marginBottom = "10px";
    volumeSlider.addEventListener('input', () => {
        updateVolume(volumeSlider.value);
    });

    const speedButtonContainer = document.createElement('div');
    speedButtonContainer.style.display = "flex";
    speedButtonContainer.style.justifyContent = "space-between"; // 버튼 간격을 균등하게 설정

    const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];
    const buttonWidth = `${100 / playbackRates.length}%`; // 각 버튼의 너비를 계산

    playbackRates.forEach(rate => {
        const rateButton = document.createElement('button');
        rateButton.textContent = `${rate}x`;
        rateButton.style.width = buttonWidth; // 버튼 너비 설정
        rateButton.style.padding = '5px 0'; // 상하 패딩만 추가
        rateButton.style.border = 'none';
        rateButton.style.backgroundColor = '#f0f0f0';
        rateButton.style.cursor = 'pointer';

        rateButton.addEventListener('click', () => {
            videoElement.playbackRate = rate;
            console.log(`Playback rate set to: ${rate}`);
            updateActiveSpeedButton(speedButtonContainer, rate);
        });

        speedButtonContainer.appendChild(rateButton);
    });

    controlsContainer.appendChild(volumeSlider);
    controlsContainer.appendChild(speedButtonContainer);

    blackBox.appendChild(controlsContainer);

    // 초기 활성 버튼 설정
    updateActiveSpeedButton(speedButtonContainer, videoElement.playbackRate);
}

// 활성 배속 버튼 업데이트 함수
function updateActiveSpeedButton(container, currentRate) {
    container.querySelectorAll('button').forEach(button => {
        const buttonRate = parseFloat(button.textContent);
        if (buttonRate === currentRate) {
            button.style.backgroundColor = '#4CAF50';
            button.style.color = 'white';
        } else {
            button.style.backgroundColor = '#f0f0f0';
            button.style.color = 'black';
        }
    });
}

// 배속 단축키 기능 추가
document.addEventListener('keydown', (event) => {
    const videoElements = document.querySelectorAll('video');
    if (videoElements.length === 0) return;

    const currentRate = videoElements[0].playbackRate;
    const step = 0.25;

    if (event.key === 'ArrowUp') {
        videoElements.forEach(video => {
            video.playbackRate = Math.min(currentRate + step, 2.5);
            console.log(`Increased playback rate to: ${video.playbackRate}`);
        });
    } else if (event.key === 'ArrowDown') {
        videoElements.forEach(video => {
            video.playbackRate = Math.max(currentRate - step, 0.5);
            console.log(`Decreased playback rate to: ${video.playbackRate}`);
        });
    }
});

function applyCustomVolumeControl() {
    if (!window.location.href.includes("instagram.com") || window.location.href.includes("reels")) {
        console.log("Custom volume control is only for the Instagram main page.");
        return;
    }

    const volumeValue = localStorage.getItem('customVolume') || 0.5; // 로컬에서 볼륨값 불러오기, 기본값 0.5
    document.querySelectorAll('video').forEach(video => {
        video.volume = volumeValue; // 모든 비디오에 볼륨값 적용
        video.nextElementSibling.style.display = 'none'; // 모든 비디오의 다음 형제요소 숨기기
    });

    // 컨트롤러를 추가할 상위 요소를 찾기 (좌측 컨테이너)
    const divWidth = document.querySelector('.x9f619.xjbqb8w.x78zum5.x168nmei.x13lgxp2.x5pf9jr.xo71vjh.xixxii4.x13vifvy.x1plvlek.xryxfnj.x1c4vz4f.x2lah0s.xdt5ytf.xqjyukv.x1qjc9v5.x1oa3qoh.x1nhvcw1.x1dr59a3.xeq5yr9.x1n327nk');

    // 컨트롤러 컨테이너가 이미 존재하는지 확인
    let controlContainer = document.querySelector('.jellyking-control-container');
    if (!controlContainer) {
        // 컨트롤러 컨테이너 생성 및 스타일 설정
        controlContainer = document.createElement('div');
        controlContainer.classList.add('jellyking-control-container');
        controlContainer.style.position = 'absolute';
        controlContainer.style.display = 'flex';
        controlContainer.style.alignItems = 'center';
        controlContainer.style.justifyContent = 'space-between';
        controlContainer.style.padding = '10px';
        controlContainer.style.backgroundColor = '#000000';
        controlContainer.style.color = '#ffffff';
        controlContainer.style.borderRadius = '10px';
        controlContainer.style.zIndex = '10000'; // 컨테이너의 z-index 값을 10000으로 설정
        controlContainer.style.bottom = '50px'; // 컨테이너의 bottom 좌표를 0으로 설정

        divWidth.appendChild(controlContainer); // 컨테이너를 divWidth 요소 하위에 추가
    }

    controlContainer.style.left = `${divWidth.offsetWidth}px`; // 컨테이너의 left 좌표를 divWidth의 너비값으로 설정

    // 볼륨 슬라이더와 음소거 버튼 생성 및 컨테이너에 추가
    let volumeSlider = document.querySelector('.jellyking-volume-slider');
    let muteButton = document.querySelector('.jellyking-mute-button');

    if (!volumeSlider) {
        volumeSlider = document.createElement('input');
        volumeSlider.type = 'range';
        volumeSlider.min = 0;
        volumeSlider.max = 1;
        volumeSlider.step = 0.01;
        volumeSlider.value = volumeValue;
        volumeSlider.classList.add('jellyking-volume-slider');
        controlContainer.appendChild(volumeSlider); // 슬라이더를 컨테이너에 추가
    }

    if (!muteButton) {
        muteButton = document.createElement('button');
        muteButton.textContent = 'Mute';
        muteButton.classList.add('jellyking-mute-button');
        controlContainer.appendChild(muteButton); // 버튼을 컨테이너에 추가
    }

    // 볼륨 슬라이더 이벤트 리스너 재설정
    volumeSlider.oninput = (e) => {
        const newVolume = e.target.value;
        document.querySelectorAll('video').forEach(video => video.volume = newVolume); // 모든 비디오 볼륨 업데이트
        localStorage.setItem('customVolume', newVolume); // 새 볼륨값 로컬에 저장
    };

    // 음소거 버튼 이벤트 리스너 재설정
    muteButton.onclick = () => {
        document.querySelectorAll('video').forEach(video => {
            video.muted = !video.muted;
        });
    };
}

// content.js 파일 내용 수정
function setupDOMChangeListener() {
    const targetDiv = document.querySelector('.x9f619.xjbqb8w.x78zum5.x168nmei.x13lgxp2.x5pf9jr.xo71vjh.x1uhb9sk.x1plvlek.xryxfnj.x1c4vz4f.x2lah0s.xdt5ytf.xqjyukv.x1qjc9v5.x1oa3qoh.x1nhvcw1');
    if (!targetDiv) {
        console.log("Target div not found.");
        return;
    }

    const config = { childList: true, subtree: true };

    const callback = function(mutationsList, observer) {
        for(const mutation of mutationsList) {
            if (mutation.type === 'childList') {
                applyCustomVolumeControl();
                break;
            }
        }
    };

    const observer = new MutationObserver(callback);
    observer.observe(targetDiv, config);
}