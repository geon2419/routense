import * as ts from "typescript";

type ScriptKind = "ts" | "tsx";

export type SourceLocation = {
  filePath: string;
  line: number;
  column: number;
  start: number;
  end: number;
};

type ImportKind = "side-effect" | "default" | "named" | "namespace";

export type ImportBinding = {
  kind: ImportKind;
  module: string;
  imported?: string;
  local?: string;
  isTypeOnly: boolean;
  location: SourceLocation;
};

export type ObjectProperty =
  | {
      kind: "property";
      name: string;
      value: Expression;
      location: SourceLocation;
    }
  | {
      kind: "method";
      name: string;
      location: SourceLocation;
    }
  | {
      kind: "spread";
      value: Expression;
      location: SourceLocation;
    };

export type ObjectExpression = {
  kind: "object";
  properties: ObjectProperty[];
  location: SourceLocation;
};

export type ArrayExpression = {
  kind: "array";
  elements: Expression[];
  location: SourceLocation;
};

export type Expression =
  | {
      kind: "string";
      value: string;
      raw: string;
      location: SourceLocation;
    }
  | {
      kind: "number";
      value: number;
      raw: string;
      location: SourceLocation;
    }
  | {
      kind: "boolean";
      value: boolean;
      location: SourceLocation;
    }
  | {
      kind: "null";
      location: SourceLocation;
    }
  | {
      kind: "identifier";
      name: string;
      location: SourceLocation;
    }
  | {
      kind: "member";
      object: Expression;
      property: string | Expression;
      location: SourceLocation;
    }
  | {
      kind: "call";
      callee: Expression;
      arguments: Expression[];
      location: SourceLocation;
    }
  | ObjectExpression
  | ArrayExpression
  | {
      kind: "template";
      raw: string;
      location: SourceLocation;
    }
  | {
      kind: "unknown";
      raw: string;
      location: SourceLocation;
    };

export type Variable = {
  name: string;
  initializer?: Expression;
  location: SourceLocation;
};

export type CallExpression = {
  callee: Expression;
  arguments: Expression[];
  location: SourceLocation;
};

export type JsxAttribute =
  | {
      kind: "attribute";
      name: string;
      value?: Expression;
      location: SourceLocation;
    }
  | {
      kind: "spread";
      value: Expression;
      location: SourceLocation;
    };

export type JsxElement = {
  tagName: string;
  attributes: JsxAttribute[];
  location: SourceLocation;
};

export type ParseDiagnostic = {
  message: string;
  location: SourceLocation;
};

export type ParseSourceInput = {
  filePath: string;
  sourceText: string;
};

export type Source = {
  filePath: string;
  scriptKind: ScriptKind;
  imports: ImportBinding[];
  variables: Variable[];
  calls: CallExpression[];
  jsxElements: JsxElement[];
  objects: ObjectExpression[];
  arrays: ArrayExpression[];
  diagnostics: ParseDiagnostic[];
};

export function parseSource(input: ParseSourceInput): Source {
  return new RoutenseParser(input).parse();
}

class RoutenseParser {
  private readonly sourceFile: ts.SourceFile;
  private readonly parsed: Source;

  constructor(private readonly input: ParseSourceInput) {
    const scriptKind = this.getScriptKind(input.filePath);

    this.sourceFile = ts.createSourceFile(
      input.filePath,
      input.sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKind === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    this.parsed = {
      filePath: input.filePath,
      scriptKind,
      imports: [],
      variables: [],
      calls: [],
      jsxElements: [],
      objects: [],
      arrays: [],
      diagnostics: this.collectDiagnostics(),
    };
  }

  parse(): Source {
    this.visit(this.sourceFile);
    return this.parsed;
  }

  private getScriptKind(filePath: string): ScriptKind {
    return filePath.endsWith(".tsx") ? "tsx" : "ts";
  }

  private visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      this.parsed.imports.push(...this.toImportBindings(node));
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      this.parsed.variables.push({
        name: node.name.text,
        initializer: node.initializer ? this.toExpression(node.initializer) : undefined,
        location: this.toLocation(node),
      });
    }

