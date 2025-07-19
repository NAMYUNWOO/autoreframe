# GA4 디버깅 가이드

## 1. Chrome 개발자 도구에서 확인하기

### Network 탭에서 GA4 요청 확인:
1. F12로 개발자 도구 열기
2. Network 탭 선택
3. 웹사이트 새로고침
4. 필터에 "collect" 또는 "gtag" 입력
5. 다음 요청들이 있는지 확인:
   - `https://www.google-analytics.com/g/collect?v=2&tid=G-F792NMBVT9`
   - `https://www.googletagmanager.com/gtag/js?id=G-F792NMBVT9`

### Console에서 dataLayer 확인:
```javascript
// Console에서 실행
console.log(window.dataLayer);
// GA4 이벤트가 기록되는지 확인
```

## 2. Google Analytics DebugView 사용

1. Chrome 확장 프로그램 "Google Analytics Debugger" 설치
2. 확장 프로그램 활성화
3. Google Analytics > 관리 > DebugView 접속
4. 웹사이트 방문하여 실시간 이벤트 확인

## 3. GTM에서 GA4 태그 추가하기 (아직 안 되어있다면)

1. GTM 접속 (https://tagmanager.google.com)
2. 컨테이너 `GTM-TMZ5VTJ8` 선택
3. 태그 > 새로 만들기
4. 태그 구성:
   - 태그 유형: "Google 애널리틱스: GA4 구성"
   - 측정 ID: `G-F792NMBVT9`
5. 트리거: "All Pages - 모든 페이지뷰"
6. 저장 후 "제출" > "게시"

## 4. 일반적인 문제와 해결 방법

### 문제 1: GTM 컨테이너가 게시되지 않음
- 해결: GTM에서 "제출" 클릭 후 변경사항 게시

### 문제 2: 잘못된 측정 ID
- 해결: GA4 속성 설정에서 정확한 측정 ID 확인

### 문제 3: 광고 차단기
- 해결: 광고 차단기 비활성화 후 테스트

### 문제 4: 도메인 불일치
- GA4에서 설정한 도메인: https://www.auto-reframe.com
- 실제 테스트 도메인이 다르면 데이터가 수집되지 않음

## 5. 빠른 확인 방법

브라우저 Console에서:
```javascript
// GTM 로드 확인
console.log(typeof google_tag_manager !== 'undefined' ? 'GTM 로드됨' : 'GTM 없음');

// dataLayer 이벤트 확인
window.dataLayer.forEach(event => console.log(event));
```