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
const savedVolume = localStorage.getItem('volumeSliderV');
// const savedMuteStatus = localStorage.getItem('volumeMute');

if (savedVolume !== null) {
    options.volumeSliderV = parseFloat(savedVolume);
}

// 볼륨과 음소거 상태를 변경할 때마다 로컬 스토리지와 options 객체 업데이트
const updateVolume = (newVolume) => {
    options.volumeSliderV = newVolume;
    localStorage.setItem('volumeSliderV', newVolume);
    document.querySelectorAll('video').forEach(videoElement => {
        videoElement.volume = options.volumeSliderV;
    });
};

const updateMuteStatus = (isMuted) => {
    options.volumeMute = isMuted;
    localStorage.setItem('volumeMute', isMuted);
    document.querySelectorAll('video').forEach(videoElement => {
        videoElement.muted = true;
        console.log("Video Muted");
        setTimeout(() => {
            videoElement.muted = options.volumeMute;
            console.log("Video Muted set by valuable");
        }, 100);
    });

    document.querySelectorAll(".muteBox").forEach(element => {
        element.children[0].style.backgroundImage = options.volumeMute ? `url(${chrome.runtime.getURL("muted.png")})` : `url(${chrome.runtime.getURL("unmuted.png")})`;
        element.children[1].innerText = options.volumeMute ? 'Muted' : 'Unmuted';  // Set text based on mute state
    });
};

const adjustContentHeight = (contentElement) => {
    if (contentElement.scrollHeight > contentElement.clientHeight) {
        contentElement.style.height = `${contentElement.clientHeight + 10}px`;
        adjustContentHeight(contentElement);
    }
};

const expandedVideos = {};

function processUnexpandedVideos() {
    const videoElements = document.querySelectorAll('video');
    if (videoElements.length == 0) return;

    videoElements.forEach(videoElement => {
        if (expandedVideos[videoElement.src]) {
            let seventhParent = videoElement;
            for (let i = 0; i < 7 && seventhParent; i++) {
                seventhParent = seventhParent.parentElement;
            }
            try {
                seventhParent.previousSibling.children[0].style.maxHeight = '100%';
            } catch (error) {}
            return;
        }

        if (options.videoControllerV) {
            videoElement.controls = true;
        }

        let redElement = videoElement.nextElementSibling;
        for (let i = 0; i < 5 && redElement; i++) {
            redElement = redElement.children[0];
        }
        redElement = redElement ? redElement.nextElementSibling.children[0] : null;

        processOptions(options, videoElement, redElement);

        // 5번째 부모의 앞 형제 요소를 제거
        let fifthParent = videoElement;
        for (let i = 0; i < 5 && fifthParent; i++) {
            fifthParent = fifthParent.parentElement;
        }

        if (fifthParent && fifthParent.previousSibling) {
            fifthParent.previousSibling.remove();
        }
    });
}

function processOptions(options, videoElement, redElement) {
    console.log(videoElement);

    if (options.rememberVideoV) {
        videoElement.playbackRate = options.playbackRateV || 1;
        videoElement.playbackStep = options.playbackStepV || 0.125;
        videoElement.forwardInterval = options.forwardIntervalV || 3;
        videoElement.backwardInterval = options.backwardIntervalV || 3;
    }

    // 릴, 릴스, 포스트 페이지 모두에서 작동
    if (options.rememberVolumeV) {
        videoElement.volume = options.volumeSliderV;
        // videoElement.muted = true;
    }

    videoElement.addEventListener('volumechange', () => {
        updateVolume(videoElement.volume);
        // updateMuteStatus(options.volumeMute);
    });

    // 여기서부터는 릴스 페이지에서만 작동
    if (window.location.href.includes("reels") && options.splitScreenV) {

        const blackBox = document.createElement('div');

        // 3-1. 항상 펼치기 기능 체크시 실행됨
        if (options.alwaysShowV && redElement && redElement.children.length > 0) {
            // 아래 moreButton 에 대해 이하 더보기영역 으로 호명
            const moreButton = redElement.children[0].nextElementSibling;
            if (moreButton) {
                moreButton.click();
                expandedVideos[videoElement.src] = true;

                // 빨강 영역과 더보기 영역에 pointer-events: none; 설정
                redElement.style.pointerEvents = 'none';
                moreButton.style.pointerEvents = 'none';
                redElement.children[0].style.pointerEvents = 'auto';
                try {
                    redElement.children[2].style.pointerEvents = 'auto';
                } catch (error) {}

                // 더보기 영역의 모든 자식 객체에 pointer-events: auto; 설정
                Array.from(moreButton.querySelectorAll('*')).forEach(child => {
                    child.style.pointerEvents = 'auto';
                });
            }
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

        if (redElement && seventhParent) {
            blackBox.style.width = videoElement.offsetWidth + 'px';
            blackBox.style.height = videoElement.offsetHeight + 'px';
            blackBox.style.backgroundColor = 'black';

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

        // 블랙박스의 "다음 다음 형제"를 "메뉴탑"이라고 부름
        const menuTop = blackBox.nextElementSibling.nextElementSibling;

        // 릴스페이지에 존재하는 뮤트박스를 가지고 나옴
        let muteBox = videoElement.nextElementSibling;
        for (let i = 0; i < 5 && redElement; i++) {
            muteBox = muteBox.children[0];
        }

        // Create a wrapper div with dynamic width and height
        const muteButtonWrapper = document.createElement('div');
        muteButtonWrapper.style.width = '40px';
        muteButtonWrapper.style.height = '40px';
        muteButtonWrapper.style.marginBottom = '20px';
        muteButtonWrapper.style.display = 'inline-block';
        muteButtonWrapper.style.position = 'relative';
        muteButtonWrapper.style.cursor = 'pointer';
        muteButtonWrapper.style.backgroundColor = 'gray';
        muteButtonWrapper.appendChild(muteBox);
        muteButtonWrapper.children[0].alignIteams = 'initial';

        // Insert the wrapper into the menuTop
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
        blueElement.remove();
    }
}

// 배속 버튼 및 음량 조절 슬라이더 생성 함수
function createVolumeSliderAndSpeedButtons(blackBox, videoElement) {
    // 음량 조절 슬라이더 생성
    const volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.min = 0;
    volumeSlider.max = 1;
    volumeSlider.step = 0.01;
    volumeSlider.value = options.volumeSliderV;
    volumeSlider.addEventListener('input', () => {
        updateVolume(volumeSlider.value);
    });
    blackBox.appendChild(volumeSlider);

    // 배속 버튼 생성
    const playbackRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    playbackRates.forEach(rate => {
        const rateButton = document.createElement('button');
        rateButton.textContent = `${rate}x`;
        rateButton.addEventListener('click', () => {
            videoElement.playbackRate = rate;
        });
        blackBox.appendChild(rateButton);
    });
}

// 배속 단축키 기능 추가
document.addEventListener('keydown', (event) => {
    const videoElements = document.querySelectorAll('video');
    if (videoElements.length === 0) return;

    const currentRate = videoElements[0].playbackRate;
    const step = 0.25;

    if (event.key === 'ArrowUp') { // 속도 증가
        videoElements.forEach(video => {
            video.playbackRate = Math.min(currentRate + step, 2);
        });
    } else if (event.key === 'ArrowDown') { // 속도 감소
        videoElements.forEach(video => {
            video.playbackRate = Math.max(currentRate - step, 0.25);
        });
    }
});

setInterval(function () {
    processUnexpandedVideos();
}, 3000);

processUnexpandedVideos();