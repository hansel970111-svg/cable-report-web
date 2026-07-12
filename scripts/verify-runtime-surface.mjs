import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import ts from 'typescript';

const workspace = process.cwd();
const sourceRoot = path.join(workspace, 'src');
const packageJson = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
const productionDependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
const declaredDependencies = new Set([
  ...productionDependencies,
  ...Object.keys(packageJson.devDependencies ?? {}),
]);
const nodeBuiltins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const indirectRuntimeDependencies = new Set(['next', 'react', 'react-dom', 'xlsx', 'zod']);
const scriptExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const styleExtensions = new Set(['.css', '.scss', '.sass']);

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    if (!entry.isFile() || entry.name.includes('.test.') || entry.name.includes('.spec.')) return [];
    const extension = path.extname(entry.name);
    return scriptExtensions.has(extension) || styleExtensions.has(extension) ? [fullPath] : [];
  });
}

function packageName(specifier) {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('@/') ||
    nodeBuiltins.has(specifier) ||
    specifier.startsWith('#') ||
    URL.canParse(specifier)
  ) {
    return null;
  }
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

function stringLiteralValue(node) {
  return ts.isStringLiteralLike(node) ? node.text : null;
}

function scriptImports(filePath, source) {
  const imports = [];
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier && stringLiteralValue(node.moduleSpecifier);
      if (specifier) imports.push(specifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression
    ) {
      const specifier = stringLiteralValue(node.moduleReference.expression);
      if (specifier) imports.push(specifier);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) {
        const specifier = stringLiteralValue(node.arguments[0]);
        if (specifier) imports.push(specifier);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function styleImports(source) {
  return [...source.matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)]
    .map(match => match[1]);
}

const importedPackages = new Set();
for (const filePath of sourceFiles(sourceRoot)) {
  const source = fs.readFileSync(filePath, 'utf8');
  const extension = path.extname(filePath);
  const specifiers = scriptExtensions.has(extension)
    ? scriptImports(filePath, source)
    : styleImports(source);
  for (const specifier of specifiers) {
    const importedPackage = packageName(specifier);
    if (importedPackage) importedPackages.add(importedPackage);
  }
}

const undeclared = [...importedPackages]
  .filter(name => !declaredDependencies.has(name))
  .sort();
const unused = [...productionDependencies]
  .filter(name => !importedPackages.has(name) && !indirectRuntimeDependencies.has(name))
  .sort();

if (undeclared.length || unused.length) {
  if (undeclared.length) {
    console.error(`Undeclared production imports: ${undeclared.join(', ')}`);
  }
  if (unused.length) {
    console.error(`Unused production dependencies: ${unused.join(', ')}`);
  }
  process.exit(1);
}

console.log(
  `Runtime surface verified: ${importedPackages.size} imported packages, ` +
  `${productionDependencies.size} declared production dependencies.`,
);
