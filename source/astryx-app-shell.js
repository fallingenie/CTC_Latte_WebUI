import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { CloudSun, Monitor, Moon, Search, Sun } from "lucide-react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Stack } from "@astryxdesign/core/Stack";
import { Theme } from "@astryxdesign/core/theme";
import { TopNav, TopNavHeading, TopNavItem } from "@astryxdesign/core/TopNav";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

const themeOptions = [
  { key: "system", label: "시스템 설정 따르기", icon: Monitor },
  { key: "light", label: "밝게 보기", icon: Sun },
  { key: "dark", label: "어둡게 보기", icon: Moon }
];

function ThemeModeControl({ mode, onChange }) {
  const currentIndex = themeOptions.findIndex((option) => option.key === mode);
  const currentOption = themeOptions[currentIndex] ?? themeOptions[0];
  const CurrentIcon = currentOption.icon;
  const selectNextMode = () => {
    const nextIndex = (Math.max(currentIndex, 0) + 1) % themeOptions.length;
    onChange(themeOptions[nextIndex].key);
  };
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx(SegmentedControl, {
      className: "app-theme-control",
      label: "화면 테마",
      onChange,
      size: "sm",
      value: mode,
      children: themeOptions.map(({ key, label, icon: Icon }) => /* @__PURE__ */ jsx(SegmentedControlItem, {
        icon: /* @__PURE__ */ jsx(Icon, { size: 16 }),
        isLabelHidden: true,
        label,
        value: key
      }, key))
    }),
    /* @__PURE__ */ jsx(Button, {
      className: "app-theme-cycle",
      icon: /* @__PURE__ */ jsx(CurrentIcon, { size: 17 }),
      isIconOnly: true,
      label: `테마 전환, 현재 ${currentOption.label}`,
      onClick: selectNextMode,
      size: "lg",
      variant: "ghost"
    })
  ] });
}

function AppTopNavigation({ navItems, onOpenExamples, onThemeModeChange, route, themeMode }) {
  const navigation = /* @__PURE__ */ jsx(Fragment, { children: navItems.map((item) => /* @__PURE__ */ jsx(TopNavItem, {
    href: `#${item.route}`,
    icon: item.icon,
    isSelected: route === item.route,
    label: item.label
  }, item.route)) });
  const actions = /* @__PURE__ */ jsxs(HStack, { className: "app-nav-actions", gap: 1, vAlign: "center", children: [
    /* @__PURE__ */ jsx(ThemeModeControl, { mode: themeMode, onChange: onThemeModeChange }),
    /* @__PURE__ */ jsx(Button, {
      className: "header-example-button app-example-button-text",
      icon: /* @__PURE__ */ jsx(Search, { size: 17 }),
      label: "예시 보기",
      onClick: onOpenExamples,
      size: "lg",
      variant: "secondary"
    }),
    /* @__PURE__ */ jsx(Button, {
      className: "app-example-button-icon",
      icon: /* @__PURE__ */ jsx(Search, { size: 17 }),
      isIconOnly: true,
      label: "예시 보기",
      onClick: onOpenExamples,
      size: "lg",
      variant: "secondary"
    })
  ] });
  return /* @__PURE__ */ jsx(TopNav, {
    className: "app-top-nav",
    endContent: actions,
    heading: /* @__PURE__ */ jsx(TopNavHeading, {
      className: "app-brand",
      heading: "기후 타임캡슐",
      headingHref: "#/query",
      logo: /* @__PURE__ */ jsx(CloudSun, { "aria-hidden": true, size: 23 }),
      logoLabel: "기후 타임캡슐 학생 탐색",
      subheading: "미래 기후 지도"
    }),
    label: "사용자 화면 탐색",
    startContent: navigation
  });
}

export function ClimateAppShell({
  footer,
  navItems,
  onOpenExamples,
  onThemeModeChange,
  page,
  resolvedThemeMode,
  route,
  themeMode,
  topBar
}) {
  const topNav = /* @__PURE__ */ jsx(AppTopNavigation, {
    navItems,
    onOpenExamples,
    onThemeModeChange,
    route,
    themeMode
  });
  return /* @__PURE__ */ jsx(Theme, {
    mode: resolvedThemeMode,
    theme: neutralTheme,
    children: /* @__PURE__ */ jsxs(AppShell, {
      className: `app route-${route.slice(1)}`,
      contentPadding: 0,
      height: "auto",
      mobileNav: { breakpoint: "lg" },
      topNav,
      variant: "section",
      children: [
        /* @__PURE__ */ jsxs(Stack, { className: "main", gap: 0, children: [topBar, page] }),
        footer
      ]
    })
  });
}
