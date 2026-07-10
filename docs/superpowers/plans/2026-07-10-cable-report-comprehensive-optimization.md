# Cable Report Generator Comprehensive Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在完全保留现有随机业务规则和三类 PDF 可见输出的前提下，把线缆测试报告应用重构为安全、可测试、可取消、可原生保存且能流畅处理 5,000 条记录的 macOS/Windows 桌面应用。

**Architecture:** 先用 TypeScript、Excel fixture 和 PDF golden 锁定现状，再依次建立共享领域模型、四类 Excel 策略、revision 状态机、虚拟化编辑器、受限 PDF job、严格 Python 协议和 Electron 原生保存边界。旧路由和 Python 大文件只在新链路与回归测试全部通过后删除，最终用 ASAR、包体预算和双平台打包 E2E 收口。

**Tech Stack:** Next.js 16.2.10 App Router、React 19.2.7、TypeScript 5.9.3、Zod 4.4.3、Vitest 4.1.10、React Testing Library、TanStack Virtual 3.14.5、Playwright 1.61.1、Electron 43.1.0、SheetJS CE 0.20.3、Python 3.10+、PyMuPDF 1.26.5、pytest 8.4.2、Pillow 11.3.0、PyInstaller 6.21.0、pnpm 9.15.9。

## Global Constraints

- 执行本计划前必须使用 `superpowers:using-git-worktrees` 创建隔离 worktree；不得直接在当前 `main` 工作树实施。
- 保留线长公式：缺失长度使用 `19`，乘以 `0.97 + random() * 0.06`，四舍五入至一位小数。
- 保留 NEXT Margin 公式和调用顺序：首次随机值 `< 0.8` 时使用 `11 + random() * 2`，否则使用 `9 + random() * 2`，四舍五入至一位小数。
- 导入记录的 Result 继续默认为 `PASS`；Excel 非空 Date & Time 优先于自动时间。
- 自动时间继续按 50–90 秒递增，跳过 12:00–12:59、18:00 以后及周末；进入新工作时段时分钟随机 1–5、秒随机 0–59。
- 生产服务只监听 `127.0.0.1`；生产 API 必须校验精确 Origin 和 32-byte 随机会话令牌。
- Excel 文件上限为 25 MiB；总记录上限为 10,000；Vertical 单行 QTY 上限为 5,000。
- PDF job 并发固定为 1、硬超时为 600,000 ms、stdout 上限为 64 KiB、PDF 上限为 268,435,456 bytes。
- Electron 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；preload 只暴露 `getDesktopSessionToken()` 与 `savePdf()`。
- 生产保存只允许原生“另存为”，使用同目录临时文件、fsync、rename；取消不能显示成功。
- 5,000 条 release fixture 的可见输入响应 P95 必须 `< 100 ms`，挂载虚拟行必须 `<= 200`，后续性能不得比记录基线恶化超过 20%。
- Next.js 固定 `16.2.10`；React/React DOM 固定 `19.2.7`；Electron 固定 `43.1.0`；SheetJS 固定官方 `0.20.3` tarball；TypeScript 固定 `5.9.3`；pnpm 固定 `9.15.9`。
- macOS 未压缩 `.app` 以 818 MiB（857,735,168 bytes）为基线，最终必须 `<= 643,301,376 bytes`，即至少缩小 25%。
- macOS 与 Windows 都必须完成冻结安装、构建、打包、启动、导入、生成和保存验收。
- 不修改、不暂存、不提交 `.superpowers/` 以及当前三个未跟踪 logo：`assets/cable-report-logo-horizontal.svg`、`assets/cable-report-logo.png`、`assets/cable-report-logo.svg`。
- Golden 只能在 Task 5 首次生成并人工审阅；后续任务不得为让测试通过而更新 golden。

## Target File Map

### Domain and import

- `src/domain/report/model.ts`：唯一共享领域类型。
- `src/domain/report/schema.ts`：HTTP/IPC 共用 Zod schema。
- `src/domain/report/site.ts`：Site 规范化和模板字符校验。
- `src/domain/report/date-time.ts`：严格日期时间解析与格式化。
- `src/domain/report/random-source.ts`：可注入随机源。
- `src/domain/report/cable-rules.ts`：Label、Limit、模板和文件名规则。
- `src/domain/report/time-sequence.ts`：唯一自动工作时间序列实现。
- `src/domain/report/record-mapper.ts`：导入行到稳定 `CableRecord` 的映射。
- `src/features/import-excel/*`：工作簿读取、列识别和四类策略；不得依赖 React 或 Next。

### UI and workflow

- `src/features/report-workflow/model.ts`：批准的 `WorkflowState` 和服务接口。
- `src/features/report-workflow/reducer.ts`：revision、旧请求失效和快照转换。
- `src/features/report-workflow/use-report-workflow.ts`：AbortController、API 和保存副作用。
- `src/features/report-editor/*`：导入面板、状态 Alert、操作区、虚拟表格和页面组合。
- `src/app/page.tsx`：最终只渲染 `ReportEditor`。

### Server, Python, and desktop

- `src/server/api-error.ts`：统一 `ApiError` 响应。
- `src/server/desktop-auth.ts` 与 `src/proxy.ts`：loopback Origin/令牌门禁。
- `src/server/pdf/*`：worker 命令、协议、进程树、job 控制器。
- `scripts/pdf_engine/*`：协议、公共 PDF 工具和 Cat5e/MPO/LC editor。
- `electron/security.cjs`：令牌与导航策略。
- `electron/save-pdf.cjs`：PDF IPC 校验与原子保存。
- `electron/preload.cjs`：两项最小 renderer 能力。
- `electron/main.cjs`：服务生命周期、窗口安全和 IPC 注册。

### Tests and release gates

- `tests/unit`：纯 TypeScript、server、Electron CJS 单元测试。
- `tests/components`：RTL、user-event、jest-axe 组件测试。
- `tests/python`：pytest、CLI 协议和 PDF golden。
- `tests/e2e`：release browser 与 packaged Electron 流程。
- `.github/workflows/quality.yml`：PR 质量门禁。
- `.github/workflows/desktop-e2e.yml`：macOS/Windows 发布矩阵。

---

### Task 1: Restore Scoped Quality Gates and Test Harnesses

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `eslint.config.mjs`
- Modify: `.gitignore`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/config/quality-scope.test.ts`
- Create: `pytest.ini`
- Create: `requirements-dev.txt`
- Create: `scripts/run-python.mjs`
- Modify: `src/app/page.tsx:581-610`
- Modify: `src/components/ui/date-time-picker.tsx:270-280`

**Interfaces:**
- Consumes: current source tree and `next-build` as the configured Next `distDir`.
- Produces: `pnpm lint`, `pnpm ts-check`, `pnpm test:unit`, `pnpm test:python`, `pnpm check:fast`; all later tasks use these commands.

- [ ] **Step 1: Record the current failing quality baseline**

Run:

```bash
corepack pnpm@9.15.9 exec eslint src
corepack pnpm@9.15.9 exec tsc -p tsconfig.json
```

Expected: ESLint reports the three explicit `any` errors and unused `tempDate`; TypeScript reports stale `next-build/dev/types/* 3.ts` route errors.

- [ ] **Step 2: Add a failing test proving generated output is outside both tools**

Create `tests/config/quality-scope.test.ts`:

```ts
import path from 'node:path';
import ts from 'typescript';
import { ESLint } from 'eslint';
import { expect, test } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

test('quality tools include source and exclude generated output', async () => {
  const raw = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config, ts.sys, root);

  expect(parsed.fileNames.some(file => file.endsWith('/src/app/page.tsx'))).toBe(true);
  expect(parsed.fileNames.some(file => file.includes('/next-build/dev/'))).toBe(false);

  const eslint = new ESLint({ cwd: root });
  await expect(eslint.isPathIgnored('next-build/dev/types/routes.d.ts')).resolves.toBe(true);
  await expect(eslint.isPathIgnored('worker-bin/pdf_worker')).resolves.toBe(true);
  await expect(eslint.isPathIgnored('.superpowers/brainstorm/visual.html')).resolves.toBe(true);
});
```

- [ ] **Step 3: Install only the test-harness dependencies for this baseline task**

Add exact dev dependencies and scripts to `package.json`:

```json
{
  "scripts": {
    "lint": "eslint . --max-warnings=0",
    "ts-check": "tsc -p tsconfig.json",
    "test:unit": "vitest run",
    "test:python": "node scripts/run-python.mjs -m pytest -q",
    "test": "pnpm test:unit && pnpm test:python",
    "check:fast": "pnpm lint && pnpm ts-check && pnpm test:unit"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "6.9.1",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.1",
    "@types/jest-axe": "3.5.9",
    "@vitest/coverage-v8": "4.1.10",
    "jest-axe": "10.0.0",
    "jsdom": "29.1.1",
    "vitest": "4.1.10"
  },
  "packageManager": "pnpm@9.15.9"
}
```

Run `corepack pnpm@9.15.9 install` and expected result is a successful install with a lockfile matching the temporary baseline dependency set.

- [ ] **Step 4: Configure Vitest, pytest, and the cross-platform Python launcher**

Create `vitest.config.ts`:

```ts
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    coverage: { provider: 'v8', reporter: ['text', 'json-summary', 'html'] },
  },
});
```

Create `tests/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, expect } from 'vitest';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);
afterEach(() => {
  if (typeof document !== 'undefined') cleanup();
});
```

Create `pytest.ini` and `requirements-dev.txt`:

```ini
[pytest]
testpaths = tests/python
pythonpath = scripts .
addopts = --strict-markers --strict-config
```

```text
-r requirements.txt
pytest==8.4.2
Pillow==11.3.0
```

Create `scripts/run-python.mjs`:

```js
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const candidates = process.env.PYTHON_CMD
  ? [[process.env.PYTHON_CMD, []]]
  : process.platform === 'win32'
    ? [['python', []], ['py', ['-3']]]
    : [['python3', []], ['python', []]];

for (const [command, prefix] of candidates) {
  const result = spawnSync(command, [...prefix, ...process.argv.slice(2)], {
    stdio: 'inherit', shell: false, windowsHide: true,
  });
  if (!result.error) process.exit(result.status ?? 1);
}

console.error('Python 3.10+ was not found; set PYTHON_CMD.');
process.exit(1);
```

- [ ] **Step 5: Narrow TypeScript and ESLint to owned source**

Set `tsconfig.json` `include`/`exclude` to:

```json
{
  "include": [
    "next-env.d.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    "tests/**/*.ts",
    "tests/**/*.tsx",
    "vitest.config.ts",
    "next-build/types/**/*.ts"
  ],
  "exclude": [
    "node_modules",
    ".next",
    "next-build/dev",
    "dist",
    "build",
    "release",
    "worker-bin",
    "resources/bin",
    ".pyinstaller",
    ".superpowers"
  ]
}
```

Set the ESLint global ignore list to exactly include:

```js
globalIgnores([
  '.next/**',
  'next-build/**',
  'out/**',
  'build/**',
  'dist/**',
  'release/**',
  'worker-bin/**',
  '.pyinstaller/**',
  '.superpowers/**',
  'coverage/**',
  'next-env.d.ts',
])
```

Add this CJS override after the ignore block so linting Electron source does not reject its required CommonJS loader:

```js
{
  files: ['electron/**/*.cjs', 'scripts/**/*.cjs'],
  rules: { '@typescript-eslint/no-require-imports': 'off' },
}
```

Add `.superpowers/` to `.gitignore`; do not add the logo paths because they must remain visible as protected user files.

- [ ] **Step 6: Fix only the four source lint findings without changing behavior**

Use typed callbacks in `page.tsx`:

```ts
filteredRows.slice(0, 5).map((row: Record<string, unknown>) => row.cableNo);
filteredRows.slice(-5).map((row: Record<string, unknown>) => row.cableNo);
const hasExcelDateTime = filteredRows.some((row: Record<string, unknown>) =>
  typeof row.dateTime === 'string' && row.dateTime.trim().length > 0
);
```

Delete only the unused line `const tempDate = new Date(y, m - 1, 1);` from `date-time-picker.tsx`.

- [ ] **Step 7: Verify the baseline gates turn green**

Run:

```bash
corepack pnpm@9.15.9 test:unit tests/config/quality-scope.test.ts
corepack pnpm@9.15.9 lint
corepack pnpm@9.15.9 ts-check
corepack pnpm@9.15.9 build
```

Expected: all commands exit 0; ESLint reports zero warnings; TypeScript no longer reads `next-build/dev`; production build succeeds.

- [ ] **Step 8: Commit the quality baseline**

```bash
git add package.json pnpm-lock.yaml tsconfig.json eslint.config.mjs .gitignore \
  vitest.config.ts tests/setup.ts tests/config/quality-scope.test.ts \
  pytest.ini requirements-dev.txt scripts/run-python.mjs \
  src/app/page.tsx src/components/ui/date-time-picker.tsx
git commit -m "test: establish scoped quality gates"
```

### Task 2: Establish Report Domain Contracts and Strict Date/Site Validation

**Files:**
- Create: `src/domain/report/model.ts`
- Create: `src/domain/report/schema.ts`
- Create: `src/domain/report/site.ts`
- Create: `src/domain/report/date-time.ts`
- Create: `src/domain/report/schema.test.ts`
- Create: `src/domain/report/date-time.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Zod 4.4.3.
- Produces: `CableType`, `ImportRule`, `CableImportRow`, `CableRecord`, `ReportDraft`, `ApiError`, all corresponding schemas, `normalizeSite()`, `isValidSite()`, `parseReportDateTime()`, `formatReportDateTime()`, `isValidReportDateTime()`.

- [ ] **Step 1: Add exact domain types**

First run `pnpm add --save-exact zod@4.4.3`; expected `package.json` and `pnpm-lock.yaml` record exactly `4.4.3`.

Create `src/domain/report/model.ts`:

```ts
export type CableType = 'Cat 5e' | 'Cat 5e (Vertical Cabling)' | 'LC' | 'MPO';
export type ImportRule = 'cat5e-oob' | 'vertical-cabling' | 'lc' | 'mpo';

export type CableImportRow = {
  cableNumber: string;
  cableTypeText: string;
  length: number | null;
  dateTime: string | null;
  sourceLabel: string | null;
  bandwidth: string | null;
  source: {
    sheetName: string;
    rowNumber: number;
    expansionIndex: number;
    rule: ImportRule;
  };
};

export type CableRecord = {
  id: string;
  cableLabel: string;
  cableNumber: string;
  limit: string;
  result: 'PASS' | 'FAIL';
  length: number;
  nextMargin: number;
  dateTime: string;
};

export type ReportDraft = {
  revision: number;
  cableType: CableType;
  site: string;
  records: CableRecord[];
};

export type ApiError = {
  error: { code: string; message: string; field?: string; retryable: boolean };
};
```

- [ ] **Step 2: Write failing schema, Site, and real-calendar tests**

