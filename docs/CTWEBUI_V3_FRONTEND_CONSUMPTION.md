# ctwebui v3 Frontend 소비 계약

## 책임 경계

WebUI는 `.ctwebui` 디렉터리나 배포용 ZIP을 브라우저에서 직접 읽지 않는다. Backend가
`/api/climate/*`로 투영한 공개 JSON만 소비한다. 따라서 GCS 주소, 마운트 경로,
Parquet/Zarr 경로, 봉인 정보와 자격 증명은 Frontend 입력이나 출력에 포함하지 않는다.

Backend의 내부 observation attribution contract v2와 공개
`observationAttribution.schemaVersion = 1`은 서로 다른 계약이다. Frontend는 현재 gateway가
투영하는 공개 schema v1을 유지한다.

## 기준으로 대조한 v3 형태

- `.ctwebui`는 Parquet, JSON, Zarr가 함께 있는 디렉터리다.
- `manifest.json`은 format version 3, publication contract `atomic-directory-v2`, observation
  contract version 2를 선언한다.
- 배열의 차원과 라벨은 `meta/array_index.json`에서 읽으며 저장 축은 location, time,
  scenario, model, variable이다.
- 필수 배열은 raw daily, corrected daily, coverage mask, raw quality status, corrected quality
  status 다섯 가지다.
- 내부 품질 코드는 MISSING=0, VALID=1, OOR=2이고 OOR 수치는 NaN이다.
- attribution, completion, canonical seal과 generation lease의 검사 및 대형 본문 접근은
  Backend/gateway 책임이다.

이 내부 구조 정보는 Frontend가 publication 적격성을 다시 판단하기 위한 조건이 아니다.
운영자가 탑재한 현재 자료를 Backend의 공개 API가 투영하면 Frontend는 그 소비 계약만
검증하고 읽기·해석·표출한다.

## 공개 응답 해석

| 공개 필드 | Frontend 의미 |
| --- | --- |
| `dataMode = bias-corrected` | 주값은 관측 자료 기반 보정값이다. 요청한 경우에만 보정 전 값을 비교한다. |
| `dataMode = raw-model-grid` | 주값은 기후 모델 원자료다. 관측 자료 기반 보정값으로 표시하지 않는다. |
| `coverage = available` | 요청한 결과가 제공된다. |
| `coverage = fallback` | 일부 값 또는 원자료/기준 지점 대체가 포함된다. `fallbackReason`을 함께 표시한다. |
| `coverage = missing` | 제공 가능한 주값이 없다. 숫자 0으로 바꾸지 않는다. |
| `metrics[].coverage = false` | 해당 날짜의 값은 결측이다. 차트·내보내기에서 null/빈 칸으로 유지한다. |
| `observationAttribution` | gateway가 제공한 provider, 사용 행 수, 라이선스와 표장 descriptor만 사용한다. |

기간 응답의 `raw-model-grid` 주계열은 명시적 `metrics[].raw`가 있으면 이를 우선하고,
그렇지 않으면 기존 공개 계약의 `metrics[].corrected` 슬롯을 원자료 주계열로 해석한다.
Frontend는 어느 경우든 먼저 `primaryKind`와 `primary` 표시 모델로 바꾸며, 슬롯 이름을
근거로 원자료를 보정값이라고 표시하지 않는다.

공개 gateway가 `coverage=true`라고 응답하면서 두 슬롯 모두 실제 원자료 수치를 제공하지
않으면 Frontend에서 그 수치를 복원하거나 추정하지 않는다. 이 응답은 계약 불일치로
실패 폐쇄하며, 원자료 기간 표출 완료를 주장하지 않는다.

## 알려진 공개 계약 gap

현재 확인한 gateway 공개 응답에는 내부 `raw_quality_status`,
`corrected_quality_status`, `missing_reason`이 없다. Frontend는 MISSING, VALID, OOR 또는
결측 사유를 coverage만으로 추정하지 않는다. 지금 구현하는 것은 다음 두 가지뿐이다.

1. null과 coverage를 보존하고 0으로 채우지 않는다.
2. 향후 공개 필드가 확정될 때 표시 어댑터를 확장할 수 있도록 capability 경계를 둔다.

이는 품질 상태를 영구적으로 지원하지 않는다는 결정이 아니다. Backend가 공개 확장
필요성과 schema를 결정하고 실제 fixture를 제공해야 OOR 및 결측 사유 소비를 검증할 수
있다. OOR가 포함된 실제 fixture가 오기 전에는 OOR 소비 검증 통과를 주장하지 않는다.

## 자료판 전환과 오류 처리

- metadata, attribution, query, series의 `datasetVersion`과 `datasetUpdatedAt`을 같은 세대로
  맞춘다.
- 조건 변경, 취소 또는 세대 전환 때 이전 요청을 중단한다. 이미 완료된 이전 요청이 새
  결과를 덮지 못하게 한다.
- 공개된 retryable 503만 제한된 횟수로 재시도한다. 무한 재시도하지 않는다.
- health 200만으로 자료판 준비 완료를 판단하지 않는다.
- 계약 오류, 연결 오류, 재시도 가능 오류와 자료 없음 상태를 같은 상태로 합치지 않는다.

## 최종 검증 게이트

최종 호환을 주장하려면 다음 자료가 모두 필요하다.

1. 최종 Backend commit SHA
2. 실제 신규 `.ctwebui` sample
3. 같은 sample에서 생성한 metadata, attribution, query, series gateway fixture
4. 실제 서비스에서 같은 자료판 identity로 네 endpoint와 화면을 통과한 E2E 증거

그 전의 자동 시험은 공개 builder 형태를 바탕으로 한 synthetic contract 회귀로만 보고한다.
