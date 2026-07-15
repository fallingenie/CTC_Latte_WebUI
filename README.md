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

Node.js 20.19 이상 또는 22.12 이상과 pnpm이 필요합니다.

```powershell
corepack pnpm install
corepack pnpm dev
```

읽기 전용 기후자료 게이트웨이가 다른 주소에서 실행 중이면 개발 서버를 시작하기 전에 `CTC_QUERY_GATEWAY_TARGET`을 지정합니다. 기본값은 `http://127.0.0.1:8765`입니다. 이 값은 Vite 개발·미리보기 프록시에만 사용되며 브라우저 배포 번들에는 포함되지 않습니다.

리버스 프록시나 임시 검증 주소를 통해 개발·미리보기 서버를 노출할 때는 `CTC_WEB_ALLOWED_HOSTS`에 허용할 호스트 이름을 쉼표로 구분해 지정합니다. 하위 도메인 전체를 허용해야 하면 `.example.org`처럼 점으로 시작하는 도메인을 사용할 수 있습니다. 이 값도 실행 환경에서만 읽으며 배포 번들에는 포함되지 않습니다.

프로덕션 빌드는 다음 명령으로 `dist/`에 생성됩니다.

```powershell
corepack pnpm build
```

저장소 루트를 브라우저에서 직접 열어 확인할 정적 산출물을 새 빌드와 동기화하려면 다음 명령을 사용합니다.

```powershell
corepack pnpm sync:deploy
```

루트의 `index.html`과 `assets/`는 직접 열기용으로 동기화한 검증 정적 번들입니다. 공개 웹 서버의 문서 루트에는 저장소 전체가 아닌 `dist/`만 배포해야 합니다. 개발 시에는 `source/`의 읽을 수 있는 공개 소스를 사용합니다.

공개 소스에서 루트 배포본을 동일하게 재현하는지는 다음 명령으로 검증합니다.

```powershell
corepack pnpm test
corepack pnpm verify:reproducible
corepack pnpm verify:deployment
```

`pnpm test`는 실제자료 API 경로 제한, 날짜 확인, 지도 확대·축소, 원자료 CSV 열, 월별 체감 기준, CSV 출처 정보와 파일 저장 결과를 검증합니다. GitHub의 검증 워크플로는 Windows와 Linux에서 동일한 테스트와 재현 빌드를 실행합니다.

`pnpm verify:deployment`는 새 빌드, 루트 산출물 재현성 검증, 운영 대상의 실시간 배포 확인을 순서대로 수행합니다.

실제자료 자체의 배열·API 일치 여부는 WebUI 저장소의 합성값으로 대신하지 않습니다. 운영 데이터 검증에서는 정본의 Zarr·Parquet를 직접 읽는 검증기와 같은 좌표·날짜·시나리오·모델을 조회하는 API 검증기를 함께 실행해야 합니다.

## 자료 연결

브라우저의 기후자료 조회는 같은 출처의 `/api/climate/query`, `/api/climate/series`, `/api/climate/metadata`만 호출합니다. 지도 화면은 별도 이용 조건과 출처 표시를 따르는 OpenStreetMap 타일 제공자에 연결됩니다. 저장소 주소, 원본 자료 경로, 인증 정보는 브라우저 번들에 포함하지 않습니다. 실제 자료 서비스에서는 기후자료 API 계약을 읽기 전용 게이트웨이에 연결해야 합니다.

운영 게이트웨이는 사용자 명의 Google Drive 마운트 안의 준비된 Web 자료를 먼저 읽고, 해당 범위를 벗어난 조회는 Team Start가 정의한 GCS CMIP6 원자료로 보완합니다. 로컬 드라이브와 네트워크 공유 폴더는 개발·정합성 대조에만 사용할 수 있으며 운영 원본이나 장애 대체 경로로 허용하지 않습니다. `pnpm start:gateway:production`은 이 경계를 강제하고, `pnpm attest:production`은 외부 Build와 loopback 게이트웨이의 실제 응답을 대조한 비공개 v2 확인서를 만듭니다. 배포 산출물과 서버 원본 정책은 `pnpm verify:cloud-policy` 및 `pnpm verify:deployment`로 확인합니다. 자세한 배포 차단 기준은 [배포 자료 원본 정책](docs/DEPLOYMENT_DATA_SOURCE_POLICY.md)을 참고하세요.

지표 계산과 결측 처리 기준은 [자료 의미와 계산 기준](docs/DATA_SEMANTICS.md)을 참고하세요.

## 라이선스

코드는 GPL-3.0-only 조건으로 배포됩니다. 기후자료와 지도 타일에는 각 제공자의 별도 이용 조건과 출처 표시가 적용됩니다.