Create `src/domain/report/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ReportDraftSchema } from './schema';
import { normalizeSite } from './site';

describe('report contracts', () => {
  it('normalizes Site and rejects characters the template cannot express', () => {
    expect(normalizeSite(' de46-1 ')).toBe('DE46-1');
    const result = ReportDraftSchema.safeParse({
      revision: 1, cableType: 'Cat 5e', site: 'DE46_1', records: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['site']);
  });
});
```

Create `src/domain/report/date-time.test.ts`:

```ts
import { expect, test } from 'vitest';
import { isValidReportDateTime } from './date-time';

test('accepts minute 00 and validates real calendar dates and 12-hour time', () => {
  expect(isValidReportDateTime('29-02-2024 09:00:00 AM')).toBe(true);
  expect(isValidReportDateTime('31-02-2024 09:00:00 AM')).toBe(false);
  expect(isValidReportDateTime('10-07-2026 13:00:00 PM')).toBe(false);
  expect(isValidReportDateTime('10-07-2026 12:00:00 AM')).toBe(true);
});
```

- [ ] **Step 3: Run the tests to confirm RED**

Run `pnpm test:unit src/domain/report/schema.test.ts src/domain/report/date-time.test.ts`.

Expected: FAIL because `schema.ts`, `site.ts`, and `date-time.ts` do not exist.

- [ ] **Step 4: Implement Site and date-time functions**

Create `src/domain/report/site.ts`:

```ts
const TEMPLATE_SITE_PATTERN = /^[DEMPS0-9: -]*$/;

export const normalizeSite = (input: string): string => input.trim().toUpperCase();
export const isValidSite = (input: string): boolean =>
  TEMPLATE_SITE_PATTERN.test(normalizeSite(input));
```

Create `src/domain/report/date-time.ts` with these exact public contracts and checks:

```ts
export type ReportDateTimeParts = {
  day: number; month: number; year: number;
  hour: number; minute: number; second: number; ampm: 'AM' | 'PM';
};

const PATTERN = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) (AM|PM)$/;

export function parseReportDateTime(input: string): ReportDateTimeParts | null {
  const match = PATTERN.exec(input);
  if (!match) return null;
  const parts: ReportDateTimeParts = {
    day: Number(match[1]), month: Number(match[2]), year: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6]),
    ampm: match[7] as 'AM' | 'PM',
  };
  if (parts.year < 2000 || parts.hour < 1 || parts.hour > 12 ||
      parts.minute < 0 || parts.minute > 59 || parts.second < 0 || parts.second > 59) return null;
  const candidate = new Date(parts.year, parts.month - 1, parts.day);
  if (candidate.getFullYear() !== parts.year || candidate.getMonth() !== parts.month - 1 ||
      candidate.getDate() !== parts.day) return null;
  return parts;
}

export function formatReportDateTime(parts: ReportDateTimeParts): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(parts.day)}-${two(parts.month)}-${parts.year} ${two(parts.hour)}:${two(parts.minute)}:${two(parts.second)} ${parts.ampm}`;
}

export const isValidReportDateTime = (input: string): boolean =>
  parseReportDateTime(input) !== null;
```

- [ ] **Step 5: Implement strict Zod schemas**

Create `src/domain/report/schema.ts`:

```ts
import { z } from 'zod';
import { isValidReportDateTime } from './date-time';
import type { ApiError, CableRecord, CableType, ReportDraft } from './model';
import { isValidSite, normalizeSite } from './site';

export const CableTypeSchema: z.ZodType<CableType> = z.enum([
  'Cat 5e', 'Cat 5e (Vertical Cabling)', 'LC', 'MPO',
]);

export const CableRecordSchema: z.ZodType<CableRecord> = z.object({
  id: z.string().min(1).max(200), cableLabel: z.string().max(200),
  cableNumber: z.string().max(200), limit: z.string().min(1).max(200),
  result: z.enum(['PASS', 'FAIL']), length: z.number().finite().nonnegative(),
  nextMargin: z.number().finite(),
  dateTime: z.string().refine(isValidReportDateTime, 'Invalid Date & Time'),
});

export const ReportDraftSchema: z.ZodType<ReportDraft> = z.object({
  revision: z.number().int().nonnegative(), cableType: CableTypeSchema,
  site: z.string().max(100).transform(normalizeSite).refine(isValidSite, 'Unsupported Site characters'),
  records: z.array(CableRecordSchema).max(10_000),
});

export const ApiErrorSchema: z.ZodType<ApiError> = z.object({
  error: z.object({
    code: z.string().min(1), message: z.string().min(1),
    field: z.string().optional(), retryable: z.boolean(),
  }),
});
```

- [ ] **Step 6: Verify contracts and commit**

Run:

```bash
pnpm test:unit src/domain/report/schema.test.ts src/domain/report/date-time.test.ts
pnpm lint
pnpm ts-check
```

Expected: all commands exit 0.

```bash
git add package.json pnpm-lock.yaml src/domain/report
git commit -m "test(domain): establish report contracts and validation"
```

### Task 3: Lock and Extract Random Rules, Working Time, and Record Mapping

**Files:**
- Create: `src/domain/report/random-source.ts`
- Create: `src/domain/report/cable-rules.ts`
- Create: `src/domain/report/time-sequence.ts`
- Create: `src/domain/report/record-mapper.ts`
- Create: `src/domain/report/time-sequence.test.ts`
- Create: `src/domain/report/record-mapper.test.ts`
- Modify: `src/lib/timeUtils.ts`
- Modify: `src/components/ui/date-time-picker.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `CableType`, `CableImportRow`, `CableRecord`, strict Date & Time parser.
- Produces: `RandomSource`, `mathRandomSource`, `defaultLimitForCableType()`, `buildCableLabel()`, `buildLimit()`, `templateAssetFor()`, `suggestedPdfName()`, `generateWorkingTimes()`, `mapImportedRows()`.

- [ ] **Step 1: Define the deterministic boundaries**

Create `src/domain/report/random-source.ts`:

```ts
export interface RandomSource { next(): number }
export const mathRandomSource: RandomSource = { next: () => Math.random() };
```

Use these signatures in `cable-rules.ts` and `record-mapper.ts`:

```ts
export function defaultLimitForCableType(cableType: CableType): string;
export function buildCableLabel(row: CableImportRow, cableType: CableType): string;
export function buildLimit(row: CableImportRow, cableType: CableType): string;
export function templateAssetFor(cableType: CableType): string;
export function suggestedPdfName(draft: ReportDraft, now: Date): string;

export type RecordIdFactory = (row: CableImportRow, index: number) => string;
export type MapImportedRowsOptions = {
  cableType: CableType; startingDateTime: string;
  random: RandomSource; idFactory: RecordIdFactory;
};
export function mapImportedRows(
  rows: readonly CableImportRow[], options: MapImportedRowsOptions,
): CableRecord[];
```

Implement the immutable template map and timestamped filename rule directly in `cable-rules.ts`:

```ts
const TEMPLATE_ASSETS: Record<CableType, string> = {
  'Cat 5e': 'assets/M138-DE46-OOB-Cat5e.pdf',
  'Cat 5e (Vertical Cabling)': 'assets/M138-DE46-OOB-Cat5e.pdf',
  LC: 'assets/M138-DE46-D-P-cross-LC.pdf',
  MPO: 'assets/M138-DE46-P-A-MPO.pdf',
};

export const templateAssetFor = (type: CableType) => TEMPLATE_ASSETS[type];
export function suggestedPdfName(draft: ReportDraft, now: Date) {
  const safeSite = draft.site.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Unknown';
  const safeType = draft.cableType.replace(/[^a-zA-Z0-9]/g, '_');
  const two = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}_${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `${safeSite}_${safeType}_${stamp}.pdf`;
}
```

- [ ] **Step 2: Write failing formula and call-order tests**

Create `src/domain/report/record-mapper.test.ts`:

```ts
import { expect, test } from 'vitest';
import type { CableImportRow } from './model';
import type { RandomSource } from './random-source';
import { mapImportedRows } from './record-mapper';

test('preserves Cat5e formulas and random call order', () => {
  const values = [0.5, 0.79, 0.25];
  let calls = 0;
  const random: RandomSource = { next: () => {
    const value = values[calls++];
    if (value === undefined) throw new Error('unexpected random call');
    return value;
  } };
  const row: CableImportRow = {
    cableNumber: '42', cableTypeText: '红', length: 100,
    dateTime: '10-07-2026 09:00:00 AM', sourceLabel: null, bandwidth: null,
    source: { sheetName: 'OOB', rowNumber: 2, expansionIndex: 0, rule: 'cat5e-oob' },
  };

  expect(mapImportedRows([row], {
    cableType: 'Cat 5e', startingDateTime: '10-07-2026 09:00:00 AM',
    random, idFactory: () => 'record-42',
  })).toEqual([{
    id: 'record-42', cableLabel: '#42', cableNumber: '42',
    limit: 'TIA - Cat 5e Channel', result: 'PASS', length: 100,
    nextMargin: 11.5, dateTime: '10-07-2026 09:00:00 AM',
  }]);
  expect(calls).toBe(3);
});
```

Add tests for missing length `19`, both Margin branches, MPO/LC/Vertical Label and Limit, and stable default ID `${sheetName}:${rowNumber}:${expansionIndex}`.

- [ ] **Step 3: Write failing time-boundary tests**

Create `src/domain/report/time-sequence.test.ts` with injected sequences that assert:

```ts
expect(generateWorkingTimes('10-07-2026 11:59:50 AM', 2, sequence([0, 0, 0])))
  .toEqual(['10-07-2026 11:59:50 AM', '10-07-2026 01:01:00 PM']);
expect(generateWorkingTimes('10-07-2026 05:59:50 PM', 2, sequence([0, 0, 0])))
  .toEqual(['10-07-2026 05:59:50 PM', '13-07-2026 09:01:00 AM']);
```

Also assert 50-second (`random=0`) and 90-second (`random` just below 1) intervals, pre-09:00 correction, Friday-to-Monday rollover, invalid real dates, and count 0.

- [ ] **Step 4: Run the focused tests to verify RED**

Run `pnpm test:unit src/domain/report/record-mapper.test.ts src/domain/report/time-sequence.test.ts`.

Expected: FAIL because the new modules do not exist.

- [ ] **Step 5: Move the existing formulas without changing their order**

Implement `mapImportedRows()` in this exact order:

```ts
export function mapImportedRows(
  rows: readonly CableImportRow[], options: MapImportedRowsOptions,
): CableRecord[] {
  const generatedTimes = generateWorkingTimes(
    options.startingDateTime, rows.length, options.random,
  );
  return rows.map((row, index) => {
    const baseLength = row.length ?? 19;
    const length = Number((baseLength * (0.97 + options.random.next() * 0.06)).toFixed(1));
    const highMargin = options.random.next() < 0.8;
    const nextMargin = Number(((highMargin ? 11 : 9) + options.random.next() * 2).toFixed(1));
    return {
      id: options.idFactory(row, index),
      cableLabel: buildCableLabel(row, options.cableType),
      cableNumber: row.cableNumber.replace(/^#/, ''),
      limit: buildLimit(row, options.cableType), result: 'PASS',
      length, nextMargin, dateTime: row.dateTime?.trim() || generatedTimes[index],
    };
  });
}
```

`generateWorkingTimes()` must receive every random value through `RandomSource.next()`; do not call `Math.random()` inside the function.

- [ ] **Step 6: Replace UI duplicates with compatibility exports**

Make `src/lib/timeUtils.ts` and `date-time-picker.tsx` import/re-export the domain functions while keeping existing component call sites valid during migration:

```ts
import { generateWorkingTimes } from '@/domain/report/time-sequence';
import { mathRandomSource } from '@/domain/report/random-source';

export function generateIncreasingTimes(startTime: string, count: number): string[] {
  return generateWorkingTimes(startTime, count, mathRandomSource);
}
export function generateDecreasingTimes(startTime: string, count: number): string[] {
  return generateWorkingTimes(startTime, count, mathRandomSource);
}
```

Update `page.tsx` to call `mapImportedRows()` and `mathRandomSource`; delete the inline length/Margin/Label/Limit formula only after the new focused tests pass.

- [ ] **Step 7: Verify and commit**

```bash
pnpm test:unit src/domain/report/record-mapper.test.ts src/domain/report/time-sequence.test.ts
pnpm lint
pnpm ts-check
git add src/domain/report src/lib/timeUtils.ts src/components/ui/date-time-picker.tsx src/app/page.tsx
git commit -m "refactor(domain): extract deterministic report rules"
```

Expected: tests prove exact formulas/call counts and all quality gates exit 0.

### Task 4: Characterize and Split the Four Excel Import Strategies

**Files:**
- Create: `src/features/import-excel/contracts.ts`
- Create: `src/features/import-excel/errors.ts`
- Create: `src/features/import-excel/workbook-reader.ts`
- Create: `src/features/import-excel/column-detection.ts`
- Create: `src/features/import-excel/strategies/strategy.ts`
- Create: `src/features/import-excel/strategies/cat5e-oob.ts`
- Create: `src/features/import-excel/strategies/vertical-cabling.ts`
- Create: `src/features/import-excel/strategies/lc.ts`
- Create: `src/features/import-excel/strategies/mpo.ts`
- Create: `src/features/import-excel/import-excel.ts`
- Create: `src/features/import-excel/import-excel.test.ts`
- Create: `tests/fixtures/excel/build-fixtures.mjs`
- Create: `tests/fixtures/excel/cat5e-oob.xlsx`
- Create: `tests/fixtures/excel/vertical.xlsx`
- Create: `tests/fixtures/excel/lc.xls`
- Create: `tests/fixtures/excel/mpo.xlsx`
- Modify: `src/app/api/upload-excel/route.ts`

**Interfaces:**
- Consumes: `CableType`, `CableImportRow`, current SheetJS version for characterization.
- Produces: `IMPORT_LIMITS`, `ExcelFileInput`, `ImportExcelResult`, `ImportExcelError`, `ExcelImportStrategy`, `excelStrategies`, `importExcel()`.

```ts
export const IMPORT_LIMITS = {
  maxBytes: 25 * 1024 * 1024, maxRecords: 10_000, maxQtyPerRow: 5_000,
} as const;
export type ExcelFileInput = { fileName: string; mimeType: string; bytes: Uint8Array };
export type ImportExcelResult = {
  rows: CableImportRow[];
  metadata: {
    sheetNames: string[];
    detectedColumns: Readonly<Record<string, string | null>>;
    rule: ImportRule;
  };
};
export type ImportLimits = {
  maxBytes: number; maxRecords: number; maxQtyPerRow: number;
};
export type WorkbookContext = {
  workbook: XLSX.WorkBook;
  fileName: string;
  sheetNames: readonly string[];
};
export type ImportExcelErrorCode =
  | 'UNSUPPORTED_EXCEL_FILE' | 'EXCEL_FILE_TOO_LARGE' | 'EXCEL_PARSE_FAILED'
  | 'NO_MATCHING_ROWS' | 'QTY_LIMIT_EXCEEDED' | 'RECORD_LIMIT_EXCEEDED';
export class ImportExcelError extends Error {
  constructor(
    readonly code: ImportExcelErrorCode, message: string,
    readonly retryable: boolean, readonly field?: string,
  ) { super(message); }
}
export interface ExcelImportStrategy {
  readonly cableType: CableType;
  extract(workbook: WorkbookContext, limits: ImportLimits): CableImportRow[];
}
export const excelStrategies: Readonly<Record<CableType, ExcelImportStrategy>>;
export function importExcel(
  input: ExcelFileInput, cableType: CableType, limits?: ImportLimits,
): ImportExcelResult;
```

