# AGENTS.md

Project-specific guidance for AI coding agents.

## Android TWA 종속 작업 경계

- 이 WebUI 작업은 `codex://threads/019fe64a-69fb-73c3-af71-436f64276de9` Android TWA 종속 작업에 대해 Frontend 공개 계약과 자료를 제공하는 Master 정본 역할만 수행한다.
- Android 작업에는 운영 origin, manifest, 동일 출처 API 계약, Digital Asset Links, GitHub SHA와 검증 결과처럼 WebUI가 소유한 자료만 제공한다.
- Android 저장소·브랜치·파일·빌드·디버깅·패키징·서명·Release·Play Console을 수정하거나 대신 결정하지 않으며, Android 작업의 역할·구현·진행 방식에 개입하지 않는다.
- Android 작업의 상태 공유와 후보 전달은 읽기 전용 handoff로 취급한다. WebUI 저장소 변경은 사용자가 명시적으로 요청한 WebUI 소유 자료를 게시할 때만 이 저장소 안에서 수행한다.
- Android 작업도 WebUI Master 저장소·브랜치·정책·API 계약·보안·fail-closed 동작·배포를 수정하거나 대신 결정하지 않는다. 공통 변경 필요 사항은 어느 쪽에서도 상대 저장소를 직접 수정하지 않고 제안 또는 자료로만 전달한다.

## WebUI 역할과 책임 경계

- 이 저장소의 역할은 `CTC_Latte_WebUI` Frontend다. Backend가 생성해 운영자가 GCS에 탑재한 ctwebui를 소비하여 학생·일반 사용자·교사 화면과 내보내기에 정확히 표출한다.
- Frontend 버전은 Backend RC 버전과 독립적으로 관리한다. Backend Master가 RC9 등 더 최신 단계로 승격하더라도 Frontend 버전을 억지로 맞추거나 Backend 버전을 Frontend의 실행 조건으로 사용하지 않는다.
- Backend가 Frontend에서 읽을 수 있도록 생성한 ctwebui는 조작 자료가 아니라 정식 소비 입력이다. GCS에 운영자가 탑재한 현재 자료를 그대로 사용하며, 내부 생성 이력이나 publication 세대를 이유로 사용을 거부하지 않는다.
- Backend Master는 ctwebui 생성, 내부 publication 정책, 내부 contract evolution과 산출물의 의미를 소유한다. WebUI는 Backend의 validator나 release admission gate가 아니며 이 책임을 대신 판단하지 않는다.
- WebUI는 GCS의 현재 ctwebui를 서버 측에서 read-only로 읽고, 실제 존재하는 metadata·기후자료·관측자료 출처를 공개 API 계약으로 안전하게 투영하며, UI와 CSV·PDF·PNG·HTML 내보내기까지 이어지는 end-to-end 소비 경로를 소유한다.
- WebUI 검증은 파일의 존재·가독성·자료형·공개 API 스키마·자료판 identity 일치·비밀정보 비노출·실제 화면 표출에 한정한다. Backend 내부 completion 또는 attribution contract 버전만을 이유로 운영자가 탑재한 ctwebui의 소비를 거부하지 않는다.
- ctwebui 원본을 수정·재봉인·재출판·업그레이드·다운그레이드·재분류하지 않는다. contract version, datasetVersion, seal 또는 fingerprint를 바꾸거나 없는 자료·출처를 추정 생성하지 않는다.
- Backend 소스, 작업트리, 브랜치, 정책, API 계약과 배포를 수정하지 않는다. 공통 기반 변경이 필요하면 Backend에 제안만 하고 WebUI에서 대신 결정하거나 적용하지 않는다.
- 브라우저에는 GCS 주소, 버킷·객체 경로, 로컬 마운트 경로, 서비스 계정 또는 자격 증명을 노출하지 않는다. 브라우저는 공개 WebUI API만 호출하며 GCS 접근은 서버 전용으로 유지한다.
- 과거 Thread, 캐시, 로컬 복사본보다 확인 시점의 GCS `webui/`에 운영자가 탑재한 최신 Update Time 자료를 정본으로 우선한다.

## GCS ctwebui 교체 운영 규칙

- WebUI 자료에는 `ctc_latte` GCS 버킷 하나만 사용하며, 복제·대체 버킷을 만들거나 연결하지 않는다.
- 자료는 동일한 `ctc_latte` 버킷의 `webui/` 경로에서 읽는다.
- `ctc_latte` 버킷은 운영자가 언제든 공개 또는 비공개로 전환할 수 있으므로, 현재 공개 상태를 고정된 전제로 간주하지 않는다.
- 애플리케이션은 버킷 공개 여부와 관계없이 배포 환경에 연결된 서비스 계정의 네이티브 인증으로 읽을 수 있어야 한다.
- 버킷 공개 여부를 자료 정합성, 최신성, 배포 완료의 증거로 사용하지 않으며, 공개 버킷에도 비밀정보나 인증 파일을 저장하지 않는다.
- `webui/`의 ctwebui 구성 파일을 제자리 교체하기 전에 GitHub Pages와 Vercel을 포함한 모든 공개 Frontend 호스팅을 먼저 중단한다.
- 파일 교체가 진행되는 동안에는 공개 호스팅이나 사용자 트래픽을 재개하지 않는다.
- 교체 완료 후 현재 ctwebui의 필수 파일 존재와 가독성, 공개 API 자료판 identity, metadata·query·series·attribution 응답 및 실제 화면 표출을 새 실행에서 검증한다.
- 검증이 모두 통과한 뒤에만 GitHub Pages 또는 Vercel 호스팅을 다시 공개한다.
- 이 운영 중단 절차는 정식 배포의 보안 검증과 fail-closed 동작을 완화하거나 대체하지 않는다.
- 서비스 계정 JSON 키를 저장소나 Frontend에 포함하지 않는다.
- WebUI 배포는 Backend 원격 SHA를 조회하거나 Backend 소스를 archive·복사하지 않으며, Backend 작업트리·브랜치·정책을 수정하지 않는다.
- WebUI는 `ctc_latte/webui/`에 운영자가 수동 탑재한 ctwebui와 공개 API 계약만 검증하고, Backend 버전 선택이나 ctwebui 생성 절차를 대신 결정하지 않는다.

<!-- ASTRYX:START -->
Astryx v0.3.0 · 155 components
CLI: run every command as `pnpm exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing. Full page → AppShell; sidebar nav → SideNav.
- Frame first: pick the shell (AppShell / Layout+LayoutPanel) and budget regions in px BEFORE writing content (`astryx docs layout`).
- Dense data = rows (Table, List/Item) edge-to-edge — never Card-wrapped list items. Card = dashboard widgets, galleries, settings groups only.
- Status → StatusDot/Token; Badge only for counts and enumerated states, never decoration.
- Custom styling: component props first; else style/className with tokens — var(--color-*|--spacing-*|--radius-*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent via `astryx theme` — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any raw <div>/<span> layout, imported .css/@apply, or hardcoded value (#hex, 16px) with the component or a token (var(--color-*|--spacing-*|…)). If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   155 components by category
  template --list    page + block recipes
  docs <topic>       color, elevation, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling, theme, tokens, typography
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any @astryxdesign/core bump
<!-- ASTRYX:END -->
