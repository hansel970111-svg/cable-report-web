# 桌面版打包说明

本项目的桌面版使用 Electron 打包：

- Windows 输出 `.exe`
- macOS 输出 `.app` / `.dmg`
- Python PDF 处理脚本会先用 PyInstaller 打成平台对应的本地可执行文件

## 准备环境

每个平台都需要：

- Node.js 24.14.0
- Python 3.12.13

```bash
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
python -m pip install --require-hashes --only-binary=:all: -r requirements-dev.lock
```

Windows 如果 `python` 不可用，可改用：

```powershell
$env:PYTHON_CMD = "C:\path\to\python3.12.exe"
node ./scripts/run-python.mjs -m pip install --require-hashes --only-binary=:all: -r requirements-dev.lock
```

## 本机调试桌面版

```bash
pnpm desktop:dev
```

## 构建 macOS 版本

必须在 macOS 上执行：

```bash
pnpm check:fast
pnpm test:python
pnpm test:e2e:browser -- --workers=1
pnpm desktop:dist:mac
node scripts/verify-desktop-package.mjs mac
node scripts/check-package-size.mjs mac
pnpm test:e2e:mac
pnpm verify:acceptance -- --platform mac
```

产物在 `release/` 目录。

## 构建 Windows 版本

建议在 Windows 上执行：

```powershell
pnpm check:fast
pnpm test:python
pnpm test:e2e:browser -- --workers=1
pnpm desktop:dist:win
node scripts/verify-desktop-package.mjs win
node scripts/check-package-size.mjs win
pnpm test:e2e:win
pnpm verify:acceptance -- --platform win
```

产物在 `release\` 目录，包含 NSIS 安装程序。

## 验收限制

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
- 只有 macOS 和 Windows 两个实包任务都通过后，才能将安装包用于正式发布。
- 未做代码签名时，Windows SmartScreen 和 macOS Gatekeeper 可能会提示未知开发者；正式分发时需要代码签名证书。
