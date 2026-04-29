import type {
  CallExpression,
  Expression,
  ImportBinding,
  JsxAttribute,
  ObjectExpression,
  ObjectProperty,
  Source,
  SourceLocation,
  Variable,
} from "@/parser";
import type { ExtractorPlugin, RoutingAnalysis } from "../../extractor";

type Route = RoutingAnalysis["routes"][number];
type Navigation = RoutingAnalysis["navigations"][number];
type RouteTarget = Route["path"];
type AnalysisConfidence = Route["confidence"];
type NavigationMethod = Navigation["method"];

type ReactRouterApi =
  | "Link"
  | "NavLink"
  | "Navigate"
  | "Route"
  | "useNavigate"
  | "createBrowserRouter";

type ResolvedTarget = {
  target: RouteTarget;
  evidence: SourceLocation;
};

const REACT_ROUTER_MODULES = new Set(["react-router", "react-router-dom"]);
const REACT_ROUTER_APIS = new Set<ReactRouterApi>([
  "Link",
  "NavLink",
  "Navigate",
  "Route",
  "useNavigate",
  "createBrowserRouter",
]);

export function reactRouterPlugin(): ExtractorPlugin {
  return {
    name: "react-router",
    isApplicableTo(source) {
      return collectReactRouterBindings(source.imports).size > 0;
    },
    analyze(source) {
      const bindings = collectReactRouterBindings(source.imports);
      const navigatorNames = collectNavigatorNames(source.variables, bindings);

      return {
        framework: "react-router",
        pluginName: "react-router",
        filePath: source.filePath,
        routes: [
          ...collectJsxRoutes(source, bindings),
          ...collectCreateBrowserRouterRoutes(source, bindings),
        ],
        navigations: [
          ...collectJsxNavigations(source, bindings),
          ...collectNavigateCalls(source, navigatorNames),
        ],
      };
    },
  };
}

function collectReactRouterBindings(imports: ImportBinding[]): Map<string, ReactRouterApi> {
  const bindings = new Map<string, ReactRouterApi>();

  for (const binding of imports) {
    if (
      binding.kind !== "named" ||
      binding.isTypeOnly ||
      !REACT_ROUTER_MODULES.has(binding.module) ||
      !binding.local ||
      !isReactRouterApi(binding.imported)
    ) {
      continue;
    }

    bindings.set(binding.local, binding.imported);
  }

  return bindings;
}

function isReactRouterApi(value: string | undefined): value is ReactRouterApi {
  return value !== undefined && REACT_ROUTER_APIS.has(value as ReactRouterApi);
}

function collectNavigatorNames(
  variables: Variable[],
  bindings: Map<string, ReactRouterApi>,
): Set<string> {
  const navigators = new Set<string>();

  for (const variable of variables) {
    const initializer = variable.initializer;
    if (
      initializer?.kind === "call" &&
      initializer.callee.kind === "identifier" &&
      bindings.get(initializer.callee.name) === "useNavigate"
    ) {
      navigators.add(variable.name);
    }
  }

  return navigators;
}

function collectJsxNavigations(
  source: Source,
  bindings: Map<string, ReactRouterApi>,
): Navigation[] {
  const navigations: Navigation[] = [];

  for (const element of source.jsxElements) {
    const api = bindings.get(element.tagName);

    if (api === "Link" || api === "NavLink") {
      const resolvedTarget = targetFromAttribute(findAttribute(element.attributes, "to"));

      if (resolvedTarget) {
        navigations.push({
          kind: "link",
          target: resolvedTarget.target,
          method: "declarative",
          confidence: confidenceForTarget(resolvedTarget.target),
          evidence: resolvedTarget.evidence,
        });
      }
    }

    if (api === "Navigate") {
      const resolvedTarget = targetFromAttribute(findAttribute(element.attributes, "to"));

      if (resolvedTarget) {
        navigations.push({
          kind: "redirect",
          target: resolvedTarget.target,
          method: isBooleanAttributeTrue(findAttribute(element.attributes, "replace"))
            ? "replace"
            : "push",
          confidence: confidenceForTarget(resolvedTarget.target),
          evidence: resolvedTarget.evidence,
        });
      }
    }
  }

  return navigations;
}

function collectNavigateCalls(source: Source, navigatorNames: Set<string>): Navigation[] {
  return source.calls.flatMap((call): Navigation[] => {
    if (
      call.callee.kind !== "identifier" ||
      !navigatorNames.has(call.callee.name) ||
      !call.arguments[0]
    ) {
      return [];
    }

    const target = targetFromExpression(call.arguments[0]);

    return [
      {
        kind: "navigate",
        target,
        method: methodFromNavigateOptions(call.arguments[1]),
        confidence: confidenceForTarget(target),
        evidence: call.location,
      },
    ];
  });
}

