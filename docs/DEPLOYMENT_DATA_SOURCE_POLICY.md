# 배포 자료 원본 정책

## 원칙

운영 Web UI는 GitHub Pages에서 정적 화면을 제공하고, 기후자료 조회는 검증된 공개 Cloud Run의 `/api/climate/*`만 호출합니다. 로컬 개발에서는 기존 동일 출처 상대 경로를 사용합니다. 지도 타일은 별도 이용 조건과 출처 표시를 따르는 OpenStreetMap 제공자 연결입니다. 브라우저 번들, 연결 설정과 기후자료 응답에는 Google Drive 주소, 로컬·네트워크 경로, 토큰·자격 증명과 내부 자료 확장자를 넣지 않습니다. 공개 GCS 객체 주소도 UI나 내보내기에 표시하지 않습니다.

공개 웹 서버는 빌드 결과인 `dist/`만 문서 루트로 배포합니다. 저장소 루트, `source/`, `config/`, `scripts/` 및 검증 증거 디렉터리를 정적 파일 서버의 공개 경로로 사용하지 않습니다.

운영 게이트웨이의 자료 역할과 조회 순서는 다음과 같이 고정합니다.

1. 공개 객체 조회 전용 GCS의 `*.ctwebui`를 준비된 Web 자료의 기본 원본으로 사용합니다.
2. 준비된 자료가 요청 좌표나 기간을 포함하지 않을 때 Team Start가 정의한 GCS CMIP6 원자료를 읽습니다.
3. GCS 주소와 버킷 식별자는 배포 설정에서만 관리하고 사용자 화면과 내보내기에는 표시하지 않습니다.
4. 로컬 드라이브, 네트워크 공유 폴더와 `file:` 주소는 운영 원본이나 장애 대체 경로로 사용하지 않습니다.
현재 로컬 게이트웨이는 개발과 정합성 대조를 위한 임시 연결입니다. 운영 배포 대상이 아니며, 운영 장애 때 자동으로 선택되는 대체 경로에도 포함하지 않습니다.

GCS 버킷 루트나 업로드 중인 디렉터리는 직접 열지 않습니다. 발행 명령은 업로드 경로를 로컬 정본과 대조한 뒤 `release-candidate/datasets/<datasetVersion>.ctwebui`로 서버 측 복사하고, 운영 프로세스는 배포할 때 지정한 `release-candidate/releases/<datasetVersion>.json` 불변 포인터가 가리키는 이 사본만 엽니다. 포인터에 기록된 `datasetVersion`이 실제 `manifest.json`, `meta/array_index.json`, `meta/raw_cmip6_index.json`의 합성 SHA-256과 일치할 때만 시작합니다. `release-candidate/current.json`은 운영자가 현재 자료판을 확인하기 위한 별칭이며 실행 중인 리비전의 자료판을 바꾸지 않습니다. 같은 업로드 경로가 다음 자료로 교체되어도 이미 배포된 리비전은 이전 불변 사본을 계속 읽습니다.

## 공개 출처와 내보내기

공개 Attribution 카탈로그에 고정된 프로젝트 제작자명, 공개 GitHub 프로필·프로젝트 저장소 링크와 DOI·인용 링크는 UI와 내보내기에 필요한 공개 출처 정보로 의도적으로 허용합니다. 이 허용 목록은 임의의 저장소나 외부 주소를 허용하지 않으며, Google Drive·GCS 주소, 로컬·네트워크 경로, 비공개 저장소 주소와 토큰·자격 증명은 계속 금지합니다.

기간 자료 내보내기의 CSV 출처 묶음, PDF, PNG, 대화형 HTML은 각 파일 또는 함께 제공되는 출처 묶음에 자료 출처와 인용 정보를 포함해야 합니다. 대한민국 기상청 ASOS 자료 사용을 고지할 때는 변형·대체하지 않은 원본 `kma_mark_1.png`와 `kma_mark_2.png`를 함께 사용해야 합니다. `raw-model-grid`는 ASOS 관측 보정 미사용을 명시하고, 공통 출처 묶음에 KMA 표장이 포함되더라도 ASOS 자료를 사용했다는 문구나 인상을 주지 않아야 합니다.

