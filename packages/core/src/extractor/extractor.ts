import type { Source, SourceLocation } from "../parser";

type AnalysisConfidence = "high" | "low";

type RouteTarget =
  | {
      kind: "static";
      value: string;
    }
  | {
      kind: "dynamic";
      raw: string;
    };

type Route = {
  kind: "route";
  path: RouteTarget;
  confidence: AnalysisConfidence;
  evidence: SourceLocation;
};

type NavigationKind = "link" | "redirect" | "navigate";

type NavigationMethod = "declarative" | "push" | "replace";

type Navigation = {
  kind: NavigationKind;
  target: RouteTarget;
  method: NavigationMethod;
  confidence: AnalysisConfidence;
  evidence: SourceLocation;
};

type Framework = "react-router" | "nextjs-page-router" | "nextjs-app-router";

export type RoutingAnalysis = {
  framework: Framework;
  filePath: string;
  routes: Route[];
  navigations: Navigation[];
};

export type ExtractorPlugin = {
  framework: Framework;
  canAnalyze(source: Source): boolean;
  analyze(source: Source): RoutingAnalysis;
};

type ExtractInput = {
  sources: Source[];
};

export type ExtractRoutingInput = {
  sources: Source[];
  plugins: ExtractorPlugin[];
};

export class RoutenseExtractor {
  readonly #plugins: ExtractorPlugin[];

  constructor(input: { plugins: ExtractorPlugin[] }) {
    this.#plugins = input.plugins;
  }

  extract(input: ExtractInput): RoutingAnalysis[] {
    return input.sources.flatMap((source) => {
      return this.#plugins
        .filter((plugin) => plugin.canAnalyze(source))
        .map((plugin) => plugin.analyze(source));
    });
  }
}

export function extractRouting(input: ExtractRoutingInput): RoutingAnalysis[] {
  return new RoutenseExtractor({ plugins: input.plugins }).extract({
    sources: input.sources,
  });
}
