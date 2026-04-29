import { describe, expect, it } from "vitest";

import { parseSource } from "../../../parser";
import { reactRouterPlugin } from "./plugin";

function analyzeReactRouter(sourceText: string) {
  const plugin = reactRouterPlugin();
  const source = parseSource({
    filePath: "/fixtures/react-router.tsx",
    sourceText,
  });

  return plugin.analyze(source);
}

describe("reactRouterPlugin", () => {
  it("React Router import를 감지하고 type-only import는 무시한다", () => {
    const plugin = reactRouterPlugin();
    const applicableSource = parseSource({
      filePath: "/fixtures/app.tsx",
      sourceText: `
import type { Link as TypeLink } from "react-router-dom";
import { Link as RouterLink } from "react-router-dom";

export function App() {
  return <RouterLink to="/dashboard" />;
}
`,
    });
    const typeOnlySource = parseSource({
      filePath: "/fixtures/types.tsx",
      sourceText: `
import type { Link } from "react-router-dom";
`,
    });

    expect(plugin.canAnalyze(applicableSource)).toBe(true);
    expect(plugin.canAnalyze(typeOnlySource)).toBe(false);
  });

  it("alias가 적용된 Link, NavLink, Navigate JSX navigation을 수집한다", () => {
    const result = analyzeReactRouter(`
import { Link as RouterLink, NavLink as RouterNavLink, Navigate as Redirect } from "react-router-dom";

export function App() {
  return (
    <>
      <RouterLink to="/dashboard" />
      <RouterNavLink to="/settings" />
      <Redirect to="/login" replace />
    </>
  );
}
`);

    expect(result.navigations).toEqual([
      expect.objectContaining({
        kind: "link",
        method: "declarative",
        target: { kind: "static", value: "/dashboard" },
        confidence: "high",
      }),
      expect.objectContaining({
        kind: "link",
        method: "declarative",
        target: { kind: "static", value: "/settings" },
        confidence: "high",
      }),
      expect.objectContaining({
        kind: "redirect",
        method: "replace",
        target: { kind: "static", value: "/login" },
        confidence: "high",
      }),
    ]);
  });

  it("useNavigate hook이 반환한 변수의 navigation call을 수집한다", () => {
    const result = analyzeReactRouter(`
import { useNavigate as useNav } from "react-router";

const ignored = (to: string) => to;

export function App() {
  const navigate = useNav();
  ignored("/ignored");
  navigate("/login");
  navigate("/settings", { replace: true });
}
`);

    expect(result.navigations).toEqual([
      expect.objectContaining({
        kind: "navigate",
        method: "push",
        target: { kind: "static", value: "/login" },
      }),
      expect.objectContaining({
        kind: "navigate",
        method: "replace",
        target: { kind: "static", value: "/settings" },
      }),
    ]);
  });

  it("JSX Route와 createBrowserRouter의 route fact를 수집한다", () => {
    const result = analyzeReactRouter(`
import { Route, createBrowserRouter as createRouter } from "react-router-dom";

const routes = createRouter([
  {
    path: "/dashboard",
    children: [
      { path: "settings" },
    ],
  },
]);

export function App() {
  return <Route path="/login" element={<Login />} />;
}
`);

    expect(result.routes).toEqual([
      expect.objectContaining({
        kind: "route",
        path: { kind: "static", value: "/login" },
        confidence: "high",
      }),
      expect.objectContaining({
        kind: "route",
        path: { kind: "static", value: "/dashboard" },
        confidence: "high",
      }),
      expect.objectContaining({
        kind: "route",
        path: { kind: "static", value: "settings" },
        confidence: "high",
      }),
    ]);
  });

  it("동적 target은 낮은 confidence로 유지한다", () => {
    const result = analyzeReactRouter(`
import { Link, useNavigate } from "react-router-dom";

const target = "/dashboard";

export function App() {
  const navigate = useNavigate();
  navigate(target);
  return <Link to={target} />;
}
`);

    expect(result.navigations).toEqual([
      expect.objectContaining({
        kind: "link",
        target: { kind: "dynamic", raw: "target" },
        confidence: "low",
      }),
      expect.objectContaining({
        kind: "navigate",
        target: { kind: "dynamic", raw: "target" },
        confidence: "low",
      }),
    ]);
  });

  it("React Router에서 import되지 않은 JSX tag는 무시한다", () => {
    const result = analyzeReactRouter(`
import { useNavigate } from "react-router-dom";

export function App() {
  return <Link to="/dashboard" />;
}
`);

    expect(result.navigations).toEqual([]);
  });
});
