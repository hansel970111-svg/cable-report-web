# 桌面版打包说明

本项目的桌面版使用 Electron 打包：

- Windows 输出 `.exe`
- macOS 输出 `.app` / `.dmg`
- Python PDF 处理脚本会先用 PyInstaller 打成平台对应的本地可执行文件

## 准备环境

每个平台都需要：

```bash
corepack enable
corepack pnpm install
python -m pip install -r requirements.txt
```

Windows 如果 `python` 不可用，可改用：

```powershell
py -3 -m pip install -r requirements.txt
```

## 本机调试桌面版

```bash
corepack pnpm desktop:dev
```

## 构建 macOS 版本

必须在 macOS 上执行：

```bash
corepack pnpm desktop:dist:mac
```

产物在 `release/` 目录。

## 构建 Windows 版本

建议在 Windows 上执行：

```powershell
corepack pnpm desktop:dist:win
```

产物在 `release\` 目录，包含安装版和便携版。

## 重要说明

- macOS 和 Windows 的 Python worker 需要分别在对应系统上构建，不能直接共用。
- 如果要发给普通用户，建议给 Windows 发 `portable exe` 或安装包，给 macOS 发 `.dmg`。
- 未做代码签名时，Windows SmartScreen 和 macOS Gatekeeper 可能会提示未知开发者；正式分发时需要代码签名证书。