논문과 자료 인용의 라이선스는 공개 Attribution 카탈로그의 값을 그대로 사용합니다. 카탈로그에 라이선스가 없으면 DOI, 저널 또는 제공 기관을 근거로 라이선스를 추정하거나 새로 표시하지 않습니다.

## 배포 차단 조건

`config/production-data-policy.json`은 주소나 인증 정보 없이 운영 자료 원본의 종류와 순서만 선언합니다. `pnpm verify:cloud-policy`는 배포 산출물이 다음 조건을 지키는지 검사합니다.

- 클라우드 전용 정책인지
- 준비된 Web 자료와 범위 밖 CMIP6 원자료가 모두 승인된 GCS 경로를 사용하는지
- 로컬 파일시스템 원본 경로가 꺼져 있는지
- 공개 산출물에 Google Drive·GCS 주소, 로컬·네트워크 경로, 비공개 저장소 주소, 토큰·자격 증명과 내부 확장자가 없는지

실제 운영 게이트웨이를 열기 전에는 게이트웨이가 생성한 배포 확인서를 이용해 다음 검증도 통과해야 합니다.

```powershell
$env:CTC_BACKEND_ROOT = "<PR이 병합된 Backend main 절대경로>"
$env:CTC_PREPARED_DATA_PROVIDER = "gcs"
$env:CTC_PREPARED_DATA_MOUNT_ROOT = "<GCS 읽기 전용 마운트 절대경로>"
$env:CTC_WEB_DATA_ROOT = "<마운트 안의 현재 .ctwebui 절대경로>"
$env:CTC_WEBUI_CMIP6_ZARR_ROOT = "<GCS 원자료 루트>"
$env:CTC_GATEWAY_HOST = "127.0.0.1"
$env:CTC_GATEWAY_PORT = "8765"
corepack pnpm start:gateway:production
```

외부 HTTPS가 위 loopback 게이트웨이와 현재 `dist/`를 연결한 뒤 별도 셸에서 확인서를 만듭니다.

```powershell
$env:CTC_DEPLOYMENT_BASE_URL = "<외부 HTTPS 서비스 주소>"
$env:CTC_GATEWAY_LOCAL_BASE_URL = "http://127.0.0.1:8765"
corepack pnpm verify:deployment
```

`verify:deployment`는 저장된 JSON만 신뢰하지 않고 외부 HTTPS와 loopback 게이트웨이를 다시 조회해 10분 이내의 확인서를 새로 만든 뒤 검증합니다. `attest:production`은 문제 조사용으로 따로 실행할 수 있지만, 이전 확인서만으로 배포 검증을 대신할 수 없습니다. GCS 위치는 배포 환경에만 두고 확인서에는 주소나 경로를 기록하지 않습니다. `.release-evidence/`는 Git과 정적 배포 대상에서 제외합니다.

## 실제 배포 확인서 계약

확인서는 정책 파일을 복사한 문서가 아니라 게이트웨이가 실제로 연 자료판에 대해 생성한 별도 JSON이어야 합니다. 허용되는 전체 형식은 다음과 같습니다.

```json
{
  "allowedProviders": ["gcs"],
  "attestationVersion": 3,
  "attributionReady": true,
  "backendCommitSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "datasetUpdatedAt": "2026-07-13T16:22:20.121000+00:00",
  "datasetVersion": "1111111111111111111111111111111111111111111111111111111111111111",
  "frontendCommitSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "gateway": {
    "frontendAssetsVerified": true,
    "healthVerified": true,
    "localGatewayVerified": true,
    "metadataVerified": true,
    "sameOrigin": true,
    "seriesVerified": true
  },
  "internalPathExposure": false,
  "preparedData": {
    "attributionReady": true,
    "dataMode": "bias-corrected",
    "manifestSha256": "2222222222222222222222222222222222222222222222222222222222222222",
    "provider": "gcs",
    "publicSafe": true,
    "queryVerified": true
  },
  "publicSafe": true,
  "queryOrder": ["prepared-web-data", "raw-cmip6"],
  "rawData": {
    "attributionReady": true,
    "dataMode": "raw-model-grid",
    "provider": "gcs",
    "publicSafe": true,
    "queryVerified": true,
    "rawIndexSha256": "3333333333333333333333333333333333333333333333333333333333333333",
    "rawModelGrid": true
  },
  "verifiedAtUtc": "2026-07-15T03:04:05.006Z"
}
```