function collectJsxRoutes(source: Source, bindings: Map<string, ReactRouterApi>): Route[] {
  const routes: Route[] = [];

  for (const element of source.jsxElements) {
    if (bindings.get(element.tagName) !== "Route") {
      continue;
    }

    const resolvedPath = targetFromAttribute(findAttribute(element.attributes, "path"));

    if (resolvedPath) {
      routes.push({
        kind: "route",
        path: resolvedPath.target,
        confidence: confidenceForTarget(resolvedPath.target),
        evidence: resolvedPath.evidence,
      });
    }
  }

  return routes;
}

function collectCreateBrowserRouterRoutes(
  source: Source,
  bindings: Map<string, ReactRouterApi>,
): Route[] {
  return source.calls.flatMap((call) => {
    if (!isCallToReactRouterApi(call, bindings, "createBrowserRouter") || !call.arguments[0]) {
      return [];
    }

    return collectRoutesFromExpression(call.arguments[0]);
  });
}

function isCallToReactRouterApi(
  call: CallExpression,
  bindings: Map<string, ReactRouterApi>,
  api: ReactRouterApi,
): boolean {
  return call.callee.kind === "identifier" && bindings.get(call.callee.name) === api;
}

function collectRoutesFromExpression(expression: Expression): Route[] {
  if (expression.kind === "array") {
    return expression.elements.flatMap((element) => collectRoutesFromExpression(element));
  }

  if (expression.kind !== "object") {
    return [];
  }

  return collectRoutesFromObject(expression);
}

function collectRoutesFromObject(expression: ObjectExpression): Route[] {
  const routes: Route[] = [];
  const path = propertyNamed(expression.properties, "path");

  if (path?.kind === "property") {
    const target = targetFromExpression(path.value);
    routes.push({
      kind: "route",
      path: target,
      confidence: confidenceForTarget(target),
      evidence: path.value.location,
    });
  }

  const children = propertyNamed(expression.properties, "children");

  if (children?.kind === "property") {
    routes.push(...collectRoutesFromExpression(children.value));
  }

  return routes;
}

function propertyNamed(
  properties: ObjectProperty[],
  name: string,
): ObjectProperty | undefined {
  return properties.find((property) => property.kind !== "spread" && property.name === name);
}

function findAttribute(
  attributes: JsxAttribute[],
  name: string,
): Extract<JsxAttribute, { kind: "attribute" }> | undefined {
  return attributes.find(
    (attribute): attribute is Extract<JsxAttribute, { kind: "attribute" }> =>
      attribute.kind === "attribute" && attribute.name === name,
  );
}

function targetFromAttribute(
  attribute: Extract<JsxAttribute, { kind: "attribute" }> | undefined,
): ResolvedTarget | undefined {
  if (!attribute?.value) {
    return undefined;
  }

  return {
    target: targetFromExpression(attribute.value),
    evidence: attribute.value.location,
  };
}

function targetFromExpression(expression: Expression): RouteTarget {
  if (expression.kind === "string") {
    return {
      kind: "static",
      value: expression.value,
    };
  }

  return {
    kind: "dynamic",
    raw: expressionToRaw(expression),
  };
}

function confidenceForTarget(target: RouteTarget): AnalysisConfidence {
  return target.kind === "static" ? "high" : "low";
}

function methodFromNavigateOptions(options: Expression | undefined): NavigationMethod {
  if (options?.kind !== "object") {
    return "push";
  }

  const replace = propertyNamed(options.properties, "replace");

  if (replace?.kind === "property" && replace.value.kind === "boolean" && replace.value.value) {
    return "replace";
  }

  return "push";
}

function isBooleanAttributeTrue(
  attribute: Extract<JsxAttribute, { kind: "attribute" }> | undefined,
): boolean {
  return attribute?.value?.kind === "boolean" && attribute.value.value;
}

function expressionToRaw(expression: Expression): string {
  switch (expression.kind) {
    case "string":
      return expression.raw;
    case "number":
      return expression.raw;
    case "boolean":
      return String(expression.value);
    case "null":
      return "null";
    case "identifier":
      return expression.name;
    case "member":
      return typeof expression.property === "string"
        ? `${expressionToRaw(expression.object)}.${expression.property}`
        : `${expressionToRaw(expression.object)}[${expressionToRaw(expression.property)}]`;
    case "call":
      return `${expressionToRaw(expression.callee)}(...)`;
    case "object":
      return "{...}";
    case "array":
      return "[...]";
    case "template":
      return expression.raw;
    case "unknown":
      return expression.raw;
  }
}