- [ ] **Step 1: Generate and commit fixed real workbooks before moving parser logic**

The fixture builder must create these exact rows and write both BIFF `.xls` and OOXML `.xlsx` through `XLSX.writeFile()`:

```js
const cases = [
  ['cat5e-oob.xlsx', 'OOB', [
    ['线缆类型', '线号', '线长', 'Date & Time'],
    ['红', '42', 100, '10-07-2026 09:00:00 AM'],
  ]],
  ['vertical.xlsx', 'Vertical Cabling', [
    ['Rack&Room', 'RU', '线缆类型', 'QTY', 'Length'],
    ['DE46', 'RU01', '红', 2, 30],
  ]],
  ['lc.xls', 'Cross Connect', [
    ['线缆类型', '线号', '线长', 'Date & Time'],
    ['SM,LC-LC', 'LC-001', 20, '10-07-2026 09:00:00 AM'],
  ]],
  ['mpo.xlsx', 'Fiber', [
    ['线缆类型', '线号', '线长', 'Date & Time'],
    ['MPO 200G', 'MPO-001', 15, '10-07-2026 09:00:00 AM'],
  ]],
];
```

Run `node tests/fixtures/excel/build-fixtures.mjs`; expected four files are created and `git diff --stat` shows only fixture additions.

- [ ] **Step 2: Write characterization tests against the existing 923-line behavior**

In `import-excel.test.ts`, assert exact `CableImportRow` arrays for all four fixture files, YYBX sheet precedence, Vertical expansion IDs, multiple length-column sum behavior, bandwidth extraction, and Date & Time normalization.

Use this representative limit test:

```ts
expect(() => importExcel({
  fileName: 'vertical.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  bytes: makeWorkbookBytes([
    ['Rack&Room', 'RU', '线缆类型', 'QTY', 'Length'],
    ['DE46', 'RU01', '红', 5001, 30],
  ]),
}, 'Cat 5e (Vertical Cabling)')).toThrowError(expect.objectContaining({
  code: 'QTY_LIMIT_EXCEEDED', field: 'QTY', retryable: false,
}));
```

- [ ] **Step 3: Verify the new module tests are RED**

Run `pnpm test:unit src/features/import-excel/import-excel.test.ts`.

Expected: FAIL because `import-excel.ts` does not exist.

- [ ] **Step 4: Implement the common workbook boundary**

`workbook-reader.ts` must accept only `.xls`/`.xlsx`, the documented Excel MIME types, and these magic bytes:

```ts
const OLE = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_PREFIXES = [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]];
```

It must reject `bytes.byteLength > limits.maxBytes` before `XLSX.read()`, call `XLSX.read(bytes, { type: 'array', cellDates: true })`, and map parser failures to `EXCEL_PARSE_FAILED` without exposing the SheetJS stack.

- [ ] **Step 5: Move column detection and each strategy without rewriting formulas**

Move the current helpers in dependency order:

```text
normalizeCell/readNumber/readDateTime
  -> column profile detection
  -> cat5e-oob/lc/mpo row collection
  -> vertical QTY expansion
  -> importExcel strategy dispatch
```

Every strategy implements:

```ts
export interface ExcelImportStrategy {
  readonly cableType: CableType;
  extract(workbook: WorkbookContext, limits: ImportLimits): CableImportRow[];
}
```

Vertical must check `qty > 5_000` and `currentCount + qty > 10_000` before allocating expanded rows. Every other strategy must stop before pushing record 10,001 and throw `RECORD_LIMIT_EXCEEDED`.

- [ ] **Step 6: Turn the old route into a compatibility adapter**

Keep `POST` at `/api/upload-excel` but replace its internal parser with:

```ts
const result = importExcel({
  fileName: file.name,
  mimeType: file.type,
  bytes: new Uint8Array(await file.arrayBuffer()),
}, CableTypeSchema.parse(cableType));

return NextResponse.json({
  success: true,
  filteredRows: result.rows.map(row => ({
    cableNo: row.cableNumber, length: row.length, dateTime: row.dateTime,
    sourceLabel: row.sourceLabel, bandwidth: row.bandwidth,
  })),
  totalCount: result.rows.length,
  sheetName: result.metadata.sheetNames[0] ?? '',
  detectedColumns: result.metadata.detectedColumns,
  dataSource: result.metadata.rule,
  cableType,
});
```

- [ ] **Step 7: Run all import tests and commit**

```bash
pnpm test:unit src/features/import-excel src/domain/report
pnpm lint
pnpm ts-check
git add src/features/import-excel src/app/api/upload-excel/route.ts tests/fixtures/excel
git commit -m "refactor(import): split excel parsing strategies"
```

Expected: `.xls`, `.xlsx`, YYBX, all strategies and all limits pass with the current SheetJS baseline.

### Task 5: Lock Cat5e, MPO, and LC PDF Golden Output

**Files:**
- Create: `tests/python/pdf_golden.py`
- Create: `tests/python/test_pdf_golden.py`
- Create: `tests/python/fixtures/pdf-cases.json`
- Create: `tests/python/golden/cat5e-minimal/*`
- Create: `tests/python/golden/cat5e-cross-page/*`
- Create: `tests/python/golden/mpo-minimal/*`
- Create: `tests/python/golden/mpo-cross-page/*`
- Create: `tests/python/golden/lc-minimal/*`
- Create: `tests/python/golden/lc-cross-page/*`
- Create: `scripts/update_pdf_goldens.py`

**Interfaces:**
- Consumes: current `scripts/pdf_editor.py::modify_pdf_precise()` and the three committed templates.
- Produces: `GoldenCase`, `load_cases()`, `build_records()`, `assert_pdf_matches_golden()`; later Python tasks may consume but never update these baselines.

```py
@dataclass(frozen=True)
class GoldenCase:
    name: str
    kind: Literal['cat5e', 'mpo', 'lc']
    template: Path
    site: str
    record_count: int
    expected_pages: int

def assert_pdf_matches_golden(
    pdf_path: Path, golden_dir: Path, *, render_dpi: int = 144,
    max_changed_pixel_ratio: float = 0.001,
    max_mean_channel_delta: float = 0.5,
) -> None: ...
```

- [ ] **Step 1: Define the six deterministic cases**

Create `pdf-cases.json` with minimal cases of 2 records and `expected_pages: 1`, plus cross-page cases of 49 records and `expected_pages: 2`, for each kind. Every case uses Site `M138-DE46`; record 2 and every tenth record use `FAIL`; dates begin at `15-05-2026 09:00:00 AM`; lengths and margins are fixed numeric sequences, never random.

- [ ] **Step 2: Write the missing-golden RED test**

```py
@pytest.mark.parametrize('case', load_cases(), ids=lambda case: case.name)
def test_pdf_matches_approved_golden(case, tmp_path):
    output = tmp_path / f'{case.name}.pdf'
    result = modify_pdf_precise(
        str(ROOT / case.template), str(output),
        {'site': case.site, 'records': build_records(case)},
    )
    assert result.get('success') is True, result
    assert_pdf_matches_golden(output, ROOT / 'tests/python/golden' / case.name)
```

Run `pnpm test:python tests/python/test_pdf_golden.py`.

Expected: FAIL with `approved golden missing: .../manifest.json`.

- [ ] **Step 3: Implement normalized text and rendering comparison**

`pdf_golden.py` must:

```py
with fitz.open(pdf_path) as document:
    pages = [page.get_text('text') for page in document]
    assert document.page_count == manifest['page_count']
    for page_number, page in enumerate(document):
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        image = Image.frombytes('RGB', [pixmap.width, pixmap.height], pixmap.samples)
```

Normalize PDF metadata and the dynamic `Printed:` value in text; mask only the `Printed:` bounding box in rendered images. Assert page count, key row fields, Site, PASS/FAIL, total length, footer, reopening without damaged objects, changed-pixel ratio and mean channel delta.

- [ ] **Step 4: Generate golden once and inspect every page visually**

Run:

```bash
node scripts/run-python.mjs scripts/update_pdf_goldens.py --all
find tests/python/golden -name 'page-*.png' -print | sort
```

Open every printed PNG with the local image viewer. Confirm fonts, Site, labels, Result icons, date/time, summary and footer against the source templates. If a page is wrong, fix fixture assumptions or current baseline code before approving it; do not approve a visibly broken image.

- [ ] **Step 5: Verify golden is stable and commit it alone**

```bash
pnpm test:python tests/python/test_pdf_golden.py
git diff --stat -- tests/python/golden
git add tests/python/pdf_golden.py tests/python/test_pdf_golden.py \
  tests/python/fixtures/pdf-cases.json tests/python/golden scripts/update_pdf_goldens.py
git commit -m "test(pdf): lock Cat5e MPO and LC golden output"
```

Expected: all six cases pass on two consecutive runs with no golden diff.

### Task 6: Upgrade the Runtime and Rebuild Trusted Dependency Locks

**Files:**
- Modify: `package.json`
- Regenerate: `pnpm-lock.yaml`
- Modify: `.npmrc`
- Modify: `.gitignore`
- Delete: `.babelrc`
- Delete local ignored duplicate: `next.config.ts`
- Create: `vendor/xlsx-0.20.3.tgz`
- Create: `scripts/verify-dependency-policy.mjs`
- Create: `tests/config/dependency-policy.test.ts`
- Create: `tests/dependencies/sheetjs-compat.test.ts`
- Modify: `requirements.txt`
- Modify: `requirements-dev.txt`
- Create: `requirements.lock`
- Create: `requirements-dev.lock`
- Create: `tests/python/test_runtime_dependencies.py`

**Interfaces:**
- Consumes: Excel fixtures from Task 4 and all PDF golden from Task 5.
- Produces: frozen Node/Python dependency baselines; every later install uses `pnpm install --frozen-lockfile` and `pip install --require-hashes -r requirements-dev.lock`.

- [ ] **Step 1: Write a failing exact-version and tarball-policy test**

Create `tests/config/dependency-policy.test.ts`:

```ts
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import packageJson from '../../package.json';
import { expect, test } from 'vitest';

test('approved dependency baseline is exact', async () => {
  expect(packageJson.dependencies).toMatchObject({
    next: '16.2.10', react: '19.2.7', 'react-dom': '19.2.7',
    xlsx: 'file:vendor/xlsx-0.20.3.tgz', zod: '4.4.3',
    '@tanstack/react-virtual': '3.14.5',
  });
  expect(packageJson.devDependencies).toMatchObject({
    electron: '43.1.0', 'electron-builder': '26.15.3',
    'eslint-config-next': '16.2.10', typescript: '5.9.3',
  });
  expect(packageJson.packageManager).toBe('pnpm@9.15.9');
  const tarball = await readFile('vendor/xlsx-0.20.3.tgz');
  expect(createHash('sha256').update(tarball).digest('hex'))
    .toBe('8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8');
});
```

Run `pnpm test:unit tests/config/dependency-policy.test.ts`.

Expected: FAIL on current Next/React/Electron/xlsx versions and missing tarball.

- [ ] **Step 2: Vendor and verify SheetJS before changing the manifest**

Run:

```bash
mkdir -p vendor
curl -LfsS https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz -o vendor/xlsx-0.20.3.tgz
echo "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8  vendor/xlsx-0.20.3.tgz" | shasum -a 256 -c -
```

Expected: `vendor/xlsx-0.20.3.tgz: OK`.

Because `.gitignore` currently ignores `*.tgz`, add:

```gitignore
!vendor/
!vendor/xlsx-0.20.3.tgz
```

- [ ] **Step 3: Pin the approved Node baseline**

Set these exact entries in `package.json`:

```json
{
  "dependencies": {
    "@tanstack/react-virtual": "3.14.5",
    "next": "16.2.10",
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "xlsx": "file:vendor/xlsx-0.20.3.tgz",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@axe-core/playwright": "4.12.1",
    "@playwright/test": "1.61.1",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "electron": "43.1.0",
    "electron-builder": "26.15.3",
    "eslint-config-next": "16.2.10",
    "typescript": "5.9.3"
  },
  "packageManager": "pnpm@9.15.9",
  "engines": { "pnpm": "9.15.9" }
}
```

Keep the Task 1 test dependencies exact; do not retain caret/range versions for the runtimes listed above.

- [ ] **Step 4: Restore package-store integrity and remove compiler drift**

Set `.npmrc` security entries to:

```ini
strictStorePkgContentCheck=true
verifyStoreIntegrity=true
strict-peer-dependencies=true
auto-install-peers=false
prefer-frozen-lockfile=true
```

Delete `.babelrc` so Next uses SWC. Delete the ignored duplicate `next.config.ts`; `next.config.mjs` remains the single configuration source.

- [ ] **Step 5: Rebuild the lockfile from the manifest and prove no ghost tree remains**

Run:

```bash
corepack prepare pnpm@9.15.9 --activate
pnpm install --lockfile-only --force
pnpm install --frozen-lockfile
pnpm list --depth 0
```

Create `scripts/verify-dependency-policy.mjs` to read `package.json` and `pnpm-lock.yaml`, fail when a direct package is absent/mismatched, and fail if root importers contain `@aws-sdk/*`, `@supabase/*`, `drizzle-*` or `@coze/*`.

Expected: the verification script exits 0 and those ghost packages are not root importer dependencies.

- [ ] **Step 6: Pin Python inputs and compile hash locks**

Replace `requirements.txt` with:

```text
PyMuPDF==1.26.5
pdfplumber==0.11.10
reportlab==5.0.0
pyinstaller==6.21.0
```

Replace `requirements-dev.txt` with:

```text
-r requirements.txt
pytest==8.4.2
Pillow==11.3.0
```

Run:

```bash
python3 -m pip install pip-tools==7.5.3
python3 -m piptools compile --generate-hashes --output-file requirements.lock requirements.txt
python3 -m piptools compile --generate-hashes --output-file requirements-dev.lock requirements-dev.txt
python3 -m pip install --require-hashes -r requirements-dev.lock
```

`test_runtime_dependencies.py` imports `fitz`, `pdfplumber`, `reportlab`, `PIL` and `pytest`, then asserts their installed versions match the direct pins.

