# Windows 使用说明

Windows x64 是当前唯一正式发布的桌面平台。GitHub Release 只应包含 `.exe`、
`.exe.blockmap` 和 `latest.yml`，以支持应用内检测、下载并安装后续版本。

## 环境要求

- Windows 10/11
- Node.js 24.14.0
- Python 3.12.13

## 首次安装

在项目目录打开 PowerShell，执行：

```powershell
corepack pnpm@9.15.9 install --frozen-lockfile
python -m pip install --require-hashes --only-binary=:all: -r requirements-dev.lock
corepack pnpm@9.15.9 exec playwright install chromium
```

完整发布验证要求 `python` 命令本身解析到 Python 3.12.13。如果电脑上同时安装多个
Python，请先激活 3.12 虚拟环境或调整 `PATH`，再确认：

```powershell
python --version
python -m pip install --require-hashes --only-binary=:all: -r requirements-dev.lock
```

## 开发启动

```powershell
corepack pnpm@9.15.9 dev
```

启动后打开：

```text
http://localhost:5000
```

## 生产构建和启动

```powershell
corepack pnpm@9.15.9 build
corepack pnpm@9.15.9 start
```

## 构建 Windows 桌面 EXE

```powershell
New-Item -ItemType Directory -Force artifacts/acceptance | Out-Null
node scripts/verify-dependency-policy.mjs
python scripts/verify_python_locks.py
corepack pnpm@9.15.9 lint
corepack pnpm@9.15.9 ts-check
node scripts/verify-runtime-surface.mjs
node scripts/run-evidence-command.mjs --name unit --platform win --artifact artifacts/acceptance/unit.json -- pnpm exec vitest run --reporter=json --outputFile=artifacts/acceptance/unit.json
node scripts/run-evidence-command.mjs --name python --platform win --artifact artifacts/acceptance/python.xml -- python -m pytest -q --junitxml=artifacts/acceptance/python.xml
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = "artifacts/acceptance/browser.json"
$env:PLAYWRIGHT_PORT = "51237"
node scripts/run-evidence-command.mjs --name browser --platform win --artifact artifacts/acceptance/browser.json -- pnpm exec playwright test --project=chromium --workers=1 --reporter=json
node scripts/run-evidence-command.mjs --name audit --platform win --capture artifacts/acceptance/audit-win.json -- pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org --json
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
$env:PYTHON_CMD = "python"
node scripts/run-evidence-command.mjs --name package --platform win -- pnpm desktop:dist:win
node scripts/verify-desktop-package.mjs win
node scripts/check-package-size.mjs win
node scripts/run-evidence-command.mjs --name desktop --platform win --artifact artifacts/acceptance/desktop-win.json -- pnpm test:e2e:win
node scripts/write-acceptance-evidence.mjs win
corepack pnpm@9.15.9 verify:acceptance -- --platform win
```

构建完成后，NSIS 安装包会在 `release` 目录中。

## 发布验收限制

上述命令必须在同一干净提交中按顺序运行。最终验收依赖 evidence runner 机器报告和
`write-acceptance-evidence.mjs` manifest；缺失、旧提交或摘要不符的产物会被拒绝。

- Node.js 必须为 24.14.0，pnpm 必须为 9.15.9，Python 必须为 3.12.13。
- Excel 最大 25 MiB，最多 10,000 条记录；单行 QTY 最大 5,000。
- PDF worker 超时为 10 分钟，PDF 最大 256 MiB。
- 生成后必须通过 Windows 原生 Save As 保存。取消不得显示假成功；成功只写选定文件，不在 Downloads 写副本。
- `--browser-dev` 只能用于本机回环开发，不是生产启动或发布验收方式。

## 常见问题

- 如果提示找不到 `python`，请安装 Python 3.12，并勾选 “Add python.exe to PATH”，或使用 `py -3.12`。
- 如果提示找不到 `pnpm`，直接使用固定调用 `corepack pnpm@9.15.9 ...`。
- 正式产物必须由 Windows CI 的 `pnpm test:e2e:win` 验证，macOS 上的交叉构建不算 Windows 验收。
