import type {
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
type JsxRegularAttribute = Extract<JsxAttribute, { kind: "attribute" }>;
type JsxRegularAttributeWithValue = JsxRegularAttribute & { value: Expression };

type ReactRouterAPI =
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
const REACT_ROUTER_APIS = new Set<ReactRouterAPI>([
  "Link",
  "NavLink",
  "Navigate",
  "Route",
  "useNavigate",
  "createBrowserRouter",
]);

export function reactRouterPlugin(): ExtractorPlugin {
  return {
    framework: "react-router",
    canAnalyze(source) {
      return collectReactRouterAPIs(source.imports).size > 0;
    },
    analyze(source) {
      const apis = collectReactRouterAPIs(source.imports);
      const navigators = collectNavigators(source.variables, apis);

      return {
        framework: "react-router",
        filePath: source.filePath,
        routes: [
          ...collectJsxRoutes(source, apis),
          ...collectCreateBrowserRouterRoutes(source, apis),
        ],
        navigations: [
          ...collectJsxNavigations(source, apis),
          ...collectNavigateCalls(source, navigators),
        ],
      };
    },
  };
}

function collectReactRouterAPIs(imports: ImportBinding[]): Map<string, ReactRouterAPI> {
  const apis = new Map<string, ReactRouterAPI>();

  for (const binding of imports) {
    const imported = binding.imported as ReactRouterAPI;

    if (
      binding.kind === "named" &&
      binding.local &&
      binding.isTypeOnly === false &&
      imported &&
      REACT_ROUTER_APIS.has(imported) &&
      REACT_ROUTER_MODULES.has(binding.module)
    ) {
      apis.set(binding.local, imported);
    }
  }

  return apis;
}

function collectNavigators(
  variables: Variable[],
  apis: Map<string, ReactRouterAPI>,
): Set<string> {
  const navigators = new Set<string>();

  for (const variable of variables) {
    const initializer = variable.initializer;
    if (
      initializer &&
      initializer.kind === "call" &&
      initializer.callee.kind === "identifier" &&
      apis.get(initializer.callee.name) === "useNavigate"
    ) {
      navigators.add(variable.name);
    }
  }

  return navigators;
}

function collectJsxNavigations(
  source: Source,
  apis: Map<string, ReactRouterAPI>,
): Navigation[] {
  const navigations: Navigation[] = [];

  for (const element of source.jsxElements) {
    const api = apis.get(element.tagName);

    if (api === "Link" || api === "NavLink") {
      const toAttribute = findAttribute(element.attributes, "to");
      if (!hasAttributeValue(toAttribute)) {
        continue;
      }

      const resolvedTarget = targetFromAttribute(toAttribute);

      navigations.push({
        kind: "link",
        target: resolvedTarget.target,
        method: "declarative",
        confidence: confidenceForTarget(resolvedTarget.target),
        evidence: resolvedTarget.evidence,
      });
    }

    if (api === "Navigate") {
      const toAttribute = findAttribute(element.attributes, "to");
      if (!hasAttributeValue(toAttribute)) {
        continue;
      }

      const resolvedTarget = targetFromAttribute(toAttribute);
      const replaceAttribute = findAttribute(element.attributes, "replace");

      navigations.push({
        kind: "redirect",
        target: resolvedTarget.target,
        method:
          replaceAttribute &&
          replaceAttribute.value?.kind === "boolean" &&
          replaceAttribute.value.value
            ? "replace"
            : "push",
        confidence: confidenceForTarget(resolvedTarget.target),
        evidence: resolvedTarget.evidence,
      });
    }
  }

  return navigations;
}

function collectNavigateCalls(source: Source, navigators: Set<string>): Navigation[] {
  return source.calls.flatMap((call): Navigation[] => {
    if (call.callee.kind === "identifier" && navigators.has(call.callee.name)) {
      const firstArgument = call.arguments[0];

      if (firstArgument) {
        const target = targetFromExpression(firstArgument);

        return [
          {
            kind: "navigate",
            target,
            method: methodFromNavigateOptions(call.arguments[1]),
            confidence: confidenceForTarget(target),
            evidence: call.location,
          },
        ];
      }
    }

    return [];
  });
}

function collectJsxRoutes(source: Source, apis: Map<string, ReactRouterAPI>): Route[] {
  const routes: Route[] = [];

  for (const element of source.jsxElements) {
    if (apis.get(element.tagName) !== "Route") {
      continue;
    }

    const pathAttribute = findAttribute(element.attributes, "path");
    if (!hasAttributeValue(pathAttribute)) {
      continue;
    }

    const resolvedPath = targetFromAttribute(pathAttribute);

    routes.push({
      kind: "route",
      path: resolvedPath.target,
      confidence: confidenceForTarget(resolvedPath.target),
      evidence: resolvedPath.evidence,
    });
  }

  return routes;
}

function collectCreateBrowserRouterRoutes(
  source: Source,
  apis: Map<string, ReactRouterAPI>,
): Route[] {
  return source.calls.flatMap((call): Route[] => {
    if (
      call.callee.kind === "identifier" &&
      apis.get(call.callee.name) === "createBrowserRouter"
    ) {
      const firstArgument = call.arguments[0];

      if (firstArgument) {
        return collectRoutesFromExpression(firstArgument);
      }
    }

    return [];
  });
}

function collectRoutesFromExpression(expression: Expression): Route[] {
  if (expression.kind === "array") {
    return expression.elements.flatMap((element) => collectRoutesFromExpression(element));
  }

  if (expression.kind === "object") {
    return collectRoutesFromObject(expression);
  }

  return [];
}

function collectRoutesFromObject(expression: ObjectExpression): Route[] {
  const routes: Route[] = [];

  const path = propertyNamed(expression.properties, "path")
  if (path && path.kind === "property") {
    const target = targetFromExpression(path.value);
  
    routes.push({
      kind: "route",
      path: target,
      confidence: confidenceForTarget(target),
      evidence: path.value.location,
    });
  }

  const children = propertyNamed(expression.properties, "children");
  if (children && children.kind === "property") {
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
): JsxRegularAttribute | undefined {
  function isAttribute(attribute: JsxAttribute): attribute is JsxRegularAttribute {
    return attribute.kind === "attribute" && attribute.name === name;
  }

  return attributes.find(isAttribute);
}

function hasAttributeValue(
  attribute: JsxRegularAttribute | undefined,
): attribute is JsxRegularAttributeWithValue {
  return attribute?.value !== undefined;
}

function targetFromAttribute(
  attribute: JsxRegularAttributeWithValue,
): ResolvedTarget {
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
  if (options && options.kind === "object") {
    const replace = propertyNamed(options.properties, "replace");

    if (
      replace &&
      replace.kind === "property" &&
      replace.value.kind === "boolean" &&
      replace.value.value
    ) {
      return "replace";
    }
  }

  return "push";
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