- [ ] **Step 7: Prove SheetJS parses the pre-upgrade fixtures identically**

Create `tests/dependencies/sheetjs-compat.test.ts` that reruns `importExcel()` for all four committed workbooks and compares the complete normalized `ImportExcelResult` to the Task 4 expected objects. Include this structural assertion:

```ts
const workbook = XLSX.readFile('tests/fixtures/excel/cat5e-oob.xlsx');
expect(workbook.SheetNames).toContain('OOB');
expect(XLSX.utils.sheet_to_json(workbook.Sheets.OOB, { header: 1 })[1])
  .toEqual(['红', '42', 100, '10-07-2026 09:00:00 AM']);
```

- [ ] **Step 8: Run the complete dependency migration gate**

```bash
pnpm test:unit tests/config/dependency-policy.test.ts tests/dependencies/sheetjs-compat.test.ts
pnpm test:python tests/python/test_runtime_dependencies.py tests/python/test_pdf_golden.py
pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org
pnpm check:fast
pnpm build
```

Expected: fixtures and golden are unchanged; no unaccepted high/critical direct vulnerability; every command exits 0.

- [ ] **Step 9: Commit only trusted dependency inputs and generated locks**

```bash
git add package.json pnpm-lock.yaml .npmrc .gitignore vendor/xlsx-0.20.3.tgz \
  requirements.txt requirements-dev.txt requirements.lock requirements-dev.lock \
  scripts/verify-dependency-policy.mjs tests/config/dependency-policy.test.ts \
  tests/dependencies/sheetjs-compat.test.ts tests/python/test_runtime_dependencies.py
git rm .babelrc
git commit -m "build: upgrade runtimes and rebuild trusted locks"
```

### Task 7: Secure the Desktop Session, API Boundary, and Navigation Policy

**Files:**
- Create: `electron/security.cjs`
- Create: `electron/preload.cjs`
- Create: `src/server/desktop-auth.ts`
- Create: `src/server/api-error.ts`
- Create: `src/lib/desktop-api.ts`
- Create: `src/proxy.ts`
- Create: `src/types/electron.d.ts`
- Create: `tests/electron/security.test.ts`
- Create: `tests/server/desktop-auth.test.ts`
- Modify: `electron/main.cjs`
- Modify: `scripts/dev.mjs`
- Modify: `scripts/start.mjs`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: approved loopback/GitHub allowlist and `ApiError` domain type.
- Produces: `createDesktopSessionToken()`, `classifyNavigation()`, `verifyDesktopRequest()`, `desktopFetch()`, `apiError()`, and `window.cableReport.getDesktopSessionToken()`.

```ts
type NavigationDecision =
  | { kind: 'internal' }
  | { kind: 'external'; url: string }
  | { kind: 'deny' };

type DesktopAuthInput = {
  origin: string | null; token: string | null;
  expectedOrigin: string; expectedToken: string; devBrowserMode: boolean;
};

export function verifyDesktopRequest(input: DesktopAuthInput):
  | { ok: true }
  | { ok: false; status: 401 | 403; code: 'DESKTOP_TOKEN_REQUIRED' | 'ORIGIN_REJECTED' };
```

- [ ] **Step 1: Write RED tests for token length, lookalikes, and constant-time auth outcomes**

```ts
const appOrigin = 'http://127.0.0.1:51234';
expect(classifyNavigation(`${appOrigin}/`, appOrigin)).toEqual({ kind: 'internal' });
expect(classifyNavigation(
  'https://github.com/hansel970111-svg/cable-report-web/releases/latest', appOrigin,
)).toEqual(expect.objectContaining({ kind: 'external' }));
for (const url of [
  'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,boom',
  'http://github.com/hansel970111-svg/cable-report-web/',
  'https://github.com.evil.example/hansel970111-svg/cable-report-web/',
  'https://github.com/another/repository/',
]) expect(classifyNavigation(url, appOrigin)).toEqual({ kind: 'deny' });
expect(createDesktopSessionToken(size => Buffer.alloc(size, 7))).toHaveLength(43);
```

Auth tests assert exact Origin + exact token succeeds, absent token is 401, wrong Origin is 403, unequal token length is safely rejected, and dev browser mode succeeds only for `127.0.0.1`/`localhost` Origin.

- [ ] **Step 2: Run the security tests to confirm RED**

Run `pnpm test:unit tests/electron/security.test.ts tests/server/desktop-auth.test.ts`.

Expected: FAIL because security modules do not exist.

- [ ] **Step 3: Implement security primitives**

`electron/security.cjs` must use:

```js
function createDesktopSessionToken(randomBytes = require('node:crypto').randomBytes) {
  return randomBytes(32).toString('base64url');
}
```

`classifyNavigation()` parses with `new URL()`, compares `target.origin === appOrigin` for internal URLs, and permits external only when protocol is `https:`, hostname is exactly `github.com`, and pathname is the repository root or starts with `/hansel970111-svg/cable-report-web/releases`.

`verifyDesktopRequest()` compares equal-length token buffers with `crypto.timingSafeEqual()`; it never calls `timingSafeEqual()` on unequal lengths.

- [ ] **Step 4: Add a defense-in-depth API wrapper and stable errors**

Create `src/server/api-error.ts`:

```ts
export function apiError(
  status: number, code: string, message: string, retryable: boolean, field?: string,
): Response {
  return Response.json({ error: { code, message, retryable, ...(field ? { field } : {}) } }, { status });
}
```

Create `src/proxy.ts` with `config = { matcher: '/api/:path*' }`. It calls `verifyDesktopRequest()` using `Origin`, `X-Cable-Desktop-Token`, `CABLE_DESKTOP_ORIGIN`, `CABLE_DESKTOP_TOKEN`, and `CABLE_DEV_BROWSER_MODE`; failures return `apiError()`. Route handlers added later must also call the same verifier through an exported `requireDesktopApi(request)` helper so direct handler tests cannot bypass it.

- [ ] **Step 5: Expose only the token bridge and secure the Electron window**

`electron/preload.cjs`:

```js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cableReport', {
  getDesktopSessionToken: () => ipcRenderer.invoke('cable-report:get-session-token'),
});
```

In `main.cjs`, create one token before starting Next, assign `CABLE_DESKTOP_TOKEN`, set `CABLE_DESKTOP_ORIGIN` after the loopback URL is known, configure the absolute preload path, validate the IPC sender is `mainWindow.webContents`, deny every permission request, and make `setWindowOpenHandler` plus `will-navigate` share `classifyNavigation()`.

- [ ] **Step 6: Route existing renderer fetches through the token-aware helper**

Create `desktopFetch()`:

```ts
export async function desktopFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (window.cableReport) {
    headers.set('X-Cable-Desktop-Token', await window.cableReport.getDesktopSessionToken());
  }
  return fetch(input, { ...init, headers });
}
```

Replace the inner `fetch()` call in current `page.tsx::fetchWithTimeout()` with `desktopFetch()` so the current application remains functional after the proxy is enabled.

`scripts/dev.mjs` and `scripts/start.mjs --browser-dev` explicitly set `CABLE_DEV_BROWSER_MODE=1`; Electron development does not. `layout.tsx` writes `data-dev-browser-mode="true"` only in that explicit mode.

- [ ] **Step 7: Verify current browser and Electron paths and commit**

```bash
pnpm test:unit tests/electron/security.test.ts tests/server/desktop-auth.test.ts
pnpm check:fast
pnpm build
git add electron/security.cjs electron/preload.cjs electron/main.cjs \
  src/server/desktop-auth.ts src/server/api-error.ts src/lib/desktop-api.ts \
  src/proxy.ts src/types/electron.d.ts scripts/dev.mjs scripts/start.mjs \
  src/app/layout.tsx src/app/page.tsx tests/electron/security.test.ts tests/server/desktop-auth.test.ts
git commit -m "feat: secure desktop session and navigation boundaries"
```

### Task 8: Add the Bounded `/api/import-excel` Contract

**Files:**
- Create: `src/app/api/import-excel/route.ts`
- Create: `src/app/api/import-excel/route.test.ts`
- Modify: `src/app/api/upload-excel/route.ts`
- Modify: `src/features/import-excel/errors.ts`

**Interfaces:**
- Consumes: `importExcel()`, `CableTypeSchema`, `IMPORT_LIMITS`, `requireDesktopApi()`, `apiError()`.
- Produces: `POST /api/import-excel` returning `{ data: ImportExcelResult }` or the approved `ApiError`; old `/api/upload-excel` remains a tested compatibility adapter until Task 19.

- [ ] **Step 1: Write RED route tests for the full boundary**

Use an exported factory for dependency injection:

```ts
export function createImportExcelHandler(deps: {
  importExcel: typeof importExcel;
  authenticate: typeof requireDesktopApi;
}): (request: Request) => Promise<Response>;
```

Tests must assert: missing/invalid token, bad Origin, absent file, unsupported cable type, content-length over 25 MiB before `formData()`, actual file over 25 MiB, extension/MIME/magic mismatch, QTY 5,001, total 10,001, parse failure without stack, no matching rows, and a successful `.xls` and `.xlsx` response.

Representative assertion:

```ts
const response = await handler(makeMultipartRequest({
  cableType: 'Cat 5e (Vertical Cabling)', file: verticalQty5001,
}));
expect(response.status).toBe(400);
await expect(response.json()).resolves.toEqual({
  error: {
    code: 'QTY_LIMIT_EXCEEDED', message: '单行 QTY 不能超过 5000。',
    field: 'QTY', retryable: false,
  },
});
```

- [ ] **Step 2: Run the route tests to verify RED**

Run `pnpm test:unit src/app/api/import-excel/route.test.ts`.

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement authentication, early size checks, and stable mapping**

The handler order must be:

```ts
const denied = deps.authenticate(request);
if (denied) return denied;
const declared = Number(request.headers.get('content-length') ?? 0);
if (declared > IMPORT_LIMITS.maxBytes + 64 * 1024) {
  return apiError(413, 'EXCEL_FILE_TOO_LARGE', 'Excel 文件不能超过 25 MiB。', false, 'file');
}
const form = await request.formData();
const file = form.get('file');
const cableTypeResult = CableTypeSchema.safeParse(form.get('cableType'));
```

After verifying `file instanceof File` and `file.size <= 25 MiB`, pass a `Uint8Array` to `importExcel()`. Catch only `ImportExcelError` for public code/message mapping; unknown errors return `EXCEL_PARSE_FAILED` with no path, row content, or traceback.

- [ ] **Step 4: Keep the old endpoint compatible without duplicate parser code**

The old route calls the same `importExcel()` and transforms only the response shape required by the pre-refactor page. Add a response header `Deprecation: true`; do not copy detection or expansion helpers back into the route.

- [ ] **Step 5: Verify both endpoints and commit**

```bash
pnpm test:unit src/app/api/import-excel src/features/import-excel
pnpm lint
pnpm ts-check
git add src/app/api/import-excel src/app/api/upload-excel/route.ts src/features/import-excel/errors.ts
git commit -m "feat(import): add bounded import API"
```

### Task 9: Implement the Revisioned Workflow State Machine

**Files:**
- Create: `src/features/report-workflow/model.ts`
- Create: `src/features/report-workflow/reducer.ts`
- Create: `src/features/report-workflow/reducer.test.ts`
- Create: `src/features/report-workflow/services.ts`
- Create: `src/features/report-workflow/save-contract.ts`
- Create: `src/features/report-workflow/use-report-workflow.ts`
- Create: `src/features/report-workflow/use-report-workflow.test.tsx`

**Interfaces:**
- Consumes: `ReportDraft`, `ImportExcelResult`, `mapImportedRows()`.
- Produces: the approved `WorkflowState`, `WorkflowModel`, `WorkflowAction`, `ReportWorkflowServices`, `useReportWorkflow()`.

```ts
export type WorkflowState =
  | { status: 'idle' }
  | { status: 'importing'; requestId: string; revision: number }
  | { status: 'ready'; draft: ReportDraft }
  | { status: 'generating'; snapshot: ReportDraft; jobId: string }
  | { status: 'saving'; snapshot: ReportDraft; suggestedName: string }
  | { status: 'error'; phase: 'import' | 'generate' | 'save'; message: string; retryable: boolean };

export interface ReportWorkflowServices {
  importExcel(file: File, cableType: CableType, signal: AbortSignal): Promise<ImportExcelResult>;
  generateReport(draft: ReportDraft, signal: AbortSignal): Promise<GeneratedReport>;
  savePdf(request: SavePdfRequest): Promise<SavePdfResult>;
}
```

Define the adjacent contracts once in `save-contract.ts`/`model.ts` so Task 13 and Task 15 reuse the same names and fields:

```ts
export type GeneratedReport = {
  bytes: ArrayBuffer; suggestedName: string; jobId: string;
};
export type SavePdfRequest = { suggestedName: string; bytes: ArrayBuffer };
export type SavePdfResult =
  | { status: 'saved'; fileName: string }
  | { status: 'cancelled' }
  | { status: 'error'; code: 'INVALID_PDF' | 'PDF_TOO_LARGE' | 'SAVE_FAILED' | 'IPC_FORBIDDEN'; message: string; retryable: boolean };
```

- [ ] **Step 1: Write stale import/generate RED tests**

```ts
let model = createInitialWorkflowModel(selection);
model = workflowReducer(model, {
  type: 'import/started', requestId: 'request-1', revision: 0,
});
model = workflowReducer(model, {
  type: 'selection/changed', patch: { cableType: 'MPO' },
});
model = workflowReducer(model, {
  type: 'import/succeeded', requestId: 'request-1', revision: 0,
  draft: cat5eDraft,
});
expect(model.revision).toBe(1);
expect(model.selection.cableType).toBe('MPO');
expect(model.state).toEqual({ status: 'idle' });
```

Add tests proving Site/time/label/delete each increment revision once; generate freezes an immutable snapshot; old generation cannot enter saving; saving cancel returns to ready without success; deleting the last row yields `canGenerate === false`.

- [ ] **Step 2: Run reducer and hook tests to verify RED**

Run `pnpm test:unit src/features/report-workflow`.

Expected: FAIL because workflow modules do not exist.

- [ ] **Step 3: Implement the pure reducer and exact action union**

Define `WorkflowModel` with `revision`, `selection`, `state`, `recoverableDraft`, and `announcement`. Define actions for `selection/changed`, `import/started|succeeded|failed`, `draft/changed`, `generate/started|succeeded`, `operation/failed|cancelled`, and `save/cancelled|succeeded`.

Every async completion first compares both request/job ID and revision/snapshot revision; mismatch returns the same model object.

- [ ] **Step 4: Implement abort ownership in the hook**

`useReportWorkflow()` owns one import and one generate `AbortController`. Selection change or explicit cancel calls `abort()` before dispatch. It stores generated `ArrayBuffer` in a ref, not React state, so save retry can reuse bytes without regenerating.

Use this immutable edit shape:

