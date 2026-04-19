// 현재 타겟을 저장할 변수
let currentTarget = null;

// 최대 반복 횟수
const maxRetries = 20;

// 현재 반복 횟수
let currentRetries = 0;

// width 변경을 감지할 MutationObserver 객체
let widthObserver = null;

// DOM 변경을 감지할 MutationObserver 객체
const domObserver = new MutationObserver(() => {
  findTarget();
});

// "_ac3p _ac3q" 클래스 요소를 찾고 width 변경을 감지
function observeWidth(parentElement) {
  // 이전의 widthObserver 연결 해제
  if (widthObserver) {
    widthObserver.disconnect();
  }

  const targetElement = parentElement.querySelector("._ac3p._ac3q");

  if (targetElement) {
    widthObserver = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === "attributes" && mutation.attributeName === "style") {
          const width = targetElement.style.width;
          if (width === "100%") {
            triggerClick();
          }
        }
      });
    });

    widthObserver.observe(targetElement, { attributes: true });
  } else {
    console.log("Width observing target element not found.");
  }
}

// "x1i10hfl x6umtig x1b1mbwd..." 아이디를 가진 요소에 클릭 이벤트를 발생
function triggerClick() {
  const clickTarget = document.querySelector(".x1i10hfl.x6umtig.x1b1mbwd.xaqea5y.xav7gou.x9f619.xe8uvvx.xdj266r.x11i5rnm.xat24cr.x1mh8g0r.x16tdsg8.x1hl2dhg.xggy1nq.x1a2a7pz.x6s0dn4.xjbqb8w.x1ejq31n.xd10rxx.x1sy0etr.x17r0tee.x1ypdohk.x78zum5.xl56j7k.x1y1aw1k.x1sxyh0.xwib8y2.xurb0ha.xcdnw81");
  
  if (clickTarget) {
    clickTarget.click();
    console.log("Click event triggered.");
  } else {
    console.log("Click target not found.");
  }
}

// 타겟을 찾는 함수
function findTarget() {
  // 클래스 이름으로 모든 객체를 찾음
  const elements = Array.from(document.querySelectorAll('.x10l6tqk.x17qophe.x19w6rv'));
  
  // 자식이 없는 객체를 제거
  // const filteredElements = elements.filter(el => el.childElementCount > 0);
  
  // 스케일이 1인 객체를 찾음
  const target = filteredElements.find(el => {
    const transform = el.style.transform;
    return transform && transform.includes('scale(1)');
  });
  
  // 타겟이 변경되었는지 확인
  if (currentTarget !== target) {
    currentTarget = target;
    console.log("New target set:", currentTarget);
    
    // 새 타겟에 대해 DOM 변경을 감지
    domObserver.disconnect();
    if (currentTarget) {
      domObserver.observe(currentTarget, { attributes: true, childList: true, subtree: true });
      
      // 새 타겟에 대해 width 변경을 감지
      observeWidth(currentTarget);
    }
  }

  // 최대 반복 횟수에 도달하지 않았다면 다시 시도
  if (!currentTarget && currentRetries < maxRetries) {
    currentRetries++;
    setTimeout(findTarget, 200); // 200ms 후에 다시 시도
  } else if (currentRetries >= maxRetries) {
    console.log("Max retries reached. Waiting for 1 second before retrying.");
    currentRetries = 0; // 반복 횟수 초기화
    setTimeout(findTarget, 1000); // 1초 후에 다시 시도
  }
}

// 초기 타겟 찾기
findTarget();
