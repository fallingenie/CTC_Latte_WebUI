# WebUI 다음 작업 기준

코드·계약 판단에서는 GitHub에 표시된 Update Time이 가장 최신인 WebUI 자료를 정본으로 삼고, 실행하지 않은 검증은 완료로 표시하지 않는다. Backend RC 번호나 과거 Thread의 진술을 Frontend 실행 조건으로 사용하지 않는다.

## 역할과 비간섭 경계

- 이 저장소는 `CTC_Latte_WebUI` Frontend다.
- Backend Master가 Frontend에서 읽을 수 있도록 생성하고 운영자가 GCS에 탑재한 ctwebui는 정식 소비 입력이다.
- Frontend는 Backend validator나 release admission gate가 아니다. Backend 내부 completion·attribution contract 세대를 다시 심사하지 않는다.
- Frontend는 ctwebui를 read-only로 읽고 metadata·query·series·attribution 공개 API, 화면 표시와 CSV·PDF·PNG·HTML 내보내기까지의 소비 경로를 소유한다.
- ctwebui 원본, Backend 저장소·브랜치·정책·API 계약·배포를 수정하지 않는다.
- GCS 주소, 버킷·객체·마운트 경로, 서비스 계정과 자격 증명을 브라우저 번들·응답·로그에 노출하지 않는다.

## 현재 GCS RC 기준

- 버킷은 `ctc_latte` 하나이며 자료 prefix는 `webui/`다.
- 버킷은 운영자가 공개 또는 비공개로 바꿀 수 있다. 서버는 배포 서비스 계정으로 read-only 접근한다.
- `webui/`에 운영자가 탑재한 최신 Update Time 자료를 우선한다.
- 시작 시 작은 control JSON과 작은 attribution Parquet만 읽는다. Zarr·대형 Parquet 본문을 전수 해시하지 않는다.
- 실제 attribution 표의 provider·순서·사용 행 수·표장 descriptor만 공개 schema v1으로 투영하며 없는 값을 추정하지 않는다.
- `raw-model-grid` 결과는 `usesObservationData=false`, 빈 provider 배열과 최상위 `attributionReady=false`를 반환한다.
- 기존 정상 Cloud Run 리비전 `ctc-latte-rc-00001-gif`의 100% 트래픽은 후보 검증 전 변경하지 않는다.
- 실패한 `ctc-latte-rc-00004-p9g`는 사용하지 않는다.
- 새 후보는 `--no-traffic`과 별도 tag로 배포하고 metadata·attribution·query·series와 실제 화면을 검증한 뒤에만 별도 승인으로 승격한다.

## PR 완료 게이트

1. `corepack pnpm install --frozen-lockfile`
2. `corepack pnpm test`
3. `corepack pnpm build`
4. `node scripts/verify-reproducible-build.mjs`
5. `corepack pnpm verify:cloud-policy`
6. `python -m py_compile scripts/read_ctwebui_attribution.py`
7. `git diff --check`
8. Windows와 Linux GitHub PR CI

CI에서 account payment 또는 spending limit 소진만을 이유로 실패한 check는 코드 결함으로 판정하지 않는다. 다른 실제 검증 실패는 그대로 조사한다.

## 실환경 개방 게이트

- GCS 원본과 기존 정상 리비전의 트래픽을 변경하지 않은 상태에서 후보가 시작해야 한다.
- 후보의 네 API가 같은 dataset identity와 공개 안전 스키마를 반환해야 한다.
- 학생·일반, 교사, 다크 모드와 모바일·태블릿·데스크톱 화면에서 실제 자료가 표시되어야 한다.
- 브라우저 네트워크·번들·내보내기에 GCS 정보나 자격 증명이 없어야 한다.
- 위 증거가 없으면 로컬·PR 자동 회귀 통과를 운영 트래픽 승격 완료로 해석하지 않는다.