- `datasetVersion`은 `manifest.json`, `meta/array_index.json`, `meta/raw_cmip6_index.json` 각각의 SHA-256을 파일명별 map으로 만들고, 키 정렬·공백 없는 구분자·UTF-8·비유한 수 금지 조건의 canonical JSON을 다시 SHA-256한 64자 소문자 값이어야 합니다.
- `datasetUpdatedAt`은 위 세 파일의 수정 시각 중 가장 최신 `st_mtime_ns`를 UTC 마이크로초 ISO-8601 문자열로 바꾼 값이어야 합니다. 형식은 `2026-07-13T16:22:20.121000+00:00`과 같습니다.
- metadata, 단일 날짜 조회와 기간 조회가 `datasetVersion`과 `datasetUpdatedAt`을 빠짐없이 포함하고, 두 문자열을 한 글자까지 동일하게 반환해야 합니다.
- 외부 HTTPS의 모든 `dist/` 파일은 검증한 로컬 Build와 바이트 단위로 같아야 합니다.
- 외부 health, metadata, 보정 자료, 전 세계 원자료와 기간 자료 응답은 loopback 운영 게이트웨이의 같은 요청 결과와 일치해야 합니다. 요청 식별자와 생성 시각만 비교에서 제외합니다.
- Frontend와 Backend SHA는 각각 깨끗한 Git main 계열 작업 트리의 40자 commit SHA여야 합니다.
- `allowedProviders`와 `queryOrder`는 값뿐 아니라 순서까지 정책과 같아야 합니다.
- `publicSafe`와 `attributionReady`는 모두 `true`여야 합니다.
- `internalPathExposure`는 `false`여야 합니다.
- 위에 없는 필드, 주소, 토큰, 자격 증명, 로컬·네트워크·클라우드 저장소 위치 또는 내부 자료 확장자가 하나라도 있으면 확인서를 거부합니다.

UI와 내보내기의 공개 Attribution 허용 목록은 확인서 스키마를 확장하지 않습니다. 프로젝트 제작자·GitHub·인용 링크도 위 JSON 확인서에는 추가하지 않습니다.

따라서 `config/production-data-policy.json` 자체를 확인서 경로로 지정하면 실패합니다. 검증 결과의 `attestationVerified`, `datasetVersion`, `datasetUpdatedAt`, Frontend·Backend commit SHA, `publicSafe`, `attributionReady`, `internalPathExposure`를 배포 개방 기록에 남기고, 검증에 실패하면 운영 트래픽을 열지 않습니다.

## 출시 후보 호스팅

출시 후보의 정적 화면은 GitHub Pages가 제공하고, 공개 Cloud Run 컨테이너는 loopback Python 게이트웨이를 감싼 읽기 전용 `/api/climate/*`를 제공합니다. Cloud Run에는 GCS 버킷을 읽기 전용으로 마운트하고, 실행 서비스 계정에는 해당 버킷의 `roles/storage.objectViewer`만 부여합니다. 브라우저 CORS는 `https://fallingenie.github.io`처럼 배포 때 지정한 정확한 출처만 허용합니다.

GCS 버킷은 관리 폴더 공개를 위해 공개 액세스 방지를 해제하되 버킷 루트에는 공개 IAM 역할을 두지 않습니다. 검증된 `release-candidate` 관리 폴더에만 `allUsers`의 `roles/storage.objectViewer`를 부여합니다. 이 역할은 해당 관리 폴더의 객체 조회·목록 확인만 가능하고 객체 생성·수정·삭제와 IAM 변경을 허용하지 않습니다. `allAuthenticatedUsers` 및 다른 공개 역할이 있으면 배포를 중단합니다. 버킷 CORS도 GitHub Pages 출처의 `GET`과 `HEAD`만 허용합니다.

Frontend와 Backend의 검증된 `origin/main`을 임시 빌드 문맥으로 묶어 배포합니다. Backend 저장소의 작업 트리나 실험 브랜치는 이미지에 포함하지 않습니다. 다음 세 단계 중 하나라도 실패하면 기존 운영 트래픽은 바뀌지 않습니다.

