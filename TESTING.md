# AutoReframer 테스트 가이드

## 로컬에서 프로젝트 테스트하는 방법

### 1. 개발 환경 실행

#### 개발 서버 (권장)
```bash
# 개발 모드로 실행 (http://localhost:3000)
npm run dev
```

브라우저에서 `http://localhost:3000`을 열면 애플리케이션을 테스트할 수 있습니다.

#### 프로덕션 빌드 테스트
```bash
# 1. 프로덕션 빌드 생성
npm run build

# 2. 프로덕션 서버 실행 (http://localhost:3000)
npm run start
```

### 2. 코드 품질 검사

```bash
# ESLint로 코드 검사
npm run lint
```

---

## 유닛/통합 테스트 (Vitest)

### 테스트 명령어

```bash
# 워치 모드로 테스트 실행 (파일 변경 시 자동 재실행)
npm test

# 한 번만 실행하고 종료
npm run test:run

# UI 모드로 테스트 실행 (브라우저에서 시각적으로 확인)
npm run test:ui

# 코드 커버리지와 함께 테스트 실행
npm run test:coverage
```

### 테스트 구조

```
src/
├── lib/
│   ├── utils/
│   │   ├── __tests__/
│   │   │   ├── device.test.ts      # 디바이스 감지 테스트
│   │   │   └── logger.test.ts      # 로거 유틸리티 테스트
│   │   ├── device.ts
│   │   └── logger.ts
│   └── reframing/
│       └── __tests__/
│           └── reframe-size-calculator.test.ts  # 기존 리프레이밍 테스트
└── test/
    └── setup.ts                    # 테스트 환경 설정
```

### 새 테스트 작성하기

1. **테스트 파일 생성**: 테스트할 파일과 같은 디렉토리에 `__tests__` 폴더 생성
2. **테스트 파일 명명**: `[파일명].test.ts` 또는 `[파일명].spec.ts`

#### 예제: 유틸리티 함수 테스트
```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '../myFunction';

describe('myFunction', () => {
  it('should return expected result', () => {
    const result = myFunction(input);
    expect(result).toBe(expected);
  });
});
```

#### 예제: React 컴포넌트 테스트
```typescript
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MyComponent } from '../MyComponent';

describe('MyComponent', () => {
  it('should render correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });
});
```

---

## 현재 테스트 상태

### ✅ 통과하는 테스트 (17/19)
- **DeviceDetector**: 디바이스 감지 및 기능 확인 (6개 테스트)
- **Logger**: 로그 레벨, 컨텍스트, 싱글톤 패턴 (6개 테스트)
- **ReframeSizeCalculator**: 일부 리프레이밍 계산 (5개 테스트)

### ⚠️ 실패하는 테스트 (2/19)
- **ReframeSizeCalculator**: 작은 타겟 패딩 및 세로 출력 프레이밍 (2개 테스트)
  - 이는 기존 코드의 알고리즘 로직과 관련된 문제입니다
  - 리팩토링 시 수정 예정

---

## 수동 테스트 체크리스트

### 비디오 업로드 테스트
- [ ] 다양한 비디오 포맷 업로드 (MP4, WebM, MOV 등)
- [ ] 다양한 해상도 테스트 (720p, 1080p, 4K)
- [ ] 세로/가로 영상 테스트
- [ ] 긴 영상 (5분+) 테스트

### 객체 탐지 테스트
- [ ] 단일 인물 영상
- [ ] 여러 인물 영상
- [ ] 신뢰도 임계값 조정 (10% ~ 90%)
- [ ] 샘플링 간격 조정 (1 ~ 30 프레임)

### 리프레이밍 테스트
- [ ] 다양한 출력 비율 (9:16, 16:9, 1:1 등)
- [ ] 패딩 조정 (0% ~ 100%)
- [ ] 부드러움 조정 (0% ~ 100%)
- [ ] 궤적 편집기에서 키프레임 수정

### 내보내기 테스트
- [ ] MP4 포맷 내보내기
- [ ] WebM 포맷 내보내기
- [ ] 다양한 비트레이트 (1Mbps ~ 10Mbps)
- [ ] 모바일 기기에서 내보내기

### 브라우저 호환성
- [ ] Chrome (최신 버전)
- [ ] Safari (macOS/iOS)
- [ ] Firefox (최신 버전)
- [ ] Edge (최신 버전)

### 성능 테스트
- [ ] CPU 사용률 모니터링
- [ ] 메모리 사용량 모니터링
- [ ] 긴 영상 처리 시 메모리 누수 확인
- [ ] 모바일에서 성능 확인

---

## 브라우저 개발자 도구 활용

### Chrome DevTools
```bash
# 1. 개발 서버 실행
npm run dev

# 2. Chrome에서 http://localhost:3000 열기

# 3. DevTools 열기 (Cmd+Option+I 또는 F12)

# 4. 유용한 패널:
# - Console: 로그 및 에러 확인
# - Performance: 성능 프로파일링
# - Memory: 메모리 스냅샷 및 누수 확인
# - Network: 네트워크 요청 모니터링
```

### 성능 측정
```javascript
// 콘솔에서 실행:
performance.mark('start');
// 작업 수행...
performance.mark('end');
performance.measure('작업 시간', 'start', 'end');
console.table(performance.getEntriesByType('measure'));
```

---

## 문제 해결

### 테스트가 실행되지 않을 때
```bash
# 의존성 재설치
rm -rf node_modules package-lock.json
npm install

# 캐시 클리어
rm -rf .next
npm run dev
```

### 포트가 이미 사용 중일 때
```bash
# 프로세스 찾기
lsof -ti:3000

# 프로세스 종료
kill -9 $(lsof -ti:3000)

# 또는 다른 포트 사용
PORT=3001 npm run dev
```

### WebCodecs API 지원 확인
```javascript
// 콘솔에서 실행:
console.log('VideoEncoder:', 'VideoEncoder' in window);
console.log('VideoDecoder:', 'VideoDecoder' in window);
console.log('WebGL:', !!document.createElement('canvas').getContext('webgl'));
```

---

## 다음 단계

### 테스트 커버리지 향상
현재 테스트 커버리지는 매우 낮습니다 (~0.1%). 다음 영역에 대한 테스트 추가가 필요합니다:

1. **우선순위 높음**:
   - `src/lib/video/webcodecs-exporter.ts` (1,144 lines)
   - `src/hooks/useObjectDetection.ts` (842 lines)
   - `src/components/HeadSelector/` (945 lines)

2. **우선순위 중간**:
   - `src/lib/detection/` (탐지 알고리즘)
   - `src/lib/reframing/` (리프레이밍 알고리즘)
   - `src/hooks/` (다른 커스텀 훅들)

3. **우선순위 낮음**:
   - UI 컴포넌트 스냅샷 테스트
   - E2E 테스트 (Playwright/Cypress)

### 참고 자료
- [Vitest 문서](https://vitest.dev/)
- [Testing Library 문서](https://testing-library.com/)
- [Next.js 테스팅 가이드](https://nextjs.org/docs/app/building-your-application/testing/vitest)