    if (ts.isCallExpression(node)) {
      this.parsed.calls.push({
        callee: this.toExpression(node.expression),
        arguments: node.arguments.map((argument) => this.toExpression(argument)),
        location: this.toLocation(node),
      });
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      this.parsed.jsxElements.push({
        tagName: node.tagName.getText(this.sourceFile),
        attributes: this.toJsxAttributes(node.attributes),
        location: this.toLocation(node),
      });
    }

    if (ts.isObjectLiteralExpression(node)) {
      this.parsed.objects.push(this.toObjectExpression(node));
    }

    if (ts.isArrayLiteralExpression(node)) {
      this.parsed.arrays.push(this.toArrayExpression(node));
    }

    ts.forEachChild(node, (child) => this.visit(child));
  }

  private toImportBindings(node: ts.ImportDeclaration): ImportBinding[] {
    if (!ts.isStringLiteral(node.moduleSpecifier)) {
      return [];
    }

    const module = node.moduleSpecifier.text;
    const importClause = node.importClause;
    const location = this.toLocation(node);

    if (!importClause) {
      return [
        {
          kind: "side-effect",
          module,
          isTypeOnly: false,
          location,
        },
      ];
    }

    const bindings: ImportBinding[] = [];
    const isClauseTypeOnly = this.isTypeOnlyImportClause(importClause);

    if (importClause.name) {
      bindings.push({
        kind: "default",
        module,
        imported: "default",
        local: importClause.name.text,
        isTypeOnly: isClauseTypeOnly,
        location,
      });
    }

    const namedBindings = importClause.namedBindings;

    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      bindings.push({
        kind: "namespace",
        module,
        imported: "*",
        local: namedBindings.name.text,
        isTypeOnly: isClauseTypeOnly,
        location,
      });
    }

    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        bindings.push({
          kind: "named",
          module,
          imported: element.propertyName?.text ?? element.name.text,
          local: element.name.text,
          isTypeOnly: isClauseTypeOnly || element.isTypeOnly,
          location: this.toLocation(element),
        });
      }
    }

    return bindings;
  }

  private isTypeOnlyImportClause(importClause: ts.ImportClause): boolean {
    return importClause.phaseModifier === ts.SyntaxKind.TypeKeyword;
  }

  private toJsxAttributes(attributes: ts.JsxAttributes): JsxAttribute[] {
    return attributes.properties.map((property): JsxAttribute => {
      if (ts.isJsxSpreadAttribute(property)) {
        return {
          kind: "spread",
          value: this.toExpression(property.expression),
          location: this.toLocation(property),
        };
      }

      return {
        kind: "attribute",
        name: this.toJsxAttributeName(property.name),
        value: this.toJsxAttributeValue(property),
        location: this.toLocation(property),
      };
    });
  }

  private toJsxAttributeValue(attribute: ts.JsxAttribute): Expression | undefined {
    if (!attribute.initializer) {
      return {
        kind: "boolean",
        value: true,
        location: this.toLocation(attribute),
      };
    }

    if (ts.isStringLiteral(attribute.initializer)) {
      return this.toExpression(attribute.initializer);
    }

    if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression) {
      return this.toExpression(attribute.initializer.expression);
    }

    return {
      kind: "unknown",
      raw: attribute.initializer.getText(this.sourceFile),
      location: this.toLocation(attribute.initializer),
    };
  }

  private toExpression(node: ts.Expression): Expression {
    if (ts.isStringLiteralLike(node)) {
      return {
        kind: "string",
        value: node.text,
        raw: node.getText(this.sourceFile),
        location: this.toLocation(node),
      };
    }

    if (ts.isNumericLiteral(node)) {
      return {
        kind: "number",
        value: Number(node.text),
        raw: node.getText(this.sourceFile),
        location: this.toLocation(node),
      };
    }

    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
      return {
        kind: "boolean",
        value: node.kind === ts.SyntaxKind.TrueKeyword,
        location: this.toLocation(node),
      };
    }

    if (node.kind === ts.SyntaxKind.NullKeyword) {
      return {
        kind: "null",
        location: this.toLocation(node),
      };
    }

    if (ts.isIdentifier(node)) {
      return {
        kind: "identifier",
        name: node.text,
        location: this.toLocation(node),
      };
    }

    if (ts.isPropertyAccessExpression(node)) {
      return {
        kind: "member",
        object: this.toExpression(node.expression),
        property: node.name.text,
        location: this.toLocation(node),
      };
    }

    if (ts.isElementAccessExpression(node)) {
      return {
        kind: "member",
        object: this.toExpression(node.expression),
        property: this.toExpression(node.argumentExpression),
        location: this.toLocation(node),
      };
    }

    if (ts.isCallExpression(node)) {
      return {
        kind: "call",
        callee: this.toExpression(node.expression),
        arguments: node.arguments.map((argument) => this.toExpression(argument)),
        location: this.toLocation(node),
      };
    }

    if (ts.isObjectLiteralExpression(node)) {
      return this.toObjectExpression(node);
    }

    if (ts.isArrayLiteralExpression(node)) {
      return this.toArrayExpression(node);
    }

    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      return {
        kind: "template",
        raw: node.getText(this.sourceFile),
        location: this.toLocation(node),
      };
    }

    return {
      kind: "unknown",
      raw: node.getText(this.sourceFile),
      location: this.toLocation(node),
    };
  }

  private toObjectExpression(node: ts.ObjectLiteralExpression): ObjectExpression {
    return {
      kind: "object",
      properties: node.properties.map((property) => this.toObjectProperty(property)),
      location: this.toLocation(node),
    };
  }

  private toObjectProperty(property: ts.ObjectLiteralElementLike): ObjectProperty {
    if (ts.isSpreadAssignment(property)) {
      return {
        kind: "spread",
        value: this.toExpression(property.expression),
        location: this.toLocation(property),
      };
    }

    if (ts.isPropertyAssignment(property)) {
      return {
        kind: "property",
        name: this.toPropertyName(property.name),
        value: this.toExpression(property.initializer),
        location: this.toLocation(property),
      };
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      return {
        kind: "property",
        name: property.name.text,
        value: this.toExpression(property.name),
        location: this.toLocation(property),
      };
    }

    return {
      kind: "method",
      name: this.toPropertyName(property.name),
      location: this.toLocation(property),
    };
  }

  private toArrayExpression(node: ts.ArrayLiteralExpression): ArrayExpression {
    return {
      kind: "array",
      elements: node.elements.map((element) => this.toExpression(element)),
      location: this.toLocation(node),
    };
  }

  private toPropertyName(name: ts.PropertyName): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }

    return name.getText(this.sourceFile);
  }

  private toJsxAttributeName(name: ts.JsxAttributeName): string {
    if (ts.isIdentifier(name)) {
      return name.text;
    }

    return name.getText(this.sourceFile);
  }

  private collectDiagnostics(): ParseDiagnostic[] {
    const diagnostics =
      ts.transpileModule(this.input.sourceText, {
        fileName: this.input.filePath,
        compilerOptions: {
          jsx: ts.JsxEmit.Preserve,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ESNext,
        },
        reportDiagnostics: true,
      }).diagnostics ?? [];

    return diagnostics.map((diagnostic) => {
      const start = diagnostic.start ?? 0;
      const end = start + (diagnostic.length ?? 0);
      const { line, character } = this.sourceFile.getLineAndCharacterOfPosition(start);

      return {
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        location: {
          filePath: this.sourceFile.fileName,
          line: line + 1,
          column: character + 1,
          start,
          end,
        },
      };
    });
  }

  private toLocation(node: ts.Node): SourceLocation {
    const start = node.getStart(this.sourceFile);
    const end = node.getEnd();
    const { line, character } = this.sourceFile.getLineAndCharacterOfPosition(start);

    return {
      filePath: this.sourceFile.fileName,
      line: line + 1,
      column: character + 1,
      start,
      end,
    };
  }
}