먼저 출시 자료 관리 폴더만 공개 읽기 전용으로 전환하고 GitHub Pages 출처의 GCS CORS를 설정합니다.

자료판을 교체한 뒤에는 `pnpm verify:public-data -- --base-url <공개 API 출처> --samples 4`를 실행합니다. 이 검사는 같은 난수 시드로 다시 실행할 수 있는 대륙·날짜·모델 표본을 만들고, 단일 날짜 조회 값과 같은 날 기간 자료의 대표값 및 보정 전 값을 대조합니다. 결과는 `.release-evidence`에만 원자적으로 저장하며 공개 배포물에는 포함하지 않습니다.

```powershell
.\deploy\configure-public-release-data.ps1 `
  -ProjectId "<GCP 프로젝트>" `
  -BucketName "<자료 버킷>"
```

이 단계는 버킷 루트에 공개 IAM 역할이 없고 `release-candidate` 관리 폴더에만 `allUsers`의 `roles/storage.objectViewer`가 있는지 다시 확인합니다. 쓰기·삭제·IAM 권한이나 `allAuthenticatedUsers`가 발견되면 배포를 중단합니다.

자료 업로드가 모두 끝난 뒤 체크섬을 대조하고 불변 자료판 포인터를 만듭니다.

```powershell
.\deploy\publish-release-pointer.ps1 `
  -LocalMountRoot "<로컬 정본 상위 경로>" `
  -RelativePath "<업로드된 .ctwebui 상대경로>" `
  -ReleaseId "<영문·숫자 자료판 식별자>" `
  -ProjectId "<GCP 프로젝트>" `
  -BucketName "<자료 버킷>"
```

이 명령은 업로드 경로와 자료판별 불변 사본을 각각 `gcloud storage rsync --dry-run --checksums-only --delete-unmatched-destination-objects`로 확인하며 차이가 하나라도 남아 있으면 포인터를 쓰지 않습니다. 이미 발행된 `datasetVersion`의 불변 사본은 수정하지 않고 다시 대조만 합니다. 성공 결과의 `PointerObject`를 다음 후보 배포 명령에 그대로 전달합니다.

```powershell
.\deploy\deploy-release-candidate.ps1 `
  -ProjectId "<GCP 프로젝트>" `
  -BucketName "<자료 버킷>" `
  -ReleasePointerObject "<앞 단계의 PointerObject>"
```

후보 배포는 자료판과 두 저장소의 정확한 Main SHA를 컨테이너 이미지에 고정하고, 공개 태그 주소만 가진 트래픽 0% 리비전을 만듭니다. Cloud Run 서비스를 처음 만드는 경우에는 플랫폼 제약으로 최초 리비전이 일시적으로 트래픽 100%를 받지만, 아직 GitHub Pages가 이 주소를 사용하지 않는 상태에서 즉시 같은 검증을 수행합니다. 최초 검증이 실패하면 새 서비스를 자동으로 삭제하고, 이후 자료판의 승격 후 검증이 실패하면 기존 리비전의 트래픽 배분으로 되돌립니다. 성공 결과의 `Tag`를 사용해 외부 후보 API와 로컬 정본 게이트웨이를 실제 조회로 대조한 뒤에만 운영 트래픽을 확정합니다.

```powershell
.\deploy\promote-release-candidate.ps1 `
  -ProjectId "<GCP 프로젝트>" `
  -LocalMountRoot "<로컬 정본 상위 경로>" `
  -RelativePath "<검증할 .ctwebui 상대경로>" `
  -CandidateTag "<후보 배포 결과의 Tag>"
```

승격 단계는 GitHub Pages 출처의 CORS 사전 요청을 먼저 확인합니다. 외부와 로컬의 metadata, 준비된 자료 조회, 원자료 조회와 기간 조회가 같은 자료판·조건·값을 반환하고 공개 안전성 및 출처 표시 검사가 모두 통과해야 지정 리비전에 트래픽 100%를 배정합니다. 승격 결과의 `PublicApiOrigin`을 GitHub 저장소 변수 `CTC_PUBLIC_API_ORIGIN`으로 설정한 뒤 Pages 작업 흐름을 실행합니다.

```powershell
.\deploy\publish-github-pages.ps1 `
  -PublicApiOrigin "<승격 결과의 PublicApiOrigin>"
