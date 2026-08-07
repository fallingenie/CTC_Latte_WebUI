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

일반 Frontend 개발에는 Node.js 20.19 이상 또는 22.12 이상과 pnpm이 필요합니다. `.ctwebui` publication 검증과 읽기 전용 Python 게이트웨이 통합에는 Python 3.12 이상이 추가로 필요합니다. 출시 컨테이너는 Python 3.13을 사용합니다. WebUI는 Backend 자료를 생성·정규화·재봉인하지 않습니다.

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
corepack pnpm build
corepack pnpm verify:reproducible
corepack pnpm verify:cloud-policy
```

`pnpm test`는 실제자료 API 경로 제한, 날짜 확인, 지도 확대·축소, 원자료 CSV 열, 월별 체감 기준, CSV 출처 정보와 파일 저장 결과를 검증합니다. GitHub의 검증 워크플로는 Windows와 Linux에서 동일한 테스트와 재현 빌드를 실행합니다.

`verify:public-data`, `attest:production`, `verify:deployment`와 배포·승격 스크립트는 실서비스 Backend, GCS 또는 공개 후보 리비전을 조회하거나 변경할 수 있는 조율 대상입니다. Backend·배포 담당자의 명시적 승인과 정확한 자료판이 준비되기 전에는 실행하지 않습니다.

실제자료 자체의 배열·API 일치 여부는 WebUI 저장소의 합성값으로 대신하지 않습니다. 운영 데이터 검증에서는 정본의 Zarr·Parquet를 직접 읽는 검증기와 같은 좌표·날짜·시나리오·모델을 조회하는 API 검증기를 함께 실행해야 합니다.

## 자료 연결

브라우저의 공개 기후자료 계약은 같은 출처의 `/api/climate/query`, `/api/climate/series`, `/api/climate/metadata`, `/api/climate/attribution`으로 구성됩니다. 출시 서버는 공개 listener를 열기 전에 attribution endpoint의 exact schema v1과 metadata의 자료판 identity를 확인합니다. query와 series의 관측자료 출처는 결과별 실제 provider만을 나타내며, WebUI는 `dataMode`나 정적 카탈로그로 provider를 추론하지 않습니다. 지도 화면은 별도 이용 조건과 출처 표시를 따르는 OpenStreetMap 타일 제공자에 연결됩니다.

프로젝트·CMIP6·방법론 인용은 Frontend 공개 카탈로그가 소유합니다. 관측 provider 이름, 데이터셋, 라이선스, 인용문, 사용 행 수와 결과 표장 요구는 Backend 응답의 exact `observationAttribution`만 사용합니다. 이 공개 출처 정보를 제외한 Google Drive·GCS 주소, 로컬·네트워크 경로와 토큰·자격 증명은 브라우저 UI 또는 내보내기에 포함하지 않습니다. GitHub Pages 연결 설정에는 검증된 공개 Cloud Run API 주소만 들어갑니다.

운영 게이트웨이는 공개 객체 조회 전용 GCS의 준비된 Web 자료를 먼저 읽고, 해당 범위를 벗어난 조회는 Team Start가 정의한 GCS CMIP6 원자료로 보완합니다. 정적 화면은 GitHub Pages, 읽기 전용 질의 API는 공개 Cloud Run에서 제공합니다. 로컬 드라이브와 네트워크 공유 폴더는 개발·정합성 대조에만 사용할 수 있으며 운영 원본이나 장애 대체 경로로 허용하지 않습니다. `pnpm start:gateway:production`은 이 경계를 강제하고, `pnpm attest:production`은 외부 API와 loopback 게이트웨이의 실제 응답을 대조한 v3 확인서를 만듭니다. 배포 산출물과 서버 원본 정책은 `pnpm verify:cloud-policy` 및 `pnpm verify:deployment`로 확인합니다. 자세한 배포 차단 기준은 [배포 자료 원본 정책](docs/DEPLOYMENT_DATA_SOURCE_POLICY.md)을 참고하세요.

기간 자료 내보내기의 CSV 출처 묶음, PDF, PNG, 대화형 HTML과 DOCX에는 실제 결과의 관측 provider와 인용 정보를 포함합니다. KMA 표장은 해당 provider descriptor가 요구하고 로컬 원본의 이름·SHA-256·크기·media type이 모두 일치할 때만 표시·내보냅니다. `raw-model-grid` 결과에는 관측 provider나 표장을 포함하지 않습니다. 프로젝트·CMIP6·방법론 인용의 라이선스는 Frontend 카탈로그에 값이 있을 때만 표시하며, 값이 없으면 추정하지 않습니다.

지표 계산과 결측 처리 기준은 [자료 의미와 계산 기준](docs/DATA_SEMANTICS.md)을 참고하세요.

## 라이선스

코드는 GPL-3.0-only 조건으로 배포됩니다. 기후자료와 지도 타일에는 각 제공자의 별도 이용 조건과 출처 표시가 적용됩니다.
