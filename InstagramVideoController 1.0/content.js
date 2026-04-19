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

// if (savedMuteStatus !== null) {
//     options.volumeMute = JSON.parse(savedMuteStatus);
// }

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

        // // 음소거 버튼 생성
        // const muteButton = document.createElement('button');
        // muteButton.style.backgroundImage = options.volumeMute ? `url(${chrome.runtime.getURL("muted.png")})` : `url(${chrome.runtime.getURL("unmuted.png")})`;
        // muteButton.style.width = '24px';
        // muteButton.style.height = '24px';
        // muteButton.style.border = 'none';  // Remove the border
        // muteButton.style.backgroundColor = 'transparent';  // Make the background transparent
        // muteButton.style.position = 'absolute';
        // muteButton.style.left = '6px';  // Center the button horizontally
        // muteButton.style.top = '0px';  // Align the button to the top
        // muteButton.style.cursor = 'pointer';  // Makes the mouse pointer change to a hand

        // // 음소거 관련 텍스트 생성
        // const muteText = document.createElement('label');
        // muteText.style.backgroundColor = 'transparent';  // Make the background transparent
        // muteText.style.color = 'black';  // Set text color to black
        // muteText.innerText = options.volumeMute ? 'Muted' : 'Unmuted';  // Set text based on mute state
        // muteText.style.position = 'absolute';
        // muteText.style.left = '6px';
        // muteText.style.top = '24px';  // Align the text to the bottom
        // muteText.style.height = '20px';  // Set the height to 20 pixels
        // muteText.style.cursor = 'pointer';  // Makes the mouse pointer change to a hand

        // // Update the wrapper's height to accommodate both the button and the text
        // muteButtonWrapper.style.height = '44px';  // 24px (button) + 20px (text)

        // // Add the button and text to the wrapper
        // muteButtonWrapper.appendChild(muteButton);
        // muteButtonWrapper.appendChild(muteText);

        // // Update mute status and text when wrapper is clicked
        // muteButtonWrapper.addEventListener('click', () => {
        //     options.volumeMute = !options.volumeMute;
        //     localStorage.setItem('volumeMute', options.volumeMute);
        //     muteButton.style.backgroundImage = options.volumeMute ? `url(${chrome.runtime.getURL("muted.png")})` : `url(${chrome.runtime.getURL("unmuted.png")})`;
        //     muteText.innerText = options.volumeMute ? 'Muted' : 'Unmuted';  // Update text based on new mute state
        //     videoElement.muted = true;
        //     videoElement.muted = options.volumeMute;
        // });

        // // Add the wrapper to the menuTop
        // menuTop.insertBefore(muteButtonWrapper, menuTop.firstChild);

        // videoElement.addEventListener("play", () => {
        //     updateMuteStatus(options.volumeMute);
        // });

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

setInterval(function () {
    processUnexpandedVideos();
}, 3000);

processUnexpandedVideos();