```ts
const nextDraft: ReportDraft = {
  ...draft,
  revision: model.revision + 1,
  records: draft.records.map(record =>
    record.id === id ? { ...record, cableLabel: value, cableNumber: value.replace(/^#/, '') } : record
  ),
};
```

- [ ] **Step 5: Verify state transitions and commit**

```bash
pnpm test:unit src/features/report-workflow
pnpm lint
pnpm ts-check
git add src/features/report-workflow
git commit -m "refactor(ui): add revisioned workflow state machine"
```

### Task 10: Replace the Monolithic Page with an Accessible 5k Virtual Editor

**Files:**
- Create: `src/features/report-editor/record-draft-store.ts`
- Create: `src/features/report-editor/record-draft-store.test.ts`
- Create: `src/features/report-editor/virtual-record-table.tsx`
- Create: `src/features/report-editor/virtual-record-table.test.tsx`
- Create: `src/features/report-editor/import-panel.tsx`
- Create: `src/features/report-editor/workflow-alert.tsx`
- Create: `src/features/report-editor/report-actions.tsx`
- Create: `src/features/report-editor/report-editor.tsx`
- Create: `src/features/report-editor/report-editor.test.tsx`
- Create: `src/features/report-workflow/browser-services.ts`
- Modify: `src/components/ui/date-time-picker.tsx`
- Replace: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: workflow hook/services and `@tanstack/react-virtual`.
- Produces: `RecordDraftStore`, `VirtualRecordTable`, `ReportEditor`; stable accessible names used by E2E.

```ts
export interface RecordDraftStore {
  get(id: string): string | undefined;
  set(id: string, value: string): void;
  subscribe(id: string, listener: () => void): () => void;
  snapshot(): ReadonlyMap<string, string>;
  reset(records: readonly CableRecord[]): void;
  clear(): void;
}

export type VirtualRecordTableProps = {
  records: readonly CableRecord[]; draftStore: RecordDraftStore;
  editing: boolean; viewportHeight?: number; rowHeight?: number; overscan?: number;
  onDelete(id: string): void;
};
```

- [ ] **Step 1: Write a 5,000-record RED component test**

```tsx
// @vitest-environment jsdom
const records = Array.from({ length: 5_000 }, (_, index) => makeRecord(index));
const { container } = render(
  <VirtualRecordTable
    records={records} draftStore={createRecordDraftStore(records)} editing
    viewportHeight={600} rowHeight={52} overscan={20} onDelete={vi.fn()}
  />,
);
expect(screen.getAllByRole('row').length).toBeLessThanOrEqual(200);
expect(screen.getByLabelText('第 1 条 Cable Label')).toHaveValue('#1');
expect(screen.getByRole('button', { name: '删除线缆 #1' })).toBeEnabled();
expect(await axe(container)).toHaveNoViolations();
```

Add editor tests for no half-built preview during import, accessible inline error/retry, file/type change cancellation, delete-last empty state, disabled generation, save success/cancel/failure, `aria-live`, keyboard Tab/Enter/Escape, and minute `00` input.

- [ ] **Step 2: Run component tests to verify RED**

Run `pnpm test:unit src/features/report-editor`.

Expected: FAIL because editor modules do not exist.

- [ ] **Step 3: Implement O(1) per-row drafts and virtualization**

`RecordDraftStore.set()` updates one Map key and notifies only listeners registered for that record ID. `snapshot()` is called only on batch save.

Configure the virtualizer:

```ts
const rowVirtualizer = useVirtualizer({
  count: records.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => rowHeight ?? 52,
  overscan: overscan ?? 20,
  getItemKey: index => records[index].id,
});
```

Render one semantic `role="table"` with `aria-rowcount`, a single header, a single scroll container, and only `rowVirtualizer.getVirtualItems()`. Each row has `aria-rowindex`, stable `record.id`, an explicit hidden label/input association, and a named delete button.

- [ ] **Step 4: Implement one responsive component tree**

At widths below 640 px, the same virtual rows switch CSS grid columns to sequence/Label/time/action. Do not render a second hidden desktop table. The page may scroll vertically, but `document.documentElement.scrollWidth` must not exceed the viewport at 320 px.

When `document.documentElement.dataset.devBrowserMode === 'true'`, render one visible `role="status"` banner with text `浏览器开发模式`; never render that banner in packaged desktop mode.

- [ ] **Step 5: Replace the template-first flow with direct import**

`browser-services.ts` calls `/api/import-excel` through `desktopFetch()`, maps rows through `mapImportedRows()`, and during this compatibility task still calls `/api/modify-pdf` for generation. It never calls `/api/load-template`.

Replace `page.tsx` with:

```tsx
'use client';
import { ReportEditor } from '@/features/report-editor/report-editor';
import { browserReportServices } from '@/features/report-workflow/browser-services';

export default function Home() {
  return <main><ReportEditor services={browserReportServices} /></main>;
}
```

- [ ] **Step 6: Verify the full component flow**

```bash
pnpm test:unit src/features/report-editor src/features/report-workflow
pnpm lint
pnpm ts-check
pnpm build
```

Expected: 5,000 records mount no more than 200 rows; axe reports no violations; the build no longer contains a `/api/load-template` fetch from renderer code.

- [ ] **Step 7: Commit the UI migration**

```bash
git add src/features/report-editor src/features/report-workflow/browser-services.ts \
  src/components/ui/date-time-picker.tsx src/app/page.tsx src/app/globals.css
git commit -m "feat(ui): virtualize accessible report preview"
```

### Task 11: Gate the Browser Workflow, Narrow Layout, and 5k Performance

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/support/workbook.ts`
- Create: `tests/e2e/support/import-result.ts`
- Create: `tests/e2e/support/performance.ts`
- Create: `tests/e2e/report-editor.spec.ts`
- Create: `tests/e2e/report-editor-performance.spec.ts`
- Create: `tests/performance/browser-baseline.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: the fixed accessible names and `/api/import-excel` contract.
- Produces: `makeCat5eWorkbookBuffer()`, `makeImportResult()`, `percentile95()`, `measureControlledInputLatency()` and release-browser E2E scripts.

- [ ] **Step 1: Configure a release server in explicit browser-dev mode**

Add scripts:

```json
{
  "start:browser": "node scripts/start.mjs --browser-dev",
  "test:e2e:browser": "playwright test --project=chromium",
  "test:perf": "playwright test tests/e2e/report-editor-performance.spec.ts --project=chromium --workers=1"
}
```

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', timeout: 120_000, retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:5000', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm build && pnpm start:browser',
    url: 'http://127.0.0.1:5000', timeout: 240_000, reuseExistingServer: false,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Step 2: Implement deterministic test fixtures and latency measurement**

`measureControlledInputLatency()` must measure inside the page, not Playwright RPC:

```ts
export async function measureControlledInputLatency(input: Locator, samples: number) {
  return input.evaluate(async (element, count) => {
    const target = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const timings: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const start = performance.now();
      setter.call(target, `#PERF-${index}`);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      timings.push(performance.now() - start);
    }
    return timings;
  }, samples);
}

export function percentile95(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}
```

- [ ] **Step 3: Write a real import workflow RED test**

Use `makeCat5eWorkbookBuffer(3)` as an in-memory `.xlsx`, then select file/type, import, edit first label, set minute `00`, delete a row, and assert generation state. Mock only `/api/modify-pdf` during this transitional task; `/api/import-excel` must parse the real workbook.

Run `pnpm exec playwright test tests/e2e/report-editor.spec.ts --project=chromium --workers=1`.

Expected before final accessibility/layout fixes: FAIL on a named control, state transition, or page overflow; after fixes it passes.

- [ ] **Step 4: Write the fixed 5k performance test**

```ts
test('5k preview stays bounded and responsive at 320px', async ({ page }) => {
  await page.route('**/api/import-excel', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: makeImportResult(5_000) }),
  }));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await importInterceptedWorkbook(page);
  expect(await page.getByRole('row').count()).toBeLessThanOrEqual(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const samples = await measureControlledInputLatency(
    page.getByLabel('第 1 条 Cable Label'), 30,
  );
  expect(percentile95(samples)).toBeLessThan(100);
  const result = await new AxeBuilder({ page }).include('main').analyze();
  expect(result.violations).toEqual([]);
});
```

The test also records mounted-row count, input P95, import duration, peak `performance.memory.usedJSHeapSize` when Chromium exposes it, and batch-save long tasks. With `PERF_UPDATE_BASELINE=1`, write the measured numeric values to `tests/performance/browser-baseline.json`; normal runs enforce the absolute limits and `current <= baseline * 1.20`.

- [ ] **Step 5: Record the release baseline once, then rerun without update mode**

```bash
PERF_UPDATE_BASELINE=1 pnpm test:perf
pnpm test:perf
pnpm test:e2e:browser -- --workers=1
```

Expected: committed JSON contains finite numeric values; the second run does not modify it; DOM rows `<= 200`, P95 `< 100 ms`, batch-save long task `< 200 ms`, axe has zero violations.

- [ ] **Step 6: Commit the browser gates**

```bash
git add playwright.config.ts tests/e2e tests/performance/browser-baseline.json package.json pnpm-lock.yaml
git commit -m "test(e2e): gate report workflow and 5k performance"
```

### Task 12: Enforce a Strict Single-Line Python/Node PDF Protocol

**Files:**
- Create: `scripts/pdf_engine/__init__.py`
- Create: `scripts/pdf_engine/protocol.py`
- Create: `scripts/pdf_engine/cli.py`
- Create: `tests/python/test_pdf_cli_protocol.py`
- Create: `src/server/pdf/protocol.ts`
- Create: `tests/unit/server/pdf/protocol.test.ts`
- Modify: `scripts/pdf_editor.py:4987-5038`
- Modify: `scripts/pdf_worker.py`

**Interfaces:**
- Consumes: current `modify_pdf_precise()` and PDF golden.
- Produces: Python `run_editor_cli()`/`emit_result()` and TypeScript `parsePdfWorkerStdout()`.

```py
class PdfWorkerSuccess(TypedDict):
    ok: Literal[True]
    output: str
    pages: int
    records: int

class PdfWorkerFailure(TypedDict):
    ok: Literal[False]
    code: str
    message: str

def run_editor_cli(
    argv: Sequence[str], editor: EditorCallable, *, stdout: TextIO, stderr: TextIO,
) -> int: ...
```

```ts
export type PdfWorkerResult =
  | { ok: true; output: string; pages: number; records: number }
  | { ok: false; code: string; message: string };
