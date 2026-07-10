# Windows 使用说明

## 环境要求

- Windows 10/11
- Node.js 24.14.0
- Python 3.12.13

## 首次安装

在项目目录打开 PowerShell，执行：

```powershell
corepack enable
corepack prepare pnpm@9.15.9 --activate
corepack pnpm install --frozen-lockfile
node ./scripts/run-python.mjs -m pip install --require-hashes --only-binary=:all: -r requirements.lock
```

如果电脑上同时装了多个 Python，可以显式指定 3.12：

```powershell
$env:PYTHON_CMD = "C:\path\to\python3.12.exe"
node ./scripts/run-python.mjs -m pip install --require-hashes --only-binary=:all: -r requirements.lock
```

## 开发启动

```powershell
corepack pnpm dev
```

启动后打开：

```text
http://localhost:5000
```

## 生产构建和启动

```powershell
corepack pnpm build
corepack pnpm start
```

## 构建 Windows 桌面 EXE

```powershell
corepack pnpm desktop:dist:win
```

构建完成后，安装包和便携版会在 `release` 目录中。

## 常见问题

- 如果提示找不到 `python`，请安装 Python 3.12，并勾选 “Add python.exe to PATH”，或使用 `py -3.12`。
- 如果提示找不到 `pnpm`，先执行 `corepack enable`，再用 `corepack pnpm ...`。
- 生成的 PDF 会同时作为浏览器下载返回，并尝试保存一份到当前 Windows 用户的 `Downloads` 文件夹。
