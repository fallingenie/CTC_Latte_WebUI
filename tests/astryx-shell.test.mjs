import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [appSource, shellSource, themeModeSource, themeSource, viteSource, packageSource] = await Promise.all([
  readFile(new URL("source/public-app.js", root), "utf8"),
  readFile(new URL("source/astryx-app-shell.js", root), "utf8"),
  readFile(new URL("source/theme-mode.js", root), "utf8"),
  readFile(new URL("source/astryx-theme.css", root), "utf8"),
  readFile(new URL("source/vite.config.js", root), "utf8"),
  readFile(new URL("package.json", root), "utf8")
]);

test("Astryx 중립 테마와 앱 셸을 인증 뒤 공개 앱 진입점에서 불러온다", () => {
  assert.match(appSource, /@astryxdesign\/core\/reset\.css/u);
  assert.match(appSource, /@astryxdesign\/core\/astryx\.css/u);
  assert.match(appSource, /@astryxdesign\/theme-neutral\/theme\.css/u);
  assert.match(appSource, /from "\.\/astryx-app-shell\.js"/u);
  assert.match(shellSource, /neutralTheme/u);
  assert.match(packageSource, /"@astryxdesign\/theme-neutral": "\^0\.3\.0"/u);
  assert.match(packageSource, /"theme": "@astryxdesign\/theme-neutral"/u);
});

test("셸은 학생·교사·일반 화면을 같은 AppShell과 반응형 TopNav에 유지한다", () => {
  for (const component of ["AppShell", "TopNav", "TopNavHeading", "TopNavItem", "Stack", "SegmentedControl", "Button"]) {
    assert.match(shellSource, new RegExp(`\\b${component}\\b`, "u"));
  }
  assert.match(shellSource, /mobileNav: \{ breakpoint: "lg" \}/u);
  assert.match(shellSource, /className: `app route-\$\{route\.slice\(1\)\}`/u);
  assert.match(shellSource, /navItems\.map/u);
});

test("테마 상태와 화면 셸은 Backend 계약 및 게이트웨이 구현과 분리한다", () => {
  assert.match(appSource, /useThemeMode/u);
  assert.match(themeModeSource, /prefers-color-scheme: dark/u);
  assert.match(themeModeSource, /document\.documentElement\.dataset\.theme = resolved/u);
  assert.doesNotMatch(`${shellSource}\n${themeModeSource}`, /\/api\/climate|observationAttribution|datasetVersion|runtime-policy/u);
});

test("A 학생·일반, B 교사, C 다크 팔레트와 모바일 전환을 Astryx 토큰으로 정의한다", () => {
  assert.match(themeSource, /\.route-query \.panel/u);
  assert.match(themeSource, /\.route-public \.public-command-bar/u);
  assert.match(themeSource, /\.route-teacher :is\(/u);
  assert.match(themeSource, /html\[data-theme="dark"\]/u);
  assert.match(themeSource, /var\(--color-background-body\)/u);
  assert.match(themeSource, /var\(--radius-container\)/u);
  assert.match(themeSource, /@media \(max-width: 960px\)/u);
  assert.match(themeSource, /@media \(max-width: 600px\)/u);
  assert.doesNotMatch(themeSource, /#[0-9a-f]{3,8}\b/iu);
});

test("생산 빌드는 React, Astryx, PDF, DOCX, ZIP, 아이콘 의존성을 별도 청크로 나눈다", () => {
  for (const chunk of ["react-vendor", "astryx-vendor", "pdf-vendor", "docx-vendor", "archive-vendor", "icons-vendor"]) {
    assert.match(viteSource, new RegExp(`"${chunk}"`, "u"));
  }
  assert.match(appSource, /await import\("\.\/climate-pdf\.js"\)/u);
});
