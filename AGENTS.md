# AGENTS.md

Project-specific guidance for AI coding agents.

## GCS ctwebui 교체 운영 규칙

- WebUI 자료에는 `ctc_latte` GCS 버킷 하나만 사용하며, 복제·대체 버킷을 만들거나 연결하지 않는다.
- 자료는 동일한 `ctc_latte` 버킷의 `webui/` 경로에서 읽는다.
- `ctc_latte` 버킷은 운영자가 언제든 공개 또는 비공개로 전환할 수 있으므로, 현재 공개 상태를 고정된 전제로 간주하지 않는다.
- 애플리케이션은 버킷 공개 여부와 관계없이 배포 환경에 연결된 서비스 계정의 네이티브 인증으로 읽을 수 있어야 한다.
- 버킷 공개 여부를 자료 정합성, 최신성, 배포 완료의 증거로 사용하지 않으며, 공개 버킷에도 비밀정보나 인증 파일을 저장하지 않는다.
- `webui/`의 ctwebui 구성 파일을 제자리 교체하기 전에 GitHub Pages와 Vercel을 포함한 모든 공개 Frontend 호스팅을 먼저 중단한다.
- 파일 교체가 진행되는 동안에는 공개 호스팅이나 사용자 트래픽을 재개하지 않는다.
- 교체 완료 후 `manifest.json`, `meta/completion.json`, 자료판 결합값, Backend API 준비 상태를 새 실행에서 검증한다.
- 검증이 모두 통과한 뒤에만 GitHub Pages 또는 Vercel 호스팅을 다시 공개한다.
- 이 운영 중단 절차는 정식 배포의 보안 검증과 fail-closed 동작을 완화하거나 대체하지 않는다.
- 서비스 계정 JSON 키를 저장소나 Frontend에 포함하지 않는다.

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
