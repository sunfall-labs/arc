import { relative, resolve, sep } from "node:path";

export const startRouteComponentSplitVirtualModuleId = "virtual:effect-ui/route-component";

interface ImportSpecifierBinding {
  readonly imported: string;
  readonly local: string;
  readonly isType?: boolean;
}

interface ImportDeclaration {
  readonly start: number;
  readonly end: number;
  readonly source: string;
  readonly defaultLocal?: string;
  readonly namespaceLocal?: string;
  readonly named: readonly ImportSpecifierBinding[];
}

interface ImportedComponentSplitCandidate {
  readonly kind: "import";
  readonly local: string;
  readonly imported: string;
  readonly source: string;
}

interface LocalComponentDeclaration {
  readonly source: string;
  readonly exportedSource: string;
  readonly exported: boolean;
}

interface LocalComponentSplitCandidate {
  readonly kind: "local";
  readonly local: string;
  readonly declaration: LocalComponentDeclaration;
}

type ComponentSplitCandidate = ImportedComponentSplitCandidate | LocalComponentSplitCandidate;

export interface StartRouteAutoCodeSplittingOptions {
  readonly root: string;
}

const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const importDeclarationPattern = /import\s+(?!type\b)([\s\S]*?)\s+from\s+(["'])([^"']+)\2\s*;?/g;
const boundImportDeclarationPattern =
  /import(?:\s+type)?\s+[\s\S]*?\s+from\s+(["'])([^"']+)\1\s*;?/g;
const componentPropertyPattern = /(^|[,{]\s*)component\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*)/gm;
const generatedSplitModules = new Map<string, string>();

const normalizePath = (path: string): string => path.replace(/\\/g, "/");

const stripQuery = (id: string): string => id.split(/[?#]/, 1)[0] ?? id;

const isRelativeSpecifier = (specifier: string): boolean =>
  specifier.startsWith("./") || specifier.startsWith("../");

const rootAbsoluteSpecifier = (root: string, file: string): string => {
  const normalizedRoot = normalizePath(resolve(root));
  const normalizedFile = normalizePath(file);
  if (normalizedFile === normalizedRoot) {
    return "/";
  }
  if (normalizedFile.startsWith(`${normalizedRoot}/`)) {
    return `/${normalizePath(relative(normalizedRoot, normalizedFile))}`;
  }
  return normalizedFile.startsWith("/") ? normalizedFile : `/${normalizedFile}`;
};

const resolveComponentSource = (root: string, routeModuleId: string, source: string): string => {
  if (!isRelativeSpecifier(source)) {
    return source;
  }
  const routeFile = stripQuery(routeModuleId);
  const routeDirectory = routeFile.includes(sep)
    ? routeFile.slice(0, routeFile.lastIndexOf(sep))
    : routeFile.includes("/")
      ? routeFile.slice(0, routeFile.lastIndexOf("/"))
      : ".";
  return rootAbsoluteSpecifier(root, resolve(routeDirectory, source));
};

const splitTopLevelCommas = (value: string): readonly string[] => {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "{" || char === "[" || char === "(") {
      depth++;
    } else if (char === "}" || char === "]" || char === ")") {
      depth--;
    }
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0) {
    parts.push(current.trim());
  }
  return parts;
};

const parseNamedImportSpecifier = (specifier: string): ImportSpecifierBinding | undefined => {
  const raw = specifier.trim();
  const isType = raw.startsWith("type ");
  const trimmed = raw.replace(/^type\s+/, "");
  if (trimmed.length === 0) {
    return undefined;
  }
  const [left, right] = trimmed.split(/\s+as\s+/);
  const imported = left?.trim();
  const local = (right ?? left)?.trim();
  if (!imported || !local || !identifierPattern.test(imported) || !identifierPattern.test(local)) {
    return undefined;
  }
  return { imported, local, ...(isType ? { isType } : {}) };
};

const parseImportDeclarations = (code: string): readonly ImportDeclaration[] => {
  const imports: ImportDeclaration[] = [];
  for (const match of code.matchAll(importDeclarationPattern)) {
    const full = match[0];
    const clause = match[1]?.trim() ?? "";
    const source = match[3] ?? "";
    const start = match.index ?? 0;
    const namedMatch = clause.match(/\{([\s\S]*)\}/);
    const namespaceMatch = clause.match(/\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    const named = namedMatch
      ? splitTopLevelCommas(namedMatch[1] ?? "").flatMap((specifier) => {
          const parsed = parseNamedImportSpecifier(specifier);
          return parsed === undefined ? [] : [parsed];
        })
      : [];
    const beforeNamed = namedMatch === null ? clause : clause.slice(0, namedMatch.index).trim();
    const beforeNamespace =
      namespaceMatch === null ? beforeNamed : beforeNamed.slice(0, namespaceMatch.index).trim();
    const defaultCandidate = beforeNamespace.replace(/,$/, "").trim();
    const namespaceLocal = namespaceMatch?.[1];
    const defaultLocal =
      defaultCandidate.length > 0 &&
      !defaultCandidate.startsWith("*") &&
      identifierPattern.test(defaultCandidate)
        ? defaultCandidate
        : undefined;

    imports.push({
      start,
      end: start + full.length,
      source,
      ...(defaultLocal === undefined ? {} : { defaultLocal }),
      ...(namespaceLocal === undefined ? {} : { namespaceLocal }),
      named,
    });
  }
  return imports;
};

const removeImportDeclarations = (
  code: string,
  declarations: readonly ImportDeclaration[],
  removedLocals: ReadonlySet<string>,
): string => {
  let next = "";
  let offset = 0;
  for (const declaration of declarations) {
    next += code.slice(offset, declaration.start);
    const defaultLocal =
      declaration.defaultLocal !== undefined && !removedLocals.has(declaration.defaultLocal)
        ? declaration.defaultLocal
        : undefined;
    const namespaceLocal =
      declaration.namespaceLocal !== undefined && !removedLocals.has(declaration.namespaceLocal)
        ? declaration.namespaceLocal
        : undefined;
    const named = declaration.named.filter((specifier) => !removedLocals.has(specifier.local));
    if (defaultLocal !== undefined || namespaceLocal !== undefined || named.length > 0) {
      const parts = [
        ...(defaultLocal === undefined ? [] : [defaultLocal]),
        ...(namespaceLocal === undefined ? [] : [`* as ${namespaceLocal}`]),
        ...(named.length === 0
          ? []
          : [
              `{ ${named
                .map(
                  (specifier) =>
                    `${specifier.isType === true ? "type " : ""}${
                      specifier.imported === specifier.local
                        ? specifier.imported
                        : `${specifier.imported} as ${specifier.local}`
                    }`,
                )
                .join(", ")} }`,
            ]),
      ];
      next += `import ${parts.join(", ")} from ${JSON.stringify(declaration.source)};`;
    }
    offset = declaration.end;
  }
  next += code.slice(offset);
  return next;
};

const codeWithoutImportDeclarations = (
  code: string,
  declarations: readonly ImportDeclaration[],
): string => {
  let next = "";
  let offset = 0;
  for (const declaration of declarations) {
    next += code.slice(offset, declaration.start);
    offset = declaration.end;
  }
  next += code.slice(offset);
  return next;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const identifierUseCount = (code: string, identifier: string): number => {
  const pattern = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(identifier)}(?![A-Za-z0-9_$])`, "g");
  return Array.from(code.matchAll(pattern)).length;
};

const uniqueGeneratedIdentifier = (code: string, base: string): string => {
  let identifier = base;
  let index = 0;
  while (identifierUseCount(code, identifier) > 0) {
    index++;
    identifier = `${base}${index}`;
  }
  return identifier;
};

const uniqueRouteNamespaceIdentifier = (code: string): string =>
  uniqueGeneratedIdentifier(code, "__EffectUiRoute");

const uniqueEffectNamespaceIdentifier = (code: string): string =>
  uniqueGeneratedIdentifier(code, "__EffectUiEffect");

type Quote = '"' | "'" | "`";

const findMatchingDelimiter = (
  code: string,
  openIndex: number,
  open: string,
  close: string,
): number => {
  let depth = 0;
  let quote: Quote | undefined;
  let lineComment = false;
  let blockComment = false;

  for (let index = openIndex; index < code.length; index++) {
    const char = code[index];
    const next = code[index + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote !== undefined) {
      if (char === "\\") {
        index++;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === open) {
      depth++;
      continue;
    }
    if (char === close) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
};

const findStatementEnd = (code: string, start: number): number => {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: Quote | undefined;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < code.length; index++) {
    const char = code[index];
    const next = code[index + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote !== undefined) {
      if (char === "\\") {
        index++;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      parenDepth++;
      continue;
    }
    if (char === ")") {
      parenDepth--;
      continue;
    }
    if (char === "[") {
      bracketDepth++;
      continue;
    }
    if (char === "]") {
      bracketDepth--;
      continue;
    }
    if (char === "{") {
      braceDepth++;
      continue;
    }
    if (char === "}") {
      braceDepth--;
      continue;
    }
    if (char === ";" && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      return index + 1;
    }
  }

  return -1;
};

const isTopLevelPosition = (code: string, position: number): boolean => {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: Quote | undefined;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < position; index++) {
    const char = code[index];
    const next = code[index + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote !== undefined) {
      if (char === "\\") {
        index++;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      parenDepth++;
      continue;
    }
    if (char === ")") {
      parenDepth--;
      continue;
    }
    if (char === "[") {
      bracketDepth++;
      continue;
    }
    if (char === "]") {
      bracketDepth--;
      continue;
    }
    if (char === "{") {
      braceDepth++;
      continue;
    }
    if (char === "}") {
      braceDepth--;
    }
  }

  return parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && quote === undefined;
};

const previousWord = (code: string, position: number): string | undefined => {
  const before = code.slice(0, position).trimEnd();
  return before.match(/([A-Za-z_$][A-Za-z0-9_$]*)$/)?.[1];
};

const findTopLevelFunctionDeclaration = (
  code: string,
  local: string,
): LocalComponentDeclaration | undefined => {
  const pattern = new RegExp(`(?:export\\s+)?function\\s+${escapeRegExp(local)}\\s*\\(`, "g");
  for (const match of code.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (!isTopLevelPosition(code, start) || previousWord(code, start) === "default") {
      continue;
    }
    const openParen = code.indexOf("(", start);
    const closeParen = openParen === -1 ? -1 : findMatchingDelimiter(code, openParen, "(", ")");
    if (closeParen === -1) {
      continue;
    }
    const nextTokenOffset = code.slice(closeParen + 1).search(/\S/);
    const bodyStart = nextTokenOffset === -1 ? -1 : closeParen + 1 + nextTokenOffset;
    if (bodyStart === -1 || code[bodyStart] !== "{") {
      continue;
    }
    const bodyEnd = findMatchingDelimiter(code, bodyStart, "{", "}");
    if (bodyEnd === -1) {
      continue;
    }
    const source = code.slice(start, bodyEnd + 1);
    const exported = source.startsWith("export ");
    return {
      source,
      exportedSource: exported ? source : `export ${source}`,
      exported,
    };
  }
  return undefined;
};

const findTopLevelConstDeclaration = (
  code: string,
  local: string,
): LocalComponentDeclaration | undefined => {
  const pattern = new RegExp(`(?:export\\s+)?const\\s+${escapeRegExp(local)}\\b`, "g");
  for (const match of code.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (!isTopLevelPosition(code, start) || previousWord(code, start) === "default") {
      continue;
    }
    const end = findStatementEnd(code, start);
    if (end === -1) {
      continue;
    }
    const source = code.slice(start, end);
    const exported = source.startsWith("export ");
    return {
      source,
      exportedSource: exported ? source : `export ${source}`,
      exported,
    };
  }
  return undefined;
};

const findLocalComponentDeclaration = (
  code: string,
  local: string,
): LocalComponentDeclaration | undefined =>
  findTopLevelFunctionDeclaration(code, local) ?? findTopLevelConstDeclaration(code, local);

const topLevelBindingNames = (code: string): ReadonlySet<string> => {
  const names = new Set<string>();
  const pattern =
    /(?:export\s+)?(?:(?:const\s+enum|const|let|var|function|class|enum|interface|type)\s+)([A-Za-z_$][A-Za-z0-9_$]*)/g;
  for (const match of code.matchAll(pattern)) {
    const start = match.index ?? 0;
    const local = match[1];
    if (local !== undefined && isTopLevelPosition(code, start)) {
      names.add(local);
    }
  }
  return names;
};

const hasLocalDeclarationDependency = (
  declaration: LocalComponentDeclaration,
  local: string,
  codeWithoutImports: string,
): boolean => {
  for (const name of topLevelBindingNames(codeWithoutImports)) {
    if (name !== local && identifierUseCount(declaration.source, name) > 0) {
      return true;
    }
  }
  return false;
};

const boundImportDeclarationSources = (
  code: string,
  root: string,
  routeModuleId: string,
): readonly string[] =>
  Array.from(code.matchAll(boundImportDeclarationPattern), (match) => {
    const full = match[0];
    const quote = match[1];
    const source = match[2];
    if (quote === undefined || source === undefined) {
      return full;
    }
    const sourceLiteral = new RegExp(
      `${escapeRegExp(quote)}${escapeRegExp(source)}${escapeRegExp(quote)}`,
    );
    return full.replace(
      sourceLiteral,
      JSON.stringify(resolveComponentSource(root, routeModuleId, source)),
    );
  });

const removeLocalDeclarationSources = (
  code: string,
  declarations: readonly LocalComponentDeclaration[],
): string => {
  let next = code;
  for (const declaration of declarations) {
    const index = next.indexOf(declaration.source);
    if (index !== -1) {
      next = `${next.slice(0, index)}${next.slice(index + declaration.source.length)}`;
    }
  }
  return next;
};

const componentBindings = (
  declarations: readonly ImportDeclaration[],
): ReadonlyMap<string, ImportedComponentSplitCandidate> => {
  const bindings = new Map<string, ImportedComponentSplitCandidate>();
  for (const declaration of declarations) {
    if (declaration.defaultLocal !== undefined) {
      bindings.set(declaration.defaultLocal, {
        kind: "import",
        local: declaration.defaultLocal,
        imported: "default",
        source: declaration.source,
      });
    }
    for (const specifier of declaration.named) {
      if (specifier.isType === true) {
        continue;
      }
      bindings.set(specifier.local, {
        kind: "import",
        local: specifier.local,
        imported: specifier.imported,
        source: declaration.source,
      });
    }
  }
  return bindings;
};

const splitModuleId = (
  candidate: ImportedComponentSplitCandidate,
  root: string,
  routeModuleId: string,
): string => {
  const params = new URLSearchParams({
    source: resolveComponentSource(root, routeModuleId, candidate.source),
    import: candidate.imported,
    export: candidate.local,
  });
  return `${startRouteComponentSplitVirtualModuleId}?${params.toString()}`;
};

const splitLocalModuleId = (
  candidate: LocalComponentSplitCandidate,
  root: string,
  routeModuleId: string,
): string => {
  const params = new URLSearchParams({
    source: rootAbsoluteSpecifier(root, stripQuery(routeModuleId)),
    inline: candidate.local,
    export: candidate.local,
  });
  return `${startRouteComponentSplitVirtualModuleId}?${params.toString()}`;
};

const pruneUnusedImportBindings = (code: string): string => {
  const declarations = parseImportDeclarations(code);
  if (declarations.length === 0) {
    return code;
  }

  const codeWithoutImports = codeWithoutImportDeclarations(code, declarations);
  const removedLocals = new Set<string>();
  for (const declaration of declarations) {
    if (
      declaration.defaultLocal !== undefined &&
      identifierUseCount(codeWithoutImports, declaration.defaultLocal) === 0
    ) {
      removedLocals.add(declaration.defaultLocal);
    }
    if (
      declaration.namespaceLocal !== undefined &&
      identifierUseCount(codeWithoutImports, declaration.namespaceLocal) === 0
    ) {
      removedLocals.add(declaration.namespaceLocal);
    }
    for (const specifier of declaration.named) {
      if (identifierUseCount(codeWithoutImports, specifier.local) === 0) {
        removedLocals.add(specifier.local);
      }
    }
  }

  return removedLocals.size === 0
    ? code
    : removeImportDeclarations(code, declarations, removedLocals);
};

const createLocalSplitModule = (
  code: string,
  declaration: LocalComponentDeclaration,
  root: string,
  routeModuleId: string,
): string => {
  const imports = boundImportDeclarationSources(code, root, routeModuleId);
  const moduleCode = `${imports.length === 0 ? "" : `${imports.join("\n")}\n`}${
    declaration.exportedSource
  }`;
  return pruneUnusedImportBindings(moduleCode).trimStart();
};

const splitCandidateModuleId = (
  candidate: ComponentSplitCandidate,
  root: string,
  routeModuleId: string,
): string =>
  candidate.kind === "import"
    ? splitModuleId(candidate, root, routeModuleId)
    : splitLocalModuleId(candidate, root, routeModuleId);

export const transformStartRouteAutoCodeSplitting = (
  code: string,
  id: string,
  options: StartRouteAutoCodeSplittingOptions,
): string | null => {
  const imports = parseImportDeclarations(code);
  const bindings = componentBindings(imports);
  const codeWithoutImports = codeWithoutImportDeclarations(code, imports);
  const splitCandidates = new Map<string, ComponentSplitCandidate>();

  for (const match of codeWithoutImports.matchAll(componentPropertyPattern)) {
    const local = match[2];
    if (local === undefined) {
      continue;
    }

    const importedCandidate = bindings.get(local);
    if (importedCandidate !== undefined) {
      if (identifierUseCount(codeWithoutImports, local) === 1) {
        splitCandidates.set(local, importedCandidate);
      }
      continue;
    }

    const declaration = findLocalComponentDeclaration(code, local);
    if (
      declaration === undefined ||
      declaration.exported ||
      identifierUseCount(codeWithoutImports, local) !== 2 ||
      hasLocalDeclarationDependency(declaration, local, codeWithoutImports)
    ) {
      continue;
    }
    splitCandidates.set(local, {
      kind: "local",
      local,
      declaration,
    });
  }

  if (splitCandidates.size === 0) {
    return null;
  }

  const routeNamespace = uniqueRouteNamespaceIdentifier(code);
  const effectNamespace = uniqueEffectNamespaceIdentifier(code);
  const removedImportLocals = new Set(
    Array.from(splitCandidates.values()).flatMap((candidate) =>
      candidate.kind === "import" ? [candidate.local] : [],
    ),
  );
  const localDeclarations = Array.from(splitCandidates.values()).flatMap((candidate) =>
    candidate.kind === "local" ? [candidate.declaration] : [],
  );

  for (const candidate of splitCandidates.values()) {
    if (candidate.kind === "local") {
      generatedSplitModules.set(
        splitLocalModuleId(candidate, options.root, id),
        createLocalSplitModule(code, candidate.declaration, options.root, id),
      );
    }
  }

  const withoutComponentImports = removeImportDeclarations(code, imports, removedImportLocals);
  const withoutLocalDeclarations = removeLocalDeclarationSources(
    withoutComponentImports,
    localDeclarations,
  );
  const transformed = withoutLocalDeclarations.replace(
    componentPropertyPattern,
    (full: string, prefix: string, local: string) => {
      const candidate = splitCandidates.get(local);
      if (candidate === undefined) {
        return full;
      }
      return `${prefix}component: ${routeNamespace}.lazyComponent(${effectNamespace}.tryPromise({ try: () => import(${JSON.stringify(
        splitCandidateModuleId(candidate, options.root, id),
      )}) }), ${JSON.stringify(candidate.local)})`;
    },
  );

  return pruneUnusedImportBindings(
    `import { Route as ${routeNamespace} } from "@effect-ui/core";\nimport { Effect as ${effectNamespace} } from "effect";\n${transformed}`,
  );
};

const splitVirtualModuleId = (id: string): string | undefined => {
  const normalized = id.startsWith("\0") ? id.slice(1) : id;
  return normalized.startsWith(`${startRouteComponentSplitVirtualModuleId}?`)
    ? normalized
    : undefined;
};

export const resolveStartRouteComponentSplitModuleId = (id: string): string | null => {
  const virtualId = splitVirtualModuleId(id);
  return virtualId === undefined ? null : `\0${virtualId}`;
};

export const loadStartRouteComponentSplitModule = (id: string): string | null => {
  const virtualId = splitVirtualModuleId(id);
  if (virtualId === undefined) {
    return null;
  }

  const generated = generatedSplitModules.get(virtualId);
  if (generated !== undefined) {
    return generated;
  }

  const query = virtualId.slice(startRouteComponentSplitVirtualModuleId.length + 1);
  const params = new URLSearchParams(query);
  const source = params.get("source");
  const imported = params.get("import");
  const exported = params.get("export");
  if (
    source === null ||
    imported === null ||
    exported === null ||
    !identifierPattern.test(exported) ||
    (imported !== "default" && !identifierPattern.test(imported))
  ) {
    return null;
  }

  return imported === "default"
    ? `export { default as ${exported} } from ${JSON.stringify(source)};`
    : `export { ${imported === exported ? imported : `${imported} as ${exported}`} } from ${JSON.stringify(source)};`;
};