```

Pages가 이미 생성되어 있으면 생성 API의 충돌 응답은 기존 설정을 확인한 뒤 무시하고 작업 흐름만 실행합니다. 배포 후 Pages 주소의 `runtime-config.json`, 메타데이터, 단일 날짜와 기간 조회를 다시 확인합니다. 브라우저 접속 암호는 공개 저장소에서 확인 가능한 화면 진입 장벽일 뿐 보안 경계가 아니며, GCS와 Cloud Run이 공개 읽기 전용이라는 사실을 바꾸지 않습니다.

## 공개 API 응답 변경 절차

Frontend는 `runtime-policy.js`의 호환 계층에서 Backend 응답을 안정된 내부 형식으로 바꾼 뒤 화면에 전달합니다. `allowedFields`에는 `values[].label`처럼 화면과 내보내기에 필요한 필드 경로만 명시합니다. 필수 필드가 빠지거나 자료판 식별자, 요청 조건, 자료 형태가 달라지면 즉시 거부합니다.

Backend가 정상 metadata, query, series 응답에 안전한 부가 필드를 추가하면 호환 계층은 응답 전체를 보안 검사한 뒤 그 필드를 화면에 전달하지 않고 무시합니다. 따라서 자료판 갱신, 새 모델 추가, 부가 진단 정보 추가는 Frontend 대규모 수정 사유가 아닙니다. 공개 Attribution 링크는 Frontend의 검토된 카탈로그에서만 가져오며 Backend 응답의 임의 URL을 허용하지 않습니다. 알 수 없는 필드라도 저장소 주소, 파일 경로, 인증 정보, 내부 자료 확장자 또는 이를 암시하는 필드 이름이 있으면 응답 전체를 거부합니다.

같은 `*.ctwebui` 위치의 내용이 별도 통보 없이 교체되는 상황도 정상 갱신으로 처리합니다. Frontend는 RC 이름이나 파일명을 자료판 식별자로 사용하지 않고 metadata의 `datasetVersion`과 `datasetUpdatedAt`을 함께 확인합니다. 창이 다시 활성화될 때와 저빈도 주기 확인에서 두 값 중 하나라도 바뀌면 진행 중 요청을 취소하고 학생·교사·일반 화면의 현재 날짜·좌표·시나리오·모델을 새 자료판에 고정해 다시 조회합니다. 열려 있는 기간 내보내기도 새 자료판으로 다시 조회한 결과만 저장합니다.

자료 교체가 단일 날짜 또는 기간 조회 도중 일어나 응답의 자료판 식별자가 요청 당시 기준과 달라지면 다음 주기까지 기다리지 않습니다. Frontend는 metadata를 즉시 다시 확인하고, 실제로 새 자료판이 확인되면 같은 사용자 조건을 한 번 더 조회합니다. 새 metadata에 기존 모델·배출 경로·날짜가 없을 때만 제공 범위 안의 값으로 조정합니다. 이 복구 절차에서도 기존 결과는 최신 결과가 정상적으로 도착하기 전까지 화면 참고용으로 보존하지만, 비교 자료 등록과 CSV·PDF·PNG·HTML·DOCX 저장은 현재 metadata와 정확히 일치하는 조회가 완료될 때까지 차단합니다.

자료 갱신으로 같은 좌표가 `raw-model-grid`에서 `bias-corrected`로 바뀌거나 반대로 바뀔 수 있으므로, 이전 자료판의 자료 형태를 새 자료판에 강제하지 않습니다. 새 자료판 식별자와 요청 조건이 정확히 일치하고 응답 자료 형태가 공개 계약의 허용값일 때만 새 결과로 교체합니다. 기후자료 API 응답은 브라우저나 서비스 작업자 캐시에 저장하지 않습니다.

오류 응답, 공개 연결 설정과 운영 확인서는 의미가 조금만 달라져도 배포 판단이 바뀌므로 계속 정확한 필드 계약을 사용합니다. Backend가 필수 필드를 삭제·이름 변경하거나 자료 단위, 자료 형태, 출처 표시 또는 재시도 의미를 바꾸는 파괴적 변경은 자동 흡수하지 않습니다. 이 경우에만 Backend와 Frontend 양쪽의 계약 검토와 사용자 승인을 거칩니다.