export function parsePdfWorkerStdout(stdout: string): PdfWorkerResult;
```

- [ ] **Step 1: Write RED CLI tests for protocol shape and secret-free logs**

```py
completed = subprocess.run([
    sys.executable, str(ROOT / 'scripts/pdf_editor.py'), str(TEMPLATE),
    str(output_path), str(request_path),
], check=False, capture_output=True, text=True)
assert completed.returncode == 0
assert len(completed.stdout.splitlines()) == 1
assert json.loads(completed.stdout) == {
    'ok': True, 'output': 'report.pdf', 'pages': 1, 'records': 1,
}
assert 'SECRET-SITE' not in completed.stderr
assert 'SECRET-CABLE' not in completed.stderr
assert str(tmp_path) not in completed.stderr
```

Add failures for invalid JSON, absent records, editor exception, output path with directory components, extra stdout line and invalid exit status.

- [ ] **Step 2: Write RED TypeScript parser tests**

The parser must accept exactly one newline-terminated object and reject debug prefixes, two JSON lines, extra keys, negative pages/records, path-like output (`../x.pdf`, `C:\\x.pdf`, `/tmp/x.pdf`) and a success object paired with a missing PDF later in the worker layer.

Run:

```bash
pnpm test:python tests/python/test_pdf_cli_protocol.py
pnpm test:unit tests/unit/server/pdf/protocol.test.ts
```

Expected: both suites fail against the old `{ success: true }`/free-form stdout behavior.

- [ ] **Step 3: Implement compact Python result emission and stable exits**

`emit_result()` writes exactly:

```py
stream.write(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n')
stream.flush()
```

`run_editor_cli()` validates three arguments and a JSON object with a non-empty records array, calls the injected editor, verifies the output PDF exists, obtains page count by reopening with `fitz`, and returns 0 only for `ok: true`. All failures return a safe Chinese message plus stable code and a nonzero exit.

- [ ] **Step 4: Remove sensitive current logs and delegate both entry points**

Delete the first/last record dumps and Site values from `modify_pdf_precise()`. The compatibility `pdf_editor.py::main()` and shared `pdf_worker.py` editor mode both call `run_editor_cli()`. Redirect accidental legacy stdout during the editor call to stderr, then remove/sanitize any legacy print that contains records, Site, Date & Time, or absolute paths.

- [ ] **Step 5: Implement the strict Zod parser**

`parsePdfWorkerStdout()` first requires `/^\{[^\r\n]*\}\n$/`, parses once, then uses `.strict()` Zod success/failure schemas. The output regex is `/^[^/\\]+\.pdf$/i`; pages and records are nonnegative integers.

- [ ] **Step 6: Run protocol plus all golden and commit**

```bash
pnpm test:python tests/python/test_pdf_cli_protocol.py tests/python/test_pdf_golden.py
pnpm test:unit tests/unit/server/pdf/protocol.test.ts
pnpm lint
pnpm ts-check
git add scripts/pdf_engine scripts/pdf_editor.py scripts/pdf_worker.py \
  tests/python/test_pdf_cli_protocol.py src/server/pdf/protocol.ts \
  tests/unit/server/pdf/protocol.test.ts
git commit -m "fix(pdf): enforce single-line worker protocol"
```

### Task 13: Add a Restricted Native Save-As IPC

**Files:**
- Create: `electron/save-pdf.cjs`
- Create: `tests/electron/save-pdf.test.ts`
- Modify: `electron/preload.cjs`
- Modify: `electron/main.cjs`
- Modify: `src/types/electron.d.ts`

**Interfaces:**
- Consumes: the main window identity, Electron dialog, and the exact `SavePdfRequest`/`SavePdfResult` fields from Task 9.
- Produces: `sanitizeSuggestedPdfName()`, `validatePdfBytes()`, `savePdfAtomically()`, `registerSavePdfHandler()` and `window.cableReport.savePdf()`.

```ts
export type SavePdfRequest = { suggestedName: string; bytes: ArrayBuffer };
export type SavePdfResult =
  | { status: 'saved'; fileName: string }
  | { status: 'cancelled' }
  | { status: 'error'; code: 'INVALID_PDF' | 'PDF_TOO_LARGE' | 'SAVE_FAILED' | 'IPC_FORBIDDEN'; message: string; retryable: boolean };
```

- [ ] **Step 1: Write RED cancellation, validation, naming, and atomic-write tests**

```ts
test('cancelled native save performs no write', async () => {
  const writes: string[] = [];
  const result = await savePdfAtomically({
    showSaveDialog: async () => ({ canceled: true }),
    writeAndSyncTemporary: async path => { writes.push(path); },
    rename: async () => undefined, remove: async () => undefined,
    randomUUID: () => 'fixed-id',
  }, {
    suggestedName: '../Site MPO',
    bytes: new TextEncoder().encode('%PDF-1.7\n').buffer,
  });
  expect(result).toEqual({ status: 'cancelled' });
  expect(writes).toEqual([]);
});
```

Add tests for `%PDF-`, an 8-byte injected limit, 256 MiB default constant, path stripping, forced `.pdf`, sender mismatch, write failure cleanup, and returning basename only.

- [ ] **Step 2: Run tests to verify RED**

Run `pnpm test:unit tests/electron/save-pdf.test.ts`.

Expected: FAIL because `electron/save-pdf.cjs` does not exist.

- [ ] **Step 3: Implement filename and byte validation**

Use:

```js
const MAX_PDF_BYTES = 256 * 1024 * 1024;
function sanitizeSuggestedPdfName(value) {
  const path = require('node:path');
  const base = path.win32.basename(path.posix.basename(String(value || 'report.pdf')));
  const safe = base.replace(/[^a-zA-Z0-9 ._-]+/g, '_').replace(/^\.+/, '').trim() || 'report';
  return `${safe.replace(/\.pdf$/i, '')}.pdf`;
}
function validatePdfBytes(bytes, maxBytes = MAX_PDF_BYTES) {
  const buffer = Buffer.from(bytes);
  if (buffer.byteLength > maxBytes) throw Object.assign(new Error('PDF_TOO_LARGE'), { code: 'PDF_TOO_LARGE' });
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw Object.assign(new Error('INVALID_PDF'), { code: 'INVALID_PDF' });
  return buffer;
}
```

- [ ] **Step 4: Implement same-directory atomic save**

After `showSaveDialog`, create `${finalPath}.${randomUUID()}.tmp` in the same directory, open with mode `0o600` and exclusive create, write all bytes, call file handle `sync()`, close, rename, and remove the temp path in `finally`. Cancellation returns before any write. Public results expose only `path.basename(finalPath)`.

- [ ] **Step 5: Register a sender-bound IPC and extend preload**

`registerSavePdfHandler()` rejects unless `event.sender === getMainWindow().webContents`. Extend the existing exposed object, without exposing `ipcRenderer`:

In `src/types/electron.d.ts`, import the canonical request/result types from `@/features/report-workflow/save-contract` and use them for `Window.cableReport.savePdf`; do not redeclare a divergent union.

```js
contextBridge.exposeInMainWorld('cableReport', {
  getDesktopSessionToken: () => ipcRenderer.invoke('cable-report:get-session-token'),
  savePdf: request => ipcRenderer.invoke('cable-report:save-pdf', request),
});
```

- [ ] **Step 6: Verify and commit the unused-but-ready desktop capability**

```bash
pnpm test:unit tests/electron/save-pdf.test.ts tests/electron/security.test.ts
pnpm check:fast
git add electron/save-pdf.cjs electron/preload.cjs electron/main.cjs \
  src/types/electron.d.ts tests/electron/save-pdf.test.ts
git commit -m "feat(desktop): add restricted native PDF save"
```

### Task 14: Add a Cross-Platform Cancellable Process-Tree Runner

**Files:**
- Create: `src/server/pdf/process-runner.ts`
- Create: `tests/unit/server/pdf/process-runner.test.ts`
- Create: `tests/unit/helpers/process.ts`
- Create: `tests/fixtures/process-tree-parent.mjs`
- Create: `tests/fixtures/process-tree-child.mjs`

**Interfaces:**
- Consumes: Node `spawn` and AbortSignal.
- Produces: `runProcessTree()` and `ProcessRunError`.

```ts
export type ProcessRunRequest = {
  command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv;
  signal: AbortSignal; stderrPath: string; stdoutLimitBytes?: number;
};
export type ProcessRunResult = {
  exitCode: number; stdout: string; stderrTail: string; durationMs: number;
};
export class ProcessRunError extends Error {
  constructor(
    readonly code: 'PROCESS_ABORTED' | 'PROCESS_SPAWN_FAILED' | 'PROCESS_STDOUT_LIMIT',
    message: string, readonly stdout: string, readonly stderrTail: string,
  );
}
```

- [ ] **Step 1: Create real parent/child fixtures and a RED abort test**

The parent spawns the child with `process.execPath`, writes both PIDs to the provided JSON file, and both processes stay alive with `setInterval`. The test starts the parent through `runProcessTree()`, waits for the PID file, aborts, and asserts both PIDs stop within 5 seconds.

```ts
controller.abort();
await expect(running).rejects.toMatchObject({ code: 'PROCESS_ABORTED' });
await expect(eventuallyProcessExits(pids.parentPid)).resolves.toBe(true);
await expect(eventuallyProcessExits(pids.childPid)).resolves.toBe(true);
```

- [ ] **Step 2: Add RED tests for bounded output and completion races**

Assert stdout byte 65,537 triggers `PROCESS_STDOUT_LIMIT` at default 65,536; stderr is fully streamed to `worker.log` but only its final 16 KiB is returned; spawn `ENOENT`, abort-before-spawn, abort-after-exit, double abort and zero exit each settle exactly once.

- [ ] **Step 3: Run runner tests to verify RED**

Run `pnpm test:unit tests/unit/server/pdf/process-runner.test.ts --reporter=verbose`.

Expected: FAIL because the runner does not exist.

- [ ] **Step 4: Implement process streams and tree termination**

Call `spawn(command, args, { shell: false, detached: process.platform !== 'win32', ... })`. On Unix send `SIGTERM` to `-child.pid`, then `SIGKILL` after 2,000 ms if still alive. On Windows spawn `taskkill` with `['/PID', String(pid), '/T', '/F']`, `shell: false`. Ignore `ESRCH`/already-exited races; any other termination failure becomes `PROCESS_ABORTED` with a safe message.

Accumulate stdout as Buffer chunks only through 64 KiB. Pipe stderr chunks to an opened task log and maintain a rolling 16 KiB tail. Close the log before resolving/rejecting.

- [ ] **Step 5: Verify on the current platform and commit**

```bash
pnpm test:unit tests/unit/server/pdf/process-runner.test.ts --reporter=verbose
pnpm lint
pnpm ts-check
git add src/server/pdf/process-runner.ts tests/unit/server/pdf/process-runner.test.ts \
  tests/unit/helpers/process.ts tests/fixtures/process-tree-parent.mjs tests/fixtures/process-tree-child.mjs
git commit -m "feat(pdf): add cancellable process tree runner"
```

### Task 15: Add the Single-Concurrency PDF Job and Switch the Renderer to Generate/Save

**Files:**
- Create: `src/server/pdf/errors.ts`
- Create: `src/server/pdf/worker-command.ts`
- Create: `src/server/pdf/worker.ts`
- Create: `src/server/pdf/job-controller.ts`
- Create: `src/server/pdf/index.ts`
- Create: `src/app/api/generate-report/route.ts`
- Create: `tests/unit/server/pdf/job-controller.test.ts`
- Create: `tests/unit/app/api/generate-report-route.test.ts`
- Create: `tests/components/native-save-flow.test.tsx`
- Modify: `src/lib/platform.ts`
- Modify: `src/features/report-workflow/browser-services.ts`
- Modify: `src/app/api/modify-pdf/route.ts`

**Interfaces:**
- Consumes: `ReportDraftSchema`, template/filename rules, strict protocol, process runner, native save IPC.
- Produces: `PdfWorker`, `PdfJobController`, `POST /api/generate-report`, and the final renderer generate→save flow.

```ts
export type PdfJobErrorCode =
  | 'REPORT_BUSY' | 'REPORT_CANCELLED' | 'REPORT_TIMEOUT'
  | 'PDF_PROCESS_FAILED' | 'PDF_PROTOCOL_INVALID'
  | 'PDF_OUTPUT_INVALID' | 'PDF_OUTPUT_TOO_LARGE';
export class PdfJobError extends Error {
  constructor(
    readonly code: PdfJobErrorCode, message: string, readonly retryable: boolean,
  );
}
export type PdfWorkerRequest = {
  templatePath: string; requestPath: string; outputPath: string;
  cwd: string; stderrPath: string; signal: AbortSignal;
};
export type PdfJobRequest = { jobId: string; draft: ReportDraft; signal: AbortSignal };
export type PdfJobResult = {
  bytes: Uint8Array; suggestedName: string; pages: number; records: number;
};
export interface PdfWorker {
  execute(request: PdfWorkerRequest): Promise<{ pages: number; records: number }>;
}
export type PdfJobControllerOptions = {
  worker: PdfWorker;
  templatePathFor: (cableType: CableType) => string;
  suggestedNameFor: (draft: ReportDraft, now: Date) => string;
  tempRoot?: string; timeoutMs?: number; maxPdfBytes?: number; now?: () => Date;
};
export class PdfJobController {
  constructor(options: PdfJobControllerOptions);
  run(request: PdfJobRequest): Promise<PdfJobResult>;
  isBusy(): boolean;
}
```

- [ ] **Step 1: Write RED controller tests for busy, cleanup, timeout, abort, and output validation**

Use an injected worker and temp root. The primary test starts one gated job, verifies the second rejects with `REPORT_BUSY`, releases the first, and expects the temp root to be empty:

```ts
await expect(controller.run({
  jobId: 'job-2', draft, signal: new AbortController().signal,
})).rejects.toMatchObject({ code: 'REPORT_BUSY', retryable: true });
release();
await expect(first).resolves.toMatchObject({
  suggestedName: 'SITE_Cat5e_20260710_093000.pdf', records: 1,
});
expect(await readdir(tempRoot)).toEqual([]);
```

Add tests for 600,000 ms default, caller abort, timer timeout, worker nonzero exit, invalid protocol, absent output, wrong output basename, record-count mismatch, missing `%PDF-`, 268,435,457-byte injected fixture, and cleanup after every failure.

- [ ] **Step 2: Write RED route and renderer-save tests**

Route tests assert auth, body over 25 MiB, malformed JSON, invalid Site/date/type, zero/10,001 records, busy=409, cancel=499, timeout=408, renderer failure=500, safe headers and no absolute path.

Component tests inject services and assert:

```ts
expect(savePdf).toHaveBeenCalledWith({
  bytes: generated.bytes,
  suggestedName: 'SITE_MPO_20260710_090000.pdf',
});
expect(screen.getByRole('status')).toHaveTextContent('SITE_MPO_20260710_090000.pdf');
```

Cancellation returns ready with no success; save error remains retryable and does not call `generateReport()` again.

- [ ] **Step 3: Run focused suites to verify RED**

```bash
pnpm test:unit tests/unit/server/pdf/job-controller.test.ts \
  tests/unit/app/api/generate-report-route.test.ts tests/components/native-save-flow.test.tsx
```

Expected: FAIL because controller/route and renderer save integration do not exist.

- [ ] **Step 4: Resolve the packaged or development worker without a shell**

`worker-command.ts` returns:

```ts
export type WorkerCommand = {
  command: string; argsPrefix: readonly string[]; env: NodeJS.ProcessEnv;
};
export function resolvePdfEditorCommand(): WorkerCommand;
```

Use the shared packaged `pdf_worker[.exe]` with prefix `['pdf_editor']` when present; otherwise use the discovered Python command with prefix `[resolveAppPath('scripts', 'pdf_editor.py')]`. Never produce a command string and never set `shell: true`. Remove `buildPythonCommand()` after all callers migrate.

- [ ] **Step 5: Implement the worker and controller ownership boundary**

For each run, the controller must:

```ts
this.busy = true;
let directory: string | undefined;
try {
  directory = await mkdtemp(join(this.tempRoot, 'cable-report-'));
  await writeFile(join(directory, 'request.json'), JSON.stringify(toWorkerPayload(draft)), 'utf8');
  const result = await this.worker.execute({
    templatePath: this.templatePathFor(draft.cableType),
    requestPath: join(directory, 'request.json'),
    outputPath: join(directory, 'report.pdf'),
    cwd: directory,
    stderrPath: join(directory, 'worker.log'),
    signal: combinedSignal,
  });
  // validate count, file header, size, and read bytes
} finally {
  clearTimeout(timeoutId);
  if (directory) await rm(directory, { recursive: true, force: true });
  this.busy = false;
}
```

The worker combines `runProcessTree()` and `parsePdfWorkerStdout()`, requires exit code consistent with `ok`, requires protocol output `report.pdf`, and returns only pages/records. Logs contain job ID, cable type, count, phase, duration, exit code and error code—never Site, labels, time or paths.

- [ ] **Step 6: Implement the bounded authenticated route**

Read `request.text()` only after declared length check; reject UTF-8 bytes over 25 MiB; parse JSON; apply `ReportDraftSchema` and require 1–10,000 records. Pass `request.signal` directly to the controller.

Successful response:

```ts
return new Response(result.bytes, {
  status: 200,
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${result.suggestedName}"`,
    'Cache-Control': 'no-store',
    'X-Report-Pages': String(result.pages),
    'X-Report-Records': String(result.records),
  },
});
```

Never include `X-Saved-Path`, Python stderr, traceback, temp path or host path.

- [ ] **Step 7: Switch renderer services to the new route and native save**

`generateReport()` posts the frozen draft through `desktopFetch('/api/generate-report')`, parses the safe filename, and returns `ArrayBuffer`. `savePdf()` calls `window.cableReport.savePdf()` when available. It may create an `<a download>` only when `document.documentElement.dataset.devBrowserMode === 'true'`; otherwise absence of preload is a non-retryable save error.

Delete the Downloads write and `X-Saved-Path` from the compatibility `modify-pdf` route immediately, because the current renderer no longer relies on either.

- [ ] **Step 8: Verify job, save, golden, and no-download behavior**

```bash
pnpm test:unit tests/unit/server/pdf tests/unit/app/api/generate-report-route.test.ts \
  tests/components/native-save-flow.test.tsx
pnpm test:python tests/python/test_pdf_cli_protocol.py tests/python/test_pdf_golden.py
rg -n "X-Saved-Path|homedir\(\).*Downloads|PDF saved to Downloads" src electron
pnpm check:fast
pnpm build
```

Expected: all tests pass; `rg` has no production match; build succeeds.

- [ ] **Step 9: Commit the complete replacement path**

```bash
git add src/server/pdf src/app/api/generate-report src/lib/platform.ts \
  src/features/report-workflow/browser-services.ts src/app/api/modify-pdf/route.ts \
  tests/unit/server/pdf tests/unit/app/api/generate-report-route.test.ts \
  tests/components/native-save-flow.test.tsx
