# CTC Latte WebUI

학생, 교사, 일반 사용자가 전 세계 CMIP6 기후 시나리오를 지도에서 조회하고 기간 자료를 CSV, PDF, PNG로 저장할 수 있는 공개 Web UI입니다.

## 주요 기능

- OpenStreetMap 기반 전 세계 좌표 선택, 휠 확대·축소, 드래그 이동
- 날짜, 위도·경도, SSP 시나리오, 6개 CMIP6 모델 및 전체 앙상블 조회
- 최고기온, 최저기온, 강수량, 풍속, 열지수, 체감기온 표시
- 선택일, 월, 1년, 5년, 10년 또는 전체 기간 내보내기
- 원자료 조회 중 진행 표시와 새로고침 방지 안내
- 320px 모바일부터 와이드 데스크톱까지 반응형 화면

## 실행

Node.js 20 이상과 pnpm이 필요합니다.

```powershell
corepack pnpm install
corepack pnpm dev
```

프로덕션 빌드는 다음 명령으로 `dist/`에 생성됩니다.

```powershell
corepack pnpm build
```

루트의 `index.html`과 `assets/`는 검증된 배포용 정적 번들입니다. 개발 시에는 `source/`의 읽을 수 있는 공개 소스를 사용합니다.

## 자료 연결

브라우저는 같은 출처의 `/api/climate/query`, `/api/climate/series`, `/api/climate/metadata`만 호출합니다. 저장소 주소, 원본 자료 경로, 인증 정보는 브라우저 번들에 포함하지 않습니다. 실제 자료 서비스에서는 이 API 계약을 읽기 전용 기후자료 게이트웨이에 연결해야 합니다.

지표 계산과 결측 처리 기준은 [자료 의미와 계산 기준](docs/DATA_SEMANTICS.md)을 참고하세요.

## 라이선스

코드는 GPL-3.0-only 조건으로 배포됩니다. 기후자료와 지도 타일에는 각 제공자의 별도 이용 조건과 출처 표시가 적용됩니다.
