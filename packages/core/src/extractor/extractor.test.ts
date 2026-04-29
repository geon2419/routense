import { describe, expect, it } from "vitest";

import { parseSource } from "../parser";
import { type ExtractorPlugin, extractRouting } from "./extractor";
import { reactRouterPlugin } from "./plugins/react-router";

function pluginForFramework(
  framework: ExtractorPlugin["framework"],
  applicable: boolean,
): ExtractorPlugin {
  return {
    framework,
    canAnalyze: () => applicable,
    analyze: (source) => ({
      framework,
      filePath: source.filePath,
      routes: [],
      navigations: [],
    }),
  };
}

describe("extractRouting", () => {
  it("적용 대상이 아닌 plugin은 실행하지 않는다", () => {
    const source = parseSource({
      filePath: "/fixtures/plain.tsx",
      sourceText: `export function Page() { return null; }`,
    });

    expect(
      extractRouting({
        sources: [source],
        plugins: [pluginForFramework("react-router", false)],
      }),
    ).toEqual([]);
  });

  it("적용 가능한 모든 plugin을 실행하고 flat result array를 반환한다", () => {
    const firstSource = parseSource({
      filePath: "/fixtures/first.tsx",
      sourceText: `export function First() { return null; }`,
    });
    const secondSource = parseSource({
      filePath: "/fixtures/second.tsx",
      sourceText: `export function Second() { return null; }`,
    });
    const results = extractRouting({
      sources: [firstSource, secondSource],
      plugins: [
        pluginForFramework("react-router", true),
        pluginForFramework("nextjs-page-router", true),
      ],
    });

    expect(results).toHaveLength(4);
    expect(results.map((result) => `${result.filePath}:${result.framework}`)).toEqual([
      "/fixtures/first.tsx:react-router",
      "/fixtures/first.tsx:nextjs-page-router",
      "/fixtures/second.tsx:react-router",
      "/fixtures/second.tsx:nextjs-page-router",
    ]);
  });

  it("실제 React Router plugin을 적용해 routing analysis를 반환한다", () => {
    const source = parseSource({
      filePath: "/fixtures/app.tsx",
      sourceText: `
import { Link } from "react-router-dom";

export function App() {
  return <Link to="/dashboard" />;
}
`,
    });

    const results = extractRouting({
      sources: [source],
      plugins: [reactRouterPlugin()],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(
      expect.objectContaining({
        framework: "react-router",
        filePath: "/fixtures/app.tsx",
      }),
    );
    expect(results[0]?.navigations).toEqual([
      expect.objectContaining({
        kind: "link",
        method: "declarative",
        target: { kind: "static", value: "/dashboard" },
        confidence: "high",
      }),
    ]);
  });
});