git commit -m "feat(pdf): add bounded report job and native save flow"
```

### Task 16: Extract Shared PDF Resources, CID, Layout, and Summary Modules

**Files:**
- Create: `scripts/pdf_engine/types.py`
- Create: `scripts/pdf_engine/resources.py`
- Create: `scripts/pdf_engine/cid.py`
- Create: `scripts/pdf_engine/layout.py`
- Create: `scripts/pdf_engine/summary.py`
- Create: `tests/python/test_pdf_engine_boundaries.py`
- Modify: `scripts/pdf_editor.py`

**Interfaces:**
- Consumes: the locked legacy implementation and all six golden cases.
- Produces: shared one-directional modules consumed by template editors.

```py
TemplateKind = Literal['cat5e', 'mpo', 'lc']
CableRecordPayload = Mapping[str, object]

@dataclass(frozen=True)
class PdfEditResult:
    output: Path
    pages: int
    records: int
```

- [ ] **Step 1: Write RED import-boundary and public-function tests**

`test_pdf_engine_boundaries.py` imports each new module and asserts these public functions exist with stable signatures:

```py
EXPECTED = {
    'pdf_engine.resources': ['resource_path', 'first_existing_path'],
    'pdf_engine.cid': [
        'site_text_to_cid', 'text_to_cid_hex', 'time_to_cid_hex',
        'date_to_cid_hex', 'text_to_limit_cid', 'cable_label_to_cid',
    ],
    'pdf_engine.layout': [
        'save_pdf_compact', 'insert_text_with_font', 'get_field_positions',
        'clear_row_images',
    ],
    'pdf_engine.summary': [
        'draw_lc_summary_boxes', 'draw_non_lc_summary_boxes', 'draw_final_footer',
    ],
}
```

Parse module AST imports and assert `resources`, `cid`, `layout`, and `summary` do not import `pdf_engine.editors`, `pdf_engine.dispatch`, `pdf_editor`, Next code, or Electron code.

- [ ] **Step 2: Run boundaries to verify RED**

Run `pnpm test:python tests/python/test_pdf_engine_boundaries.py`.

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Move resource and font resolution first**

Move `_resource_path`, `_first_existing_path`, Windows font resolution and font constants into `resources.py`. Rename only at the public boundary; temporarily re-export aliases from `pdf_editor.py`:

```py
from pdf_engine.resources import (
    first_existing_path as _first_existing_path,
    resource_path as _resource_path,
)
```

Run all PDF golden immediately; expected unchanged.

- [ ] **Step 4: Move CID and date stream functions as one cohesive unit**

Move current functions covering Site CID, generic/LC text CID, time/date CID, CMap repairs, cable-label CID and Limit CID into `cid.py`. Dependencies on resource/font helpers come only from `resources.py`. Preserve lookup tables byte-for-byte and re-export compatibility names from `pdf_editor.py`.

Run:

```bash
pnpm test:python tests/python/test_pdf_golden.py tests/python/test_pdf_cli_protocol.py
```

Expected: all six golden plus protocol pass without baseline changes.

- [ ] **Step 5: Move page layout and save helpers**

Move compact save, font lookup, clear rectangles, text insertion, field positions, row image clearing, span iteration and geometry helpers into `layout.py`. The module may import `resources` and `cid`; it cannot import editor modules.

- [ ] **Step 6: Move summary/footer rendering**

Move footer logo/Printed rendering, PASS/FAIL totals, LC/non-LC summary boxes, data-outline sizing and summary-page finish helpers into `summary.py`. The module may import `resources`, `cid`, and `layout` only.

- [ ] **Step 7: Run boundaries and all golden, then commit**

```bash
pnpm test:python tests/python/test_pdf_engine_boundaries.py \
  tests/python/test_pdf_cli_protocol.py tests/python/test_pdf_golden.py
git diff --exit-code -- tests/python/golden
git add scripts/pdf_engine scripts/pdf_editor.py tests/python/test_pdf_engine_boundaries.py
git commit -m "refactor(pdf): extract shared PDF engine layers"
```

### Task 17: Extract the LC Template Editor Behind a Stable Entry Point

**Files:**
- Create: `scripts/pdf_engine/editors/__init__.py`
- Create: `scripts/pdf_engine/editors/lc.py`
- Create: `tests/python/test_lc_editor.py`
- Modify: `scripts/pdf_editor.py`
- Modify: `tests/python/test_pdf_engine_boundaries.py`

**Interfaces:**
- Consumes: shared engine modules from Task 16.
- Produces:

```py
def edit_lc_pdf(
    input_path: Path, output_path: Path,
    records: Sequence[CableRecordPayload], site: str | None,
) -> PdfEditResult: ...
```

- [ ] **Step 1: Write a RED stable-entry test**

```py
module = importlib.import_module('pdf_engine.editors.lc')
function = module.edit_lc_pdf
assert tuple(inspect.signature(function).parameters) == (
    'input_path', 'output_path', 'records', 'site',
)
```

Also assert `lc.py` does not import Cat5e/MPO/non-LC modules and returns `PdfEditResult` for the LC minimal fixture.

- [ ] **Step 2: Run LC-specific tests to verify RED**

Run `pnpm test:python tests/python/test_lc_editor.py -k lc`.

Expected: FAIL because the editor module does not exist.

- [ ] **Step 3: Move LC-only functions without copying them**

Move `_get_lc_rows`, LC date/time rewrites, LC Site/page-number updates, LC outline/icon drawing, `_fill_lc_data_page`, `_fill_lc_summary_page`, and `edit_lc_pdf` from `pdf_editor.py` into `editors/lc.py`. Convert string paths at entry with `Path`; return `PdfEditResult(output_path, page_count, len(records))`.

Keep a one-line compatibility import in the old module while other templates remain there:

```py
from pdf_engine.editors.lc import edit_lc_pdf
```

- [ ] **Step 4: Verify only LC and then the entire matrix**

```bash
pnpm test:python tests/python/test_lc_editor.py \
  tests/python/test_pdf_golden.py -k lc
pnpm test:python tests/python/test_pdf_golden.py tests/python/test_pdf_cli_protocol.py
git diff --exit-code -- tests/python/golden
```

Expected: LC goldens pass first; all six pass afterward.

- [ ] **Step 5: Commit the isolated LC migration**

```bash
git add scripts/pdf_engine/editors scripts/pdf_editor.py \
  tests/python/test_lc_editor.py tests/python/test_pdf_engine_boundaries.py
git commit -m "refactor(pdf): extract LC template editor"
```

### Task 18: Extract Cat5e/MPO Editors and Make Dispatch the Only Template Switch

**Files:**
- Create: `scripts/pdf_engine/editors/non_lc.py`
- Create: `scripts/pdf_engine/editors/cat5e.py`
- Create: `scripts/pdf_engine/editors/mpo.py`
- Create: `scripts/pdf_engine/dispatch.py`
- Create: `tests/python/test_non_lc_editors.py`
- Modify: `scripts/pdf_engine/cli.py`
- Modify: `scripts/pdf_editor.py`
- Modify: `tests/python/test_pdf_golden.py`
- Modify: `tests/python/test_pdf_engine_boundaries.py`

**Interfaces:**
- Consumes: shared engine and LC editor.
- Produces: `edit_cat5e_pdf()`, `edit_mpo_pdf()`, `detect_template_kind()`, `edit_report()`.

```py
def detect_template_kind(document: fitz.Document) -> TemplateKind: ...
def edit_cat5e_pdf(input_path: Path, output_path: Path,
                   records: Sequence[CableRecordPayload], site: str | None) -> PdfEditResult: ...
def edit_mpo_pdf(input_path: Path, output_path: Path,
                 records: Sequence[CableRecordPayload], site: str | None) -> PdfEditResult: ...
def edit_report(input_path: Path, output_path: Path,
                records: Sequence[CableRecordPayload], site: str | None) -> PdfEditResult: ...
```

- [ ] **Step 1: Write RED public-entry and dependency-direction tests**

Assert Cat5e and MPO modules expose the four-parameter signatures, do not import each other, and both may import only `non_lc` plus shared modules. Assert `detect_template_kind()` returns exactly `cat5e`, `mpo`, or `lc` for the three committed templates.

- [ ] **Step 2: Run tests to verify RED**

Run `pnpm test:python tests/python/test_non_lc_editors.py`.

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Move shared non-LC mechanics once**

Move `fill_page`, non-LC datetime/label rewrites, non-LC summary totals/finish and the body of `edit_non_lc_pdf` into `editors/non_lc.py`. Expose one internal helper:

```py
def edit_non_lc_pdf(
    input_path: Path, output_path: Path, records: Sequence[CableRecordPayload],
    site: str | None, template_kind: Literal['cat5e', 'mpo'],
) -> PdfEditResult: ...
```

- [ ] **Step 4: Add thin explicit Cat5e/MPO entries and verify each golden pair**

`cat5e.py` calls `edit_non_lc_pdf(..., template_kind='cat5e')`; `mpo.py` calls it with `mpo`. Run Cat5e minimal/cross-page, then MPO minimal/cross-page, without touching golden files.

- [ ] **Step 5: Make dispatch the only detector/switch**

Move the current template detector into `dispatch.py`. `edit_report()` opens the template once to detect, closes the detection document, then calls exactly one editor and returns. Delete duplicate/secondary switch bodies from the compatibility module, but retain `modify_pdf_precise()` as a temporary adapter for one more task.

Update CLI and golden tests to call `edit_report()` rather than internal legacy functions.

- [ ] **Step 6: Verify all architecture, protocol, and visual regression gates**

```bash
pnpm test:python tests/python/test_non_lc_editors.py \
  tests/python/test_lc_editor.py tests/python/test_pdf_engine_boundaries.py \
  tests/python/test_pdf_cli_protocol.py tests/python/test_pdf_golden.py
git diff --exit-code -- tests/python/golden
```

Expected: all pass; editor modules do not import each other; dispatch is the only template switch.

- [ ] **Step 7: Commit the non-LC and dispatch migration**

```bash
git add scripts/pdf_engine scripts/pdf_editor.py tests/python
git commit -m "refactor(pdf): split template editors behind dispatch"
```

### Task 19: Remove Legacy APIs, Processor Code, Unreachable Python, and Unused UI

**Entry gate:** Tasks 8, 10, 12, 13, 15, 17, and 18 are green; the renderer uses only `/api/import-excel` and `/api/generate-report`; native save component tests pass; all six PDF golden pass.

**Files:**
- Create: `tests/architecture/legacy-surface.test.ts`
- Create: `tests/python/test_pdf_editor_facade.py`
- Create: `scripts/verify-runtime-surface.mjs`
- Replace: `scripts/pdf_editor.py`
- Modify: `scripts/pdf_worker.py`
- Modify: `scripts/build-python-workers.mjs`
- Modify: `scripts/verify-desktop-package.mjs`
- Modify: `src/lib/platform.ts`
- Modify: `scripts/prepare.sh`
- Modify: `requirements.txt`
- Modify: `requirements-dev.txt`
- Regenerate: `requirements.lock`
- Regenerate: `requirements-dev.lock`
- Modify: `package.json`
- Regenerate: `pnpm-lock.yaml`
- Delete: `src/app/api/load-template/route.ts`
- Delete: `src/app/api/generate-pdf/route.ts`
- Delete: `src/app/api/upload-pdf/route.ts`
- Delete: `src/app/api/test-large-response/route.ts`
- Delete: `src/app/api/upload-excel/route.ts`
- Delete: `src/app/api/modify-pdf/route.ts`
- Delete: `scripts/pdf_processor.py`
- Delete: `scripts/test_limit_detection.py`
- Delete: `scripts/test_template_detection.py`
- Delete the unused UI modules enumerated in Step 5.

**Interfaces:**
- Consumes: final import/generate APIs and `pdf_engine.cli`.
- Produces: exactly two production API routes, one four-line Python compatibility entry, one worker mode, and a minimal direct dependency surface.

- [ ] **Step 1: Write RED architecture tests for every legacy production surface**

```ts
const removedRoutes = [
  'src/app/api/load-template/route.ts',
  'src/app/api/generate-pdf/route.ts',
  'src/app/api/upload-pdf/route.ts',
  'src/app/api/test-large-response/route.ts',
  'src/app/api/upload-excel/route.ts',
  'src/app/api/modify-pdf/route.ts',
] as const;

it.each(removedRoutes)('does not ship legacy route %s', relativePath => {
  expect(existsSync(join(process.cwd(), relativePath))).toBe(false);
});
```

Also enumerate `src/app/api/**/route.ts` and assert the sorted list is exactly:

```ts
[
  'src/app/api/generate-report/route.ts',
  'src/app/api/import-excel/route.ts',
]
```

- [ ] **Step 2: Write the RED four-line facade test**

```py
source = (ROOT / 'scripts/pdf_editor.py').read_text(encoding='utf-8')
tree = ast.parse(source)
locally_defined = {
    node.name for node in tree.body
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
}
assert locally_defined == set()
assert len(source.splitlines()) <= 8
```

Run:

```bash
pnpm test:unit tests/architecture/legacy-surface.test.ts
pnpm test:python tests/python/test_pdf_editor_facade.py
```

Expected: both fail against the current routes and 5,038-line editor.

- [ ] **Step 3: Delete the six old routes and processor mode**

Delete all six files listed above. Delete `pdf_processor.py` and its worker branch. Update `build-python-workers.mjs` hidden imports to:

```js
hiddenImports: [
  'pdf_engine.cli', 'pdf_engine.dispatch',
  'pdf_engine.editors.cat5e', 'pdf_engine.editors.mpo', 'pdf_engine.editors.lc',
]
```

`verify-desktop-package.mjs` now accepts only the shared `pdf_worker[.exe]`; it no longer checks separate editor/processor binaries.

- [ ] **Step 4: Replace the old editor and remove obsolete runtime helpers/dependencies**

The complete final `scripts/pdf_editor.py` is:

```py
#!/usr/bin/env python3
from pdf_engine.cli import main

if __name__ == '__main__':
    raise SystemExit(main())
