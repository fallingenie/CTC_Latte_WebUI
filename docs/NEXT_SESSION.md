# WebUI 통합 현황

이 문서는 공개 WebUI의 작업 경계와 다음 검증 기준을 기록한다. 코드·계약 판단에서는 GitHub에 표시된 Update Time이 가장 최신인 자료를 정본으로 삼고, 실행하지 않은 검증은 완료로 표시하지 않는다.

## 현재 기준

- 확인일: 2026-08-04
- WebUI 비교 기준 `origin/main`: `d34bfc071500ebd20714cf57e504d839298b343b`
- WebUI 통합 PR: `#4` (`agent/webui-latest-state-20260802`)
- 최신 WebUI 기능·보안 통합 commit: `139a2e2` (publication), `cd05854` (observation attribution)
- Backend 읽기 전용 기준 `main`: `05fd49a602d5530d9c0b3debf758319f6fc4ccd8`
- Backend release: `v1.0.0-rc3.1`
- 로컬 검증: frozen lockfile 설치, 25개 파일·314개 테스트, production build, 27개 배포 산출물 재현성, cloud policy 모두 통과
- GitHub PR CI: 이 문서와 배포 산출물 push 뒤 Windows·Linux 검증 결과를 PR에서 확인

## 역할과 비간섭 경계

WebUI는 공개 정적 화면, 접근성, 조회 상태, 결과 표시·비교·내보내기와 공개 API 응답의 실패 폐쇄 검증을 담당한다.

Backend는 `.ctwebui` 생성·정규화·봉인, coverage와 missing reason, source priority와 raw fallback, 관측기관 실제 사용량·라이선스·표장 계약을 담당한다. WebUI는 이 값을 재계산하거나 기관 사용 여부를 `dataMode`로 추론하지 않는다. Backend 저장소, 실행 작업, 산출물과 배포 상태는 이 저장소 작업에서 변경하지 않는다.

## 공개 관측자료 attribution 계약

Backend `05fd49a…`는 schema version `1`을 다음 위치에 공개한다.

- `GET /api/climate/attribution`
- metadata, query, series의 `observationAttribution`

`observationAttribution`의 필드는 다음 다섯 개로 고정한다.

- `schemaVersion`
- `ready`
- `usesObservationData`
- `providerIds`
- `providers`

각 provider는 `providerId`, `name`, `dataset`, `licenseName`, `licenseUrl`, `citation`, `attributionText`, `redistributionPolicy`, `usedRowCount`, `attributionRequired`, `requiresResultMark`, `markAssets`를 제공한다. 각 mark descriptor는 `name`, `path`, `sha256`, `sizeBytes`, `mediaType`을 제공한다.

적용 규칙은 다음과 같다.

- 관측자료를 사용한 결과만 `usesObservationData=true`이며 실제 provider를 표시한다.
- raw-only 결과는 canonical attribution이 준비돼 있어도 `usesObservationData=false`, 빈 provider 배열과 최상위 `attributionReady=false`를 반드시 반환해야 한다.
- 관측자료 기반 결과에서 embedded contract가 준비되지 않았거나 provider 순서·식별자·사용량이 맞지 않으면 WebUI가 응답과 내보내기를 거부한다.
- `licenseUrl`은 exact schema 자리의 안전한 공개 HTTPS 주소만 허용한다.
- mark path는 안전한 `licenses/<name>` 상대경로만 허용하며 descriptor의 이름, SHA-256, 크기와 media type이 검증된 로컬 원본 자산과 모두 일치할 때만 표시·포함한다.
- 프로젝트·CMIP6·방법론 인용은 `CITATION.cff`와 공개 Attribution 카탈로그에 유지하고 관측 provider 사용 증거와 분리한다.
- 자격 증명, 로컬·네트워크 경로, Drive/GCS 원본 위치와 내부 캐시 경로는 공개하지 않는다.

## publication 검증 기준

- `.ctwebui` format v3, `atomic-directory-v2`, observation contract v1을 사용한다.
- 불변 release pointer, dataset identity, completion marker, manifest binding, canonical dataset seal과 artifact inventory가 일치해야 한다.
- WebUI publication validator는 필수 Zarr에 `directory_content_sha256_v2`만 허용하고, `directory_listing_v1`은 필수 Zarr 이외의 선언 디렉터리에만 호환 목적으로 허용한다.
- 발행 전 `full` 검증은 선언된 파일과 디렉터리 content digest를 확인한다.
- 공개 서버 시작 경로는 같은 대형 Zarr를 Frontend와 Backend에서 중복 전체 해시하지 않는다. pointer·경로·manifest identity의 가벼운 경계를 먼저 확인하고, loopback Backend의 metadata와 attribution readiness가 같은 dataset identity로 검증된 뒤에만 공개 listener를 연다.
- 환경변수만으로 비봉인 legacy fixture를 공개 서버 경로에 넣을 수 없어야 한다. 시험 fixture가 필요하면 명시적인 시험 전용 함수에만 주입하고 public server는 `testOnly` 값을 다시 거부한다.

## PR 완료 게이트

다음 검증은 Backend나 GCS 실서비스를 호출하지 않는 로컬·PR 범위에서 수행한다.

1. `corepack pnpm install --frozen-lockfile`
2. `corepack pnpm test`
3. `corepack pnpm build`
4. `node scripts/verify-reproducible-build.mjs`
5. `corepack pnpm verify:cloud-policy`
6. `git diff --check`
7. Windows와 Linux GitHub PR CI

다음 작업은 별도 Backend·배포 조율 없이는 수행하지 않는다.

- `verify:public-data`
- `attest:production`
- `verify:deployment`
- Pages 수동 실행 또는 `main` 직접 push
- Cloud Run/GCS release pointer 생성·승격

## 배포 전 남은 실환경 증거

- 최신 sealed publication에 대한 실제 query/series/attribution 대조
- 대용량 GCSFuse 자료판의 cold-start와 단일 content-verification 성능
- 데스크톱·모바일·Android의 출처 패널, 표장, 저장·공유, 키보드·화면읽기 회귀
- Pages와 Cloud Run 후보 리비전의 바이트 동일성 및 공개 안전성 확인

이 실환경 증거가 없으면 PR 자동 회귀 통과를 운영 배포 완료로 해석하지 않는다.
