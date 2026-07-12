import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import ts from 'typescript';

const workspace = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'));
const productionDependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
const developmentDependencies = new Set(Object.keys(packageJson.devDependencies ?? {}));
const declaredDependencies = new Set([
  ...productionDependencies,
  ...developmentDependencies,
]);
const nodeBuiltins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const indirectRuntimeDependencies = new Set(['next', 'react', 'react-dom', 'xlsx', 'zod']);
const platformProvidedImports = new Set(['electron']);
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const scriptExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const styleExtensions = new Set(['.css', '.scss', '.sass']);

function indexedSourceFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '-z', '--', 'src', 'electron', 'scripts'],
    {
      cwd: workspace,
      encoding: 'buffer',
      shell: false,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    console.error('Runtime source enumeration failed: Git index unavailable.');
    process.exit(1);
  }

  return result.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter(relativePath => (
      !relativePath.includes('.test.') &&
      !relativePath.includes('.spec.') &&
      (scriptExtensions.has(path.extname(relativePath)) ||
        styleExtensions.has(path.extname(relativePath)))
    ));
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

const productionImportedPackages = new Set();
const toolImportedPackages = new Set();
const verifiedPlatformProvidedImports = new Set();
const invalidPlatformProvidedImports = new Set();
const undeclaredProductionImports = new Set();
const undeclaredToolImports = new Set();
for (const relativePath of indexedSourceFiles()) {
  const filePath = path.join(workspace, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const extension = path.extname(filePath);
  const specifiers = scriptExtensions.has(extension)
    ? scriptImports(filePath, source)
    : styleImports(source);
  for (const specifier of specifiers) {
    const importedPackage = packageName(specifier);
    if (!importedPackage) continue;

    const isProductionScript = scriptExtensions.has(extension) && (
      relativePath.startsWith('src/') || relativePath.startsWith('electron/')
    );
    if (isProductionScript) {
      if (platformProvidedImports.has(importedPackage)) {
        verifiedPlatformProvidedImports.add(importedPackage);
        const version = packageJson.devDependencies?.[importedPackage];
        if (
          productionDependencies.has(importedPackage) ||
          typeof version !== 'string' ||
          !exactVersion.test(version)
        ) {
          invalidPlatformProvidedImports.add(importedPackage);
        }
      } else {
        productionImportedPackages.add(importedPackage);
        if (!productionDependencies.has(importedPackage)) {
          undeclaredProductionImports.add(importedPackage);
        }
      }
    } else {
      toolImportedPackages.add(importedPackage);
      if (!declaredDependencies.has(importedPackage)) {
        undeclaredToolImports.add(importedPackage);
      }
      if (styleExtensions.has(extension) && productionDependencies.has(importedPackage)) {
        productionImportedPackages.add(importedPackage);
      }
    }
  }
}

const unused = [...productionDependencies]
  .filter(name => (
    !productionImportedPackages.has(name) &&
    !indirectRuntimeDependencies.has(name)
  ))
  .sort();
const approvedIndirectDependencies = new Set(
  [...indirectRuntimeDependencies].filter(name => (
    productionDependencies.has(name) && !productionImportedPackages.has(name)
  )),
);
const coveredProductionDependencies = new Set([
  ...productionImportedPackages,
  ...approvedIndirectDependencies,
]);

if (
  invalidPlatformProvidedImports.size ||
  undeclaredProductionImports.size ||
  undeclaredToolImports.size ||
  unused.length
) {
  for (const importedPackage of [...invalidPlatformProvidedImports].sort()) {
    console.error(
      `Invalid platform-provided import: ${importedPackage} must be an exact devDependency.`,
    );
  }
  if (undeclaredProductionImports.size) {
    console.error(
      `Undeclared production imports: ${[...undeclaredProductionImports].sort().join(', ')}`,
    );
  }
  if (undeclaredToolImports.size) {
    console.error(`Undeclared tool imports: ${[...undeclaredToolImports].sort().join(', ')}`);
  }
  if (unused.length) {
    console.error(`Unused production dependencies: ${unused.join(', ')}`);
  }
  process.exit(1);
}

console.log(
  `Runtime surface verified: ${coveredProductionDependencies.size} covered production ` +
  `dependencies, ${productionDependencies.size} declared production dependencies ` +
  `(${productionImportedPackages.size} imported, ` +
  `${approvedIndirectDependencies.size} approved indirect).`,
);
console.log(`Tool/build surface verified: ${toolImportedPackages.size} imported packages.`);
if (verifiedPlatformProvidedImports.size) {
  console.log(
    `Platform-provided imports verified: ` +
    `${[...verifiedPlatformProvidedImports].sort().join(', ')}.`,
  );
}