```

Remove `runPythonScript()`, `buildPythonCommand()`, `getProjectTempDir()` and processor-specific path branches from `src/lib/platform.ts`; `worker-command.ts` is now the only process resolver.

Remove `pdfplumber` and `reportlab` from `requirements.txt`, and remove them plus `openpyxl` from `prepare.sh`. Final runtime input:

```text
PyMuPDF==1.26.5
pyinstaller==6.21.0
```

Regenerate both hash locks with pip-tools 7.5.3 and rerun the runtime dependency test with only `fitz`, PyInstaller, pytest and Pillow expectations.

- [ ] **Step 5: Delete the exact unused shadcn modules**

Keep only `alert.tsx`, `button.tsx`, `calendar.tsx`, `card.tsx`, `date-time-picker.tsx`, `input.tsx`, `label.tsx`, `popover.tsx`, and `select.tsx` under `src/components/ui`.

Delete:

```text
accordion.tsx alert-dialog.tsx aspect-ratio.tsx avatar.tsx badge.tsx
breadcrumb.tsx button-group.tsx carousel.tsx chart.tsx checkbox.tsx
collapsible.tsx command.tsx context-menu.tsx dialog.tsx drawer.tsx
dropdown-menu.tsx empty.tsx field.tsx form.tsx hover-card.tsx
input-group.tsx input-otp.tsx item.tsx kbd.tsx menubar.tsx
navigation-menu.tsx pagination.tsx progress.tsx radio-group.tsx resizable.tsx
scroll-area.tsx separator.tsx sheet.tsx sidebar.tsx skeleton.tsx
slider.tsx sonner.tsx spinner.tsx switch.tsx table.tsx tabs.tsx
textarea.tsx toggle-group.tsx toggle.tsx tooltip.tsx
```

Before deleting, run `rg -n "components/ui/(<name-without-extension>)" src --glob '!src/components/ui/**'` for each name; expected no matches.

- [ ] **Step 6: Remove the now-unused direct JavaScript dependencies**

Remove every `@radix-ui/react-*` direct dependency except `react-label`, `react-popover`, `react-select`, and `react-slot`. Also remove:

```text
@floating-ui/utils
cmdk
embla-carousel-react
input-otp
next-themes
react-hook-form
react-resizable-panels
recharts
sonner
vaul
shadcn
```

`verify-runtime-surface.mjs` scans source imports and fails for an undeclared package or a declared production dependency with no import, except `next`, `react`, `react-dom`, `xlsx`, and `zod`, whose framework/runtime use is indirect.

Run `pnpm install --lockfile-only` and then `pnpm install --frozen-lockfile`.

- [ ] **Step 7: Prove the deletion did not change behavior**

```bash
pnpm test:unit tests/architecture/legacy-surface.test.ts
pnpm test:python tests/python/test_pdf_editor_facade.py \
  tests/python/test_pdf_cli_protocol.py tests/python/test_pdf_golden.py
node scripts/verify-runtime-surface.mjs
rg -n "load-template|generate-pdf|upload-pdf|test-large-response|upload-excel|modify-pdf|pdf_processor|pdfplumber|reportlab" src scripts requirements.txt
pnpm check:fast
pnpm build
pnpm desktop:build:py
```

Expected: `rg` has no production match (test files may contain names only in explicit deletion arrays); all golden and build gates pass.

- [ ] **Step 8: Commit the deletion as a single reviewable surface change**

```bash
git add -A src/app/api scripts src/lib/platform.ts src/components/ui \
  tests/architecture tests/python/test_pdf_editor_facade.py \
  requirements.txt requirements-dev.txt requirements.lock requirements-dev.lock \
  package.json pnpm-lock.yaml
git commit -m "chore: remove legacy report surfaces and unused runtime"
```

Before committing, run `git status --short` and explicitly verify none of the protected logo paths is staged.

### Task 20: Enable Minimal ASAR Packaging, Package Budgets, and PR CI

**Files:**
- Modify: `package.json`
- Modify: `electron/main.cjs`
- Modify: `.dockerignore`
- Modify: `scripts/desktop-dist.mjs`
- Modify: `scripts/verify-desktop-package.mjs`
- Create: `scripts/check-package-size.mjs`
- Create: `scripts/verify-build-inputs.mjs`
- Create: `tests/build/package-policy.test.ts`
- Delete: `scripts/electron-after-pack.cjs`
- Create: `.github/workflows/quality.yml`
- Modify: `.github/workflows/build-windows-exe.yml`

**Interfaces:**
- Consumes: standalone Next build, one `pdf_worker`, three templates.
- Produces: ASAR desktop packages with a hard 643,301,376-byte macOS budget and reproducible PR gates.

- [ ] **Step 1: Write a RED packaging-policy test**

```ts
expect(packageJson.build.asar).toBe(true);
expect(packageJson.build.files).toEqual([
  'electron/**/*', 'next-build/standalone/**/*', 'package.json', 'next.config.mjs',
]);
expect(packageJson.build.extraResources).toEqual(expect.arrayContaining([
  expect.objectContaining({ from: 'worker-bin', to: 'bin' }),
  expect.objectContaining({ from: 'assets', to: 'assets' }),
]));
expect(MAX_APP_BYTES).toBe(643_301_376);
```

Run `pnpm test:unit tests/build/package-policy.test.ts`.

Expected: FAIL because `asar` is currently false and size policy does not exist.

- [ ] **Step 2: Set the exact Electron Builder file graph**

Use:

```json
{
  "build": {
    "asar": true,
    "files": [
      "electron/**/*",
      "next-build/standalone/**/*",
      "package.json",
      "next.config.mjs"
    ],
    "extraResources": [
      {
        "from": "assets", "to": "assets",
        "filter": [
          "M138-DE46-OOB-Cat5e.pdf",
          "M138-DE46-D-P-cross-LC.pdf",
          "M138-DE46-P-A-MPO.pdf"
        ]
      },
      { "from": "worker-bin", "to": "bin", "filter": ["pdf_worker*"] }
    ]
  }
}
```

Remove `afterPack` and delete `electron-after-pack.cjs`. Do not add `asarUnpack`; worker/templates are external resources.

- [ ] **Step 3: Make runtime roots ASAR-aware without importing Electron in Next**

In main, set `COZE_WORKSPACE_PATH = app.getAppPath()` and `CABLE_RESOURCES_PATH = process.resourcesPath` before starting Next. `src/lib/platform.ts` resolves application JS from the first and templates/worker only from the second. It never assumes a writable `resources/app` directory.

- [ ] **Step 4: Verify ASAR contents and external resources**

Add `@electron/asar: 3.4.1` as an exact dev dependency so the verifier remains compatible with the supported Node 20+ build floor. `verify-desktop-package.mjs` uses `listPackage()` to assert `resources/app.asar` contains `electron/main.cjs`, `electron/preload.cjs`, standalone `server.js` and static output, but not cache, diagnostics, tests, `.pyinstaller`, debug PDFs or root `node_modules`. It separately asserts only one worker in `resources/bin` and exactly three templates in `resources/assets`.

- [ ] **Step 5: Add the hard package-size check**

Create `scripts/check-package-size.mjs` with exported constants:

```js
export const BASELINE_APP_BYTES = 857_735_168;
export const MAX_APP_BYTES = 643_301_376;
```

For macOS, recursively total the unpacked `.app`; for Windows, record unpacked bytes but apply only a documented informational budget until a Windows baseline is committed. Exit nonzero when macOS exceeds `MAX_APP_BYTES`, and print the ten largest paths for diagnosis.

- [ ] **Step 6: Exclude all local platform outputs from Docker input**

Append to `.dockerignore`:

```text
next-build
worker-bin
release
.pyinstaller
.superpowers
docs/superpowers/plans
tests/python/golden
```

`verify-build-inputs.mjs` fails if a Docker context manifest or packaged file list includes a Mach-O worker on Linux, `.app`, `.exe`, cache, release output or a protected untracked logo.

- [ ] **Step 7: Add the fixed PR workflow and harden the Windows build**

`.github/workflows/quality.yml` runs in this exact order:

```yaml
- run: corepack prepare pnpm@9.15.9 --activate
- run: pnpm install --frozen-lockfile
- run: python -m pip install --require-hashes -r requirements-dev.lock
- run: pnpm lint
- run: pnpm ts-check
- run: pnpm test:unit
- run: python -m pytest -q
- run: pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org
- run: pnpm build
- run: node scripts/verify-build-inputs.mjs
```

The existing Windows workflow uses `permissions: contents: read`, the same frozen installs, and only `pnpm desktop:dist:win` as its build entry.

- [ ] **Step 8: Build and measure the macOS package**

```bash
pnpm test:unit tests/build/package-policy.test.ts
pnpm build
pnpm desktop:build:py
pnpm desktop:dist:mac
node scripts/verify-desktop-package.mjs mac
node scripts/check-package-size.mjs mac
```

Expected: structure passes; unpacked `.app` is `<= 643301376` bytes; templates/fonts/worker remain present.

- [ ] **Step 9: Commit packaging and CI policy**

```bash
git add package.json pnpm-lock.yaml electron/main.cjs .dockerignore \
  scripts/desktop-dist.mjs scripts/verify-desktop-package.mjs \
  scripts/check-package-size.mjs scripts/verify-build-inputs.mjs \
  tests/build/package-policy.test.ts .github/workflows/quality.yml \
  .github/workflows/build-windows-exe.yml
git rm scripts/electron-after-pack.cjs
git commit -m "build: enforce minimal ASAR desktop packages"
```

### Task 21: Gate Packaged macOS/Windows E2E and Complete the Release Handoff

**Files:**
- Create: `playwright.desktop.config.ts`
- Create: `tests/e2e/desktop/fixtures.ts`
- Create: `tests/e2e/desktop/launch-packaged.ts`
- Create: `tests/e2e/desktop/report-flow.spec.ts`
- Create: `tests/e2e/desktop/security-cleanup.spec.ts`
- Create: `.github/workflows/desktop-e2e.yml`
- Create: `scripts/verify-acceptance.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `PACKAGING.md`
- Modify: `WINDOWS.md`

**Interfaces:**
- Consumes: packaged applications, fixed Excel fixtures, native dialog and all stable UI roles.
- Produces: `launchPackaged()`, macOS/Windows desktop test scripts, release matrix, acceptance report.

```ts
export type PackagedDesktop = {
  app: ElectronApplication; window: Page;
  executablePath: string; userDataDir: string;
};
export function launchPackaged(platform: NodeJS.Platform): Promise<PackagedDesktop>;
```

- [ ] **Step 1: Add platform-specific packaged launch resolution**

On macOS resolve `release/mac*/Cable Report Generator.app/Contents/MacOS/Cable Report Generator`; on Windows resolve `release/win-unpacked/Cable Report Generator.exe`. Launch with a fresh temp `--user-data-dir`; capture main-process stderr and fail on unhandled rejection, uncaught exception or Next startup error.

Add scripts:

```json
{
  "test:e2e:desktop": "playwright test -c playwright.desktop.config.ts",
  "test:e2e:mac": "playwright test -c playwright.desktop.config.ts --project=desktop-mac",
  "test:e2e:win": "playwright test -c playwright.desktop.config.ts --project=desktop-win",
  "verify:acceptance": "node scripts/verify-acceptance.mjs"
}
```

- [ ] **Step 2: Write a packaged generate/save RED test for all three templates**

Parameterize Cat5e, LC and MPO fixtures. For each, override `dialog.showSaveDialog` in the Electron main test context to return `testInfo.outputPath(...)`, then drive the real UI:

```ts
await window.getByLabel('项目号 (Site)').fill('DE46');
await selectCableType(window, fixture.cableType);
await window.getByLabel('Excel 布线表').setInputFiles(fixture.path);
await window.getByRole('button', { name: '加载并导入' }).click();
await window.getByLabel('第 1 条 Cable Label').fill(fixture.editedLabel);
await window.getByRole('button', { name: '生成测试报告' }).click();
await expect.poll(async () => (await readFile(savePath)).subarray(0, 5).toString())
  .toBe('%PDF-');
```

Open the saved PDF with PyMuPDF in a helper and assert page count, edited label semantics and record count.

- [ ] **Step 3: Add native cancellation and no-duplicate-save tests**

Mock dialog cancellation and assert the workflow returns to ready with no success live region. For a successful save, snapshot `~/Downloads` before/after and assert no new report file appears there; only the chosen output path exists.

- [ ] **Step 4: Add security, timeout, and cleanup tests**

Prove:

```ts
expect(await window.evaluate(() =>
  fetch('/api/import-excel', { method: 'POST' }).then(response => response.status)
)).toBe(401);
```

Spy `shell.openExternal`; internal loopback stays internal, the exact GitHub Releases URL opens, and `file:`, `javascript:`, `data:`, HTTP GitHub, host lookalike and other repository URLs never open. Inject a hanging test worker, cancel/timeout it, close the app, then assert no `cable-report-*` task directory and no descendant `pdf_worker` PID remains.

Inspect main-process modules and assert no `autoUpdater.downloadUpdate()`, install, execute or unsigned asset launch exists; update UI may only open the allowlisted Releases HTTPS page.

- [ ] **Step 5: Run the complete local macOS release story**

```bash
pnpm desktop:dist:mac
pnpm test:e2e:mac
pnpm verify:acceptance -- --platform mac
```

Expected: Cat5e/LC/MPO import→edit→generate→save passes; cancel/security/cleanup passes; package structure and size pass.

- [ ] **Step 6: Add a frozen macOS/Windows CI matrix**

`.github/workflows/desktop-e2e.yml` uses `matrix.os: [macos-latest, windows-latest]`. Each job performs frozen Node and hash-locked Python installs, runs unit/pytest, builds its local worker and desktop package, runs structure verification, packaged E2E and acceptance verification, then uploads DMG/ZIP or NSIS EXE only after all gates pass.

Windows command uses `pnpm desktop:dist:win` and `pnpm test:e2e:win`; macOS uses the commands from Step 5. Do not cross-build macOS on Windows or Windows release acceptance on macOS.

- [ ] **Step 7: Document exact development, verification, and release commands**

Update README/PACKAGING/WINDOWS with:

```text
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
python -m pip install --require-hashes -r requirements-dev.lock
pnpm check:fast
pnpm test:python
pnpm test:e2e:browser
pnpm desktop:dist:mac / pnpm desktop:dist:win
pnpm test:e2e:mac / pnpm test:e2e:win
pnpm verify:acceptance
```

Document 25 MiB Excel, 10,000 record, 5,000 QTY, 10-minute PDF, 256 MiB PDF and native Save As limits, plus the explicit `--browser-dev` fallback restriction.

- [ ] **Step 8: Run the final acceptance aggregator**

`verify-acceptance.mjs` checks machine-readable test reports and artifacts for all 12 design completion criteria: formula tests, six golden, 5k P95/DOM, cleanup, native save, safe API/logs, all quality gates, both platform jobs, legacy absence, dependency audit, macOS size, and protected logo status.

Run:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm ts-check
pnpm test:unit
pnpm test:python
pnpm test:e2e:browser -- --workers=1
pnpm build
node scripts/verify-desktop-package.mjs mac
node scripts/check-package-size.mjs mac
pnpm verify:acceptance -- --platform mac --require-ci-platform windows
git status --short
```

Expected: local gates and macOS acceptance pass; the aggregator verifies the referenced Windows CI run is green; `git status` shows the three protected logos unmodified/untracked and no unexpected source changes.

- [ ] **Step 9: Commit the release gate and documentation**

```bash
git add playwright.desktop.config.ts tests/e2e/desktop \
  .github/workflows/desktop-e2e.yml scripts/verify-acceptance.mjs \
  package.json pnpm-lock.yaml README.md PACKAGING.md WINDOWS.md
git commit -m "test: gate macOS and Windows desktop release flows"
```

After this commit, use `superpowers:verification-before-completion`, then `superpowers:requesting-code-review`, and finally `superpowers:finishing-a-development-branch`. Do not claim completion until the Windows CI artifact and packaged E2E are green.
