import { describe, expect, it } from "vitest";

import { parseSource } from "./parser";

function locationOf(sourceText: string, fragment: string, filePath: string) {
  const start = sourceText.indexOf(fragment);
  const lineStart = sourceText.lastIndexOf("\n", start) + 1;

  return {
    filePath,
    line: sourceText.slice(0, start).split("\n").length,
    column: start - lineStart + 1,
    start,
    end: start + fragment.length,
  };
}

describe("parseSource", () => {
  it("collects imports, variables, calls, JSX, literals, and locations from TSX", () => {
    const result = parseSource({
      filePath: "/fixtures/example.tsx",
      sourceText: `
import Link from "next/link";
import * as Router from "react-router";
import { useNavigate as useNav, Navigate } from "react-router";
import type { RouteObject } from "react-router";
import type DefaultRoute from "./default-route";

const navigate = useNav();
const routes = [{ path: "/dashboard", element: <Link href="/dashboard" /> }];

export function Page() {
  navigate("/login", { replace: true, state: { from: "page" } });
  return <Navigate to="/login" replace />;
}
`,
    });

    expect(result.scriptKind).toBe("tsx");
    expect(result.diagnostics).toEqual([]);
    expect(result.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "default",
          module: "next/link",
          imported: "default",
          local: "Link",
          isTypeOnly: false,
        }),
        expect.objectContaining({
          kind: "namespace",
          module: "react-router",
          imported: "*",
          local: "Router",
          isTypeOnly: false,
        }),
        expect.objectContaining({
          kind: "named",
          module: "react-router",
          imported: "useNavigate",
          local: "useNav",
          isTypeOnly: false,
        }),
        expect.objectContaining({
          kind: "named",
          module: "react-router",
          imported: "RouteObject",
          local: "RouteObject",
          isTypeOnly: true,
        }),
        expect.objectContaining({
          kind: "default",
          module: "./default-route",
          imported: "default",
          local: "DefaultRoute",
          isTypeOnly: true,
        }),
      ]),
    );

    const navigateVariable = result.variables.find((variable) => variable.name === "navigate");
    expect(navigateVariable?.initializer).toMatchObject({
      kind: "call",
      callee: {
        kind: "identifier",
        name: "useNav",
      },
    });

    const navigateCall = result.calls.find((call) => {
      return call.callee.kind === "identifier" && call.callee.name === "navigate";
    });
    expect(navigateCall?.arguments).toMatchObject([
      {
        kind: "string",
        value: "/login",
      },
      {
        kind: "object",
        properties: expect.arrayContaining([
          expect.objectContaining({
            kind: "property",
            name: "replace",
            value: expect.objectContaining({
              kind: "boolean",
              value: true,
            }),
          }),
        ]),
      },
    ]);

    expect(result.jsxElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tagName: "Link",
          attributes: expect.arrayContaining([
            expect.objectContaining({
              kind: "attribute",
              name: "href",
              value: expect.objectContaining({
                kind: "string",
                value: "/dashboard",
              }),
            }),
          ]),
        }),
        expect.objectContaining({
          tagName: "Navigate",
          attributes: expect.arrayContaining([
            expect.objectContaining({
              kind: "attribute",
              name: "replace",
              value: expect.objectContaining({
                kind: "boolean",
                value: true,
              }),
            }),
          ]),
        }),
      ]),
    );

    expect(result.objects.length).toBeGreaterThan(0);
    expect(result.arrays).toEqual([
      expect.objectContaining({
        kind: "array",
        elements: [expect.objectContaining({ kind: "object" })],
      }),
    ]);
    expect(navigateCall?.location).toMatchObject({
      filePath: "/fixtures/example.tsx",
      line: expect.any(Number),
      column: expect.any(Number),
      start: expect.any(Number),
      end: expect.any(Number),
    });
  });

  it("parses TS files without JSX", () => {
    const result = parseSource({
      filePath: "/fixtures/example.ts",
      sourceText: `
const router = useRouter();
router.push(\`/users/\${id}\`);
`,
    });

    expect(result.scriptKind).toBe("ts");
    expect(result.jsxElements).toEqual([]);
    expect(result.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callee: expect.objectContaining({
            kind: "member",
            property: "push",
          }),
          arguments: [
            expect.objectContaining({
              kind: "template",
              raw: "`/users/${id}`",
            }),
          ],
        }),
      ]),
    );
  });

  it("collects type-only import variants", () => {
    const result = parseSource({
      filePath: "/fixtures/type-imports.ts",
      sourceText: `
import type DefaultRoute from "./default-route";
import type * as RouteTypes from "./route-types";
import { type RouteObject, Link } from "react-router";
`,
    });

    expect(result.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "default",
          imported: "default",
          local: "DefaultRoute",
          module: "./default-route",
          isTypeOnly: true,
        }),
        expect.objectContaining({
          kind: "namespace",
          imported: "*",
          local: "RouteTypes",
          module: "./route-types",
          isTypeOnly: true,
        }),
        expect.objectContaining({
          kind: "named",
          imported: "RouteObject",
          local: "RouteObject",
          module: "react-router",
          isTypeOnly: true,
        }),
        expect.objectContaining({
          kind: "named",
          imported: "Link",
          local: "Link",
          module: "react-router",
          isTypeOnly: false,
        }),
      ]),
    );
  });

  it("does not collect re-export declarations as imports", () => {
    const result = parseSource({
      filePath: "/fixtures/re-exports.ts",
      sourceText: `
export { Link } from "next/link";
export * from "./routes";
`,
    });

    expect(result.imports).toEqual([]);
  });

  it("collects JSX attribute expression variants", () => {
    const result = parseSource({
      filePath: "/fixtures/jsx-attributes.tsx",
      sourceText: `
const path = "/dashboard";
const props = { reloadDocument: true };

export function Page() {
  return (
    <Route
      path={path}
      element={<Dashboard />}
      prefetch={false}
      replace
      {...props}
    />
  );
}
`,
    });

    const routeElement = result.jsxElements.find((element) => element.tagName === "Route");

    expect(routeElement?.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "attribute",
          name: "path",
          value: expect.objectContaining({
            kind: "identifier",
            name: "path",
          }),
        }),
        expect.objectContaining({
          kind: "attribute",
          name: "element",
          value: expect.objectContaining({
            kind: "unknown",
            raw: "<Dashboard />",
          }),
        }),
        expect.objectContaining({
          kind: "attribute",
          name: "prefetch",
          value: expect.objectContaining({
            kind: "boolean",
            value: false,
          }),
        }),
        expect.objectContaining({
          kind: "attribute",
          name: "replace",
          value: expect.objectContaining({
            kind: "boolean",
            value: true,
          }),
        }),
        expect.objectContaining({
          kind: "spread",
          value: expect.objectContaining({
            kind: "identifier",
            name: "props",
          }),
        }),
      ]),
    );
  });

  it("collects nested member and call expressions", () => {
    const result = parseSource({
      filePath: "/fixtures/nested-calls.ts",
      sourceText: `
app.router.navigate("/settings");
createRouter().push("/dashboard");
routes["admin"].loader();
`,
    });

    expect(result.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callee: expect.objectContaining({
            kind: "member",
            property: "navigate",
            object: expect.objectContaining({
              kind: "member",
              property: "router",
              object: expect.objectContaining({
                kind: "identifier",
                name: "app",
              }),
            }),
          }),
          arguments: [
            expect.objectContaining({
              kind: "string",
              value: "/settings",
            }),
          ],
        }),
        expect.objectContaining({
          callee: expect.objectContaining({
            kind: "member",
            property: "push",
            object: expect.objectContaining({
              kind: "call",
              callee: expect.objectContaining({
                kind: "identifier",
                name: "createRouter",
              }),
            }),
          }),
          arguments: [
            expect.objectContaining({
              kind: "string",
              value: "/dashboard",
            }),
          ],
        }),
        expect.objectContaining({
          callee: expect.objectContaining({
            kind: "member",
            property: "loader",
            object: expect.objectContaining({
              kind: "member",
              property: expect.objectContaining({
                kind: "string",
                value: "admin",
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it("collects object and array literal boundaries", () => {
    const result = parseSource({
      filePath: "/fixtures/literals.ts",
      sourceText: `
const routeName = "settings";
const routes = [
  {
    path: "/dashboard",
    children: [{ path: routeName }],
    loader() {
      return null;
    },
    ...sharedRoutes,
  },
];
`,
    });

    const routesVariable = result.variables.find((variable) => variable.name === "routes");

    expect(routesVariable?.initializer).toMatchObject({
      kind: "array",
      elements: [
        expect.objectContaining({
          kind: "object",
          properties: expect.arrayContaining([
            expect.objectContaining({
              kind: "property",
              name: "path",
              value: expect.objectContaining({
                kind: "string",
                value: "/dashboard",
              }),
            }),
            expect.objectContaining({
              kind: "property",
              name: "children",
              value: expect.objectContaining({
                kind: "array",
                elements: [
                  expect.objectContaining({
                    kind: "object",
                    properties: expect.arrayContaining([
                      expect.objectContaining({
                        kind: "property",
                        name: "path",
                        value: expect.objectContaining({
                          kind: "identifier",
                          name: "routeName",
                        }),
                      }),
                    ]),
                  }),
                ],
              }),
            }),
            expect.objectContaining({
              kind: "method",
              name: "loader",
            }),
            expect.objectContaining({
              kind: "spread",
              value: expect.objectContaining({
                kind: "identifier",
                name: "sharedRoutes",
              }),
            }),
          ]),
        }),
      ],
    });
    expect(result.objects.length).toBeGreaterThanOrEqual(2);
    expect(result.arrays.length).toBeGreaterThanOrEqual(2);
  });

  it("returns parse diagnostics without dropping collectable facts", () => {
    const result = parseSource({
      filePath: "/fixtures/invalid.ts",
      sourceText: `
import Link from "next/link";
const router = useRouter();
router.push("/dashboard");
const broken = ;
`,
    });

    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]).toMatchObject({
      message: expect.any(String),
      location: expect.objectContaining({
        filePath: "/fixtures/invalid.ts",
        line: expect.any(Number),
        column: expect.any(Number),
      }),
    });
    expect(result.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "default",
          local: "Link",
          module: "next/link",
        }),
      ]),
    );
    expect(result.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          callee: expect.objectContaining({
            kind: "member",
            property: "push",
          }),
        }),
      ]),
    );
  });

  it("returns exact locations for multi-line imports, calls, and JSX", () => {
    const filePath = "/fixtures/locations.tsx";
    const sourceText = `
import {
  Link,
  Navigate,
} from "react-router";

export function Page() {
  navigate(
    "/login",
    { replace: true },
  );

  return (
    <Navigate
      to="/login"
      replace
    />
  );
}
`;
    const result = parseSource({ filePath, sourceText });
    const linkImport = result.imports.find((binding) => binding.local === "Link");
    const navigateCall = result.calls.find((call) => {
      return call.callee.kind === "identifier" && call.callee.name === "navigate";
    });
    const navigateElement = result.jsxElements.find((element) => element.tagName === "Navigate");

    expect(linkImport?.location).toMatchObject(locationOf(sourceText, "Link", filePath));
    expect(navigateCall?.location).toMatchObject(
      locationOf(
        sourceText,
        `navigate(
    "/login",
    { replace: true },
  )`,
        filePath,
      ),
    );
    expect(navigateElement?.location).toMatchObject(
      locationOf(
        sourceText,
        `<Navigate
      to="/login"
      replace
    />`,
        filePath,
      ),
    );
  });
});
