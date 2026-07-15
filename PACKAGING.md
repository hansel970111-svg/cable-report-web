# 桌面版打包说明

本项目的桌面版使用 Electron 打包。正式发布平台仅为 Windows x64：

- Windows 输出并发布 `.exe`、`.exe.blockmap` 和 `latest.yml`
- macOS `.app` / `.dmg` / `.zip` 仅用于内部兼容性测试，不得上传到 Release 或提供给用户
- Python PDF 处理脚本会先用 PyInstaller 打成平台对应的本地可执行文件

## 准备环境

每个平台都需要：

- Node.js 24.14.0
- Python 3.12.13

```bash
corepack pnpm@9.15.9 install --frozen-lockfile
python -m pip install --require-hashes --only-binary=:all: -r requirements-dev.lock
corepack pnpm@9.15.9 exec playwright install chromium
```

Windows 完整发布流程要求 `python` 命令本身解析到 Python 3.12.13。若安装了多个版本，
请先激活 3.12 虚拟环境或调整 `PATH`，并验证：

```powershell
python --version
python -m pip install --require-hashes --only-binary=:all: -r requirements-dev.lock
```

## 本机调试桌面版

```bash
corepack pnpm@9.15.9 desktop:dev
```

## 内部验证 macOS 包（不发布）

必须在 macOS 上执行：

```bash
mkdir -p artifacts/acceptance
node scripts/run-evidence-command.mjs --name unit --platform mac --artifact artifacts/acceptance/unit.json -- pnpm exec vitest run --reporter=json --outputFile=artifacts/acceptance/unit.json
node scripts/run-evidence-command.mjs --name python --platform mac --artifact artifacts/acceptance/python.xml -- python -m pytest -q --junitxml=artifacts/acceptance/python.xml
PLAYWRIGHT_JSON_OUTPUT_FILE=artifacts/acceptance/browser.json PLAYWRIGHT_PORT=51237 node scripts/run-evidence-command.mjs --name browser --platform mac --artifact artifacts/acceptance/browser.json -- pnpm exec playwright test --project=chromium --workers=1 --reporter=json
node scripts/run-evidence-command.mjs --name audit --platform mac --capture artifacts/acceptance/audit-mac.json -- corepack pnpm@11.4.0 --pm-on-fail=ignore audit --prod --audit-level high --registry=https://registry.npmjs.org --json
CABLE_MAC_SIGNING_MODE=adhoc CSC_IDENTITY_AUTO_DISCOVERY=false PYTHON_CMD=python node scripts/run-evidence-command.mjs --name package --platform mac -- pnpm desktop:dist:mac
node scripts/verify-desktop-package.mjs mac
node scripts/verify-macos-trust.mjs
node scripts/check-package-size.mjs mac
PYTHON_CMD=python node scripts/run-evidence-command.mjs --name desktop --platform mac --artifact artifacts/acceptance/desktop-mac.json -- pnpm test:e2e:mac
node scripts/write-acceptance-evidence.mjs mac
PYTHON_CMD=python corepack pnpm@9.15.9 verify:acceptance -- --platform mac
```

产物只留在 CI 工作目录中做验证，不上传为安装包，也不进入 GitHub Release。

## 构建 Windows 版本

建议在 Windows 上执行：

```powershell
New-Item -ItemType Directory -Force artifacts/acceptance | Out-Null
node scripts/run-evidence-command.mjs --name unit --platform win --artifact artifacts/acceptance/unit.json -- pnpm exec vitest run --reporter=json --outputFile=artifacts/acceptance/unit.json
node scripts/run-evidence-command.mjs --name python --platform win --artifact artifacts/acceptance/python.xml -- python -m pytest -q --junitxml=artifacts/acceptance/python.xml
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = "artifacts/acceptance/browser.json"
$env:PLAYWRIGHT_PORT = "51237"
node scripts/run-evidence-command.mjs --name browser --platform win --artifact artifacts/acceptance/browser.json -- pnpm exec playwright test --project=chromium --workers=1 --reporter=json
node scripts/run-evidence-command.mjs --name audit --platform win --capture artifacts/acceptance/audit-win.json -- corepack pnpm@11.4.0 --pm-on-fail=ignore audit --prod --audit-level high --registry=https://registry.npmjs.org --json
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
$env:PYTHON_CMD = "python"
node scripts/run-evidence-command.mjs --name package --platform win -- pnpm desktop:dist:win
node scripts/verify-desktop-package.mjs win
node scripts/check-package-size.mjs win
node scripts/run-evidence-command.mjs --name desktop --platform win --artifact artifacts/acceptance/desktop-win.json -- pnpm test:e2e:win
node scripts/write-acceptance-evidence.mjs win
corepack pnpm@9.15.9 verify:acceptance -- --platform win
```

产物在 `release\` 目录，包含 NSIS 安装程序。

## 验收限制

以上命令必须在同一干净提交中按顺序运行；`verify:acceptance` 不会自行生成报告，且会拒绝
缺少 evidence runner 收据、缺少 manifest、提交不一致或 SHA-256 不一致的旧产物。

- Excel 最大 25 MiB，一次最多 10,000 条记录。
- Vertical Cabling 单行 QTY 最大 5,000。
- PDF worker 超时为 10 分钟，PDF 最大 256 MiB。
- 桌面版仅使用原生 Save As；取消时回到就绪，成功时只写用户选中的路径。
- `--browser-dev` 只是回环地址上的开发回退，不参与桌面发布验收。

## 用 GitHub 自动构建 Windows 版本

项目已配置 GitHub Actions：`Desktop packaged E2E`。

推送到 `main` 后会自动在 Windows 机器上构建；也可以在 GitHub 仓库的 `Actions` 页面手动运行。

下载方式：

1. 打开 GitHub 仓库。
2. 进入 `Actions`。
3. 点击最新的 `Desktop packaged E2E` 运行记录。
4. 在页面底部 `Artifacts` 下载 `Cable-Report-Generator-Windows`。
5. 解压后把 `.exe` 发给 Windows 用户。

## 重要说明

- macOS 和 Windows 的 Python worker 需要分别在对应系统上构建，不能直接共用。
- 正式发布只使用 Windows 任务验证通过的 `.exe`、`.exe.blockmap` 和 `latest.yml`；禁止附加 macOS 产物。
- 未做代码签名时，Windows SmartScreen 可能会提示未知开发者；正式大范围分发时建议配置 Windows 代码签名证书。
