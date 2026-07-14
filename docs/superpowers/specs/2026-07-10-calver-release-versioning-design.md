# Cable Report Generator 发布时间版本设计

**日期：** 2026-07-10

**状态：** 设计及 macOS 构建号兼容方案已获用户口头批准，等待书面规格复核

**目标仓库：** `/Users/lhs/Documents/线缆测试报告/extracted_project/projects`

**增补规格：** `docs/superpowers/specs/2026-07-10-cable-report-comprehensive-optimization-design.md`

## 1. 目标

Cable Report Generator 从下一次正式发布开始使用基于发布时间的 CalVer。版本号必须在每次正式发布前由一个可审查的命令生成，并同步到应用界面、Electron 元数据、安装包、Git Tag 和 GitHub Release。

本设计解决四个问题：

1. 版本号直接表达 Europe/Berlin 发布日期。
2. 同一天可以安全发布多次，且版本严格递增。
3. `package.json` 是唯一版本源，避免 UI、安装包和 Tag 漂移。
4. 普通开发、测试和重复构建不会意外修改版本。

## 2. 已批准决策

- 版本格式使用 `YYYY.MDD.N`。
- 发布日期使用 IANA 时区 `Europe/Berlin`。
- `N` 从 `1` 开始，同日逐次递增。
- 仅正式发布更新版本；普通开发、合并和重复构建不更新。
- 发布人员运行一个准备命令，审查文件后自行提交和打 Tag；脚本不自动提交、打 Tag 或推送。
- `package.json.version` 是唯一版本源。
- 版本同步显示在安装包元数据、应用“关于”、主界面页脚、Git Tag 和 GitHub Release。
- macOS 用户可见版本保持 `YYYY.MDD.N`；受 Apple `CFBundleVersion` 位数限制，内部构建号使用从公开版本确定性派生的 `YYMM.DD.N`。
- 每个 Berlin 日期最多发布 99 次。
- 历史版本 `v0.1.1` 保留，不补写或重打历史 Tag。

## 3. 版本格式

### 3.1 语法

```text
YYYY.MDD.N
```

- `YYYY`：四位 Berlin 当地年份；本应用支持 2000–2099。
- `MDD`：`month * 100 + day` 的十进制整数。
- `N`：当天正式发布序号，正整数，从 `1` 开始。

示例：

| Berlin 日期 | 当日序号 | 版本 |
|---|---:|---|
| 2026-01-05 | 1 | `2026.105.1` |
| 2026-07-10 | 1 | `2026.710.1` |
| 2026-07-10 | 2 | `2026.710.2` |
| 2026-12-31 | 10 | `2026.1231.10` |

`MDD` 不补前导零。这样三个公开版本部分都是 npm 接受的 SemVer 十进制整数。Electron Builder 使用该版本作为产品版本、用户可见版本和产物名；macOS 的内部 `CFBundleVersion` 使用第 3.4 节的受限映射。

### 3.2 解析与合法性

解析 `MDD` 时：

```text
month = floor(MDD / 100)
day = MDD % 100
```

随后必须使用真实日历校验年月日。以下版本无效：

- `2026.0.1`：没有月份。
- `2026.229.1`：2026 年没有 2 月 29 日。
- `2026.1331.1`：没有 13 月。
- `2026.710.0`：发布序号必须大于 0。
- `2026.0710.1`：SemVer 数字段不能有前导零。
- `2100.101.1`：超出批准的平台版本映射范围。

### 3.3 排序

版本按三个数值部分依次比较：

1. 年份；
2. `MDD`；
3. 当日发布序号。

因此：

```text
0.1.1 < 2026.105.1 < 2026.710.1 < 2026.710.2 < 2026.1231.1 < 2027.101.1
```

现有 Electron 更新比较逻辑可以继续使用三段数值比较，但必须由回归测试锁定上述迁移和边界。

### 3.4 macOS 内部构建号

Apple 要求 `CFBundleVersion` 为最多三段整数，其中第一段最多四位、第二和第三段最多两位。公开版本的 `MDD` 在 10–12 月达到四位，因此不能直接复用。

macOS 内部构建号固定映射为：

```text
YYMM.DD.N
```

- 第一段：`(year % 100) * 100 + month`；
- 第二段：日期；
- 第三段：当天发布序号；
- 每段输出规范十进制，不补无意义前导零；
- 支持年份范围为 2000–2099；
- `N` 最大为 99。

示例：

| 公开版本 | macOS `CFBundleVersion` |
|---|---|
| `2026.105.1` | `2601.5.1` |
| `2026.710.2` | `2607.10.2` |
| `2026.1231.10` | `2612.31.10` |

`CFBundleShortVersionString` 继续使用完整公开版本。内部构建号只是同一版本的机器可读派生值，不是第二个人工版本源。

## 4. 单一版本源与消费者

### 4.1 唯一版本源

唯一可提交版本值为：

```text
package.json.version
```

不创建第二个手工维护的 `version.json`、TypeScript 常量或 Electron 常量。

### 4.2 消费者

所有消费者直接或在构建时派生自 `package.json.version`：

- Electron `app.getVersion()`；
- macOS `CFBundleShortVersionString`（公开版本）和确定性派生的 `CFBundleVersion`；
- Windows FileVersion / ProductVersion（公开版本）；
- Electron Builder 安装包文件名；
- 应用“关于”信息；
- Next.js 主界面页脚；
- Git Tag `v<package-version>`；
- GitHub Release 标题 `v<package-version>`；
- 更新检查中的当前版本。

Next.js 通过构建配置读取 `package.json` 并注入只读的公开构建变量。Renderer 不通过 HTTP 或 IPC 维护另一份版本状态。

Electron Builder 使用 `electron-builder.config.mjs` 读取 `package.json.version`。配置通过纯版本模块计算 `mac.bundleVersion`，设置 `mac.bundleShortVersion` 为公开版本；Windows 继续使用公开版本。构建配置不保存另一个手工版本常量。

### 4.3 可见文案和产物名

主界面页脚显示：

```text
版本 2026.710.1
```

“关于”显示产品名与同一版本。产物名固定包含版本、平台和架构：

```text
Cable-Report-Generator-2026.710.1-mac-arm64.dmg
Cable-Report-Generator-2026.710.1-mac-arm64.zip
Cable-Report-Generator-2026.710.1-win-x64.exe
```

## 5. 组件边界

### 5.1 纯版本模块

`scripts/versioning.mjs` 只实现纯函数：

```ts
type CalVer = {
  version: string;
  year: number;
  month: number;
  day: number;
  sequence: number;
};

parseCalVer(version: string): CalVer | null
formatCalVer(date: Date, sequence: number, timeZone: 'Europe/Berlin'): string
compareAppVersions(left: string, right: string): number
toMacBundleVersion(version: string): string
nextReleaseVersion(input: {
  now: Date;
  timeZone: 'Europe/Berlin';
  publishedTags: readonly string[];
}): string
```

该模块不读取文件、不执行 Git、不访问网络，测试可注入固定时间和 Tag。

### 5.2 发布准备命令

`scripts/prepare-release.mjs` 负责副作用：

- 验证分支和工作树；
- 使用参数数组执行 Git 命令，不使用 shell 字符串；
- 获取远端 Tag；
- 读取和原子更新 `package.json`；
- 调用纯版本模块；
- 运行版本校验；
- 输出人工提交、打 Tag 和推送命令。

`package.json` 暴露：

```json
{
  "scripts": {
    "release:prepare": "node scripts/prepare-release.mjs",
    "release:validate": "node scripts/validate-release-version.mjs"
  }
}
```

### 5.3 发布校验命令

`scripts/validate-release-version.mjs` 在本地和 CI 共用，验证：

- `package.json.version` 是合法 CalVer，或在迁移测试中是允许的历史 `0.1.1`；
- 当前正式发布 Tag 精确等于 `v${package.json.version}`；
- Tag 是 annotated tag；
- annotated tag 的 tagger 时间转换到 Berlin 后与版本日期一致；
- prepared 模式的候选版本高于所有已发布 Tag，且本身没有 Tag；
- tag 模式的当前 Tag 是最高已发布版本，且不存在同版本冲突；
- UI 构建变量、Electron metadata 和产物名使用同一版本；
- macOS `CFBundleShortVersionString` 等于公开版本，`CFBundleVersion` 等于 `toMacBundleVersion(publicVersion)`。

`release:validate --prepared` 用于版本文件刚更新、尚未打 Tag 的阶段，不要求当前 Tag。无参数的 `release:validate` 用于 Tag CI，执行完整 annotated tag、tagger 日期和产物一致性检查。

## 6. 发布准备算法

正常 `pnpm release:prepare` 按以下顺序执行：

1. 确认当前分支为 `main`。
2. 确认工作树和暂存区干净。
3. 执行 `git fetch origin main --tags --prune`；失败立即停止。
4. 如果本地 `main` 落后或与 `origin/main` 分叉，返回 `MAIN_NOT_CURRENT`；本地仅领先可以继续。
5. 读取 `package.json.version` 和全部 `v*` Tag；未知格式的 `v*` Tag 返回 `INVALID_RELEASE_TAG`。
6. 如果当前版本是合法但未打 Tag 的 CalVer，返回 `UNRELEASED_VERSION_EXISTS`，不再次递增。
7. 当前版本必须是已发布 Tag 对应版本或历史 `0.1.1`；同时要求它等于最高已发布版本，且该 Tag 的提交是当前 `HEAD` 的祖先，否则返回 `CURRENT_VERSION_NOT_LATEST`。
8. 确认上述发布历史基线后继续计算新版本。
9. 使用 `Intl.DateTimeFormat` 和 `Europe/Berlin` 取得年月日。
10. 从当天全部已发布 Tag 中取最大 `N`，新序号为 `max + 1`；没有当天 Tag 时为 `1`。
11. 如果新序号大于 `99`，返回 `DAILY_RELEASE_LIMIT`，不写文件。
12. 原子更新 `package.json.version`，保留现有两空格 JSON 格式和末尾换行。
13. 运行 `release:validate --prepared`、版本单元测试和 lockfile 一致性检查。
14. 输出新版本及建议 Git 命令，不执行这些命令。

示例输出：

```text
Prepared release version 2026.710.1 (Europe/Berlin).

Review the diff, then run:
git add package.json
git commit -m "chore(release): prepare v2026.710.1"
git tag -a v2026.710.1 -m "Release v2026.710.1"
git push origin main v2026.710.1
```

## 7. 未发布版本与跨日刷新

### 7.1 同日重复运行

如果 `package.json.version` 已是一个没有对应 Tag 的 CalVer，普通准备命令停止并显示该待发布版本。它不会产生 `.2`。

### 7.2 跨日但尚未发布

如果已准备版本跨日仍未发布，可以显式运行：

```bash
pnpm release:prepare -- --refresh-unreleased
```

该模式只有同时满足以下条件才可运行：

- 当前版本是合法 CalVer；
- 没有任何同名本地或远端 Tag；
- 工作树干净；
- 当前分支是 `main`。

它基于新的 Berlin 日期和已发布 Tag 重算版本。它不删除 Tag、不改写已发布版本、不自动 amend 旧提交。

## 8. Git 与 CI 发布流

### 8.1 普通构建

- `main` push、pull request 和手动测试构建读取已提交版本，但不修改它。
- 普通构建可以上传 CI artifact，不创建 GitHub Release。
- 同一提交和同一 Tag 的重复构建必须生成相同应用版本。

### 8.2 正式发布

正式发布只由 `v*` annotated tag 触发。发布 workflow 使用 `fetch-depth: 0` 获取完整 Tag 元数据，先运行 `release:validate`，再进行 macOS/Windows 打包和 E2E。

只有以下条件全部满足才创建 GitHub Release：

- Tag、package、应用和产物版本一致；
- Tag 日期与版本 Berlin 日期一致；
- macOS 与 Windows 质量、打包和 E2E 门禁通过；
- 产物名包含正确版本；
- 当前版本高于已有正式发布。

发布 job 汇总两个平台产物后创建一个 Release，标题和 Tag 都为 `v<version>`。矩阵构建 job 不各自创建或覆盖 Release。

## 9. 错误处理

发布命令使用稳定错误码和可执行恢复提示：

| 错误码 | 条件 | 恢复方式 |
|---|---|---|
| `NOT_ON_MAIN` | 当前分支不是 `main` | 切换到 `main` 后重试 |
| `DIRTY_WORKTREE` | 有未提交或已暂存改动 | 提交、暂存到其他分支或恢复后重试 |
| `TAG_FETCH_FAILED` | 无法获取远端 Tag | 恢复网络/权限后重试，不允许离线猜号 |
| `MAIN_NOT_CURRENT` | 本地 `main` 落后或与 `origin/main` 分叉 | 先同步并解决分叉，再重新准备发布 |
| `INVALID_CURRENT_VERSION` | package 版本既不是历史版本也不是合法 CalVer | 修复版本文件后重试 |
| `INVALID_RELEASE_TAG` | 存在无法解析的 `v*` Tag | 明确修复 Tag 历史后再计算，不静默忽略 |
| `CURRENT_VERSION_NOT_LATEST` | package 版本不是最高发布版本，或最高 Tag 不在当前 HEAD 历史中 | 切换/同步到正确发布提交后重试 |
| `UNRELEASED_VERSION_EXISTS` | 当前 CalVer 没有对应 Tag | 完成当前发布，或在跨日时显式刷新 |
| `VERSION_COLLISION` | 新版本已经存在本地或远端 Tag | 重新 fetch 并计算下一序号 |
| `DAILY_RELEASE_LIMIT` | 当日已经发布 99 个版本 | 等待下一个 Berlin 日期，不允许复用序号 |
| `TAG_VERSION_MISMATCH` | Tag 与 package 不一致 | 修复发布提交或创建正确 Tag |
| `TAG_DATE_MISMATCH` | Tagger Berlin 日期与版本日期不同 | 保留已经创建的 Tag；准备一个当前日期的新版本，不移动或复用旧 Tag |
| `VERSION_NOT_IN_ARTIFACT` | 产物元数据或文件名版本错误 | 停止发布并修复构建配置 |

错误前不写文件；原子写入失败时保留原 `package.json`。

## 10. 回滚规则

- 已发布 Tag、GitHub Release 和版本号不可复用、移动或覆盖。
- 已发布版本有缺陷时，提交修复并生成当天的下一个 `N`。
- 仅准备但未打 Tag 的版本可以被放弃或跨日刷新。
- 重跑失败的同一 Tag 构建不更新版本。
- Release assets 不允许用不同二进制覆盖同名版本；重新发布必须使用新版本。

## 11. 测试策略

### 11.1 纯函数测试

- 1 月、7 月、10 月和 12 月的 `MDD` 编解码；
- 闰年和非法日期；
- Berlin 夏令时开始/结束边界；
- 同日序号 1、2、10；
- 同日序号 99 及第 100 次发布拒绝；
- 跨日、跨月和跨年；
- `0.1.1` 到首个 CalVer；
- 任意三段数值版本比较；
- malformed 和有前导零版本拒绝。

### 11.2 临时 Git 仓库集成测试

- 无 CalVer Tag 时生成 `.1`；
- 同日多个 Tag 后生成最大序号加一；
- 脏工作树和非 `main` 拒绝；
- fetch 失败不写文件；
- 本地 `main` 落后/分叉拒绝，本地仅领先允许；
- 未知格式 `v*` Tag 拒绝；
- package 版本不是最高 Tag 或 Tag 不在 HEAD 历史中时拒绝；
- 未发布版本不重复递增；
- `--refresh-unreleased` 只替换无 Tag 版本；
- annotated/lightweight tag 区分；
- Berlin Tag 日期校验；
- package 原子写入和格式保持。

### 11.3 应用与产物测试

- 页脚版本等于 `package.json.version`；
- Electron About 版本等于 `app.getVersion()`；
- macOS/Windows metadata 版本一致；
- macOS `CFBundleVersion` 使用 `YYMM.DD.N` 映射且严格递增；
- DMG、ZIP、EXE 文件名含版本；
- Tag workflow 的 GitHub Release 标题一致；
- 当前 `0.1.1` 能发现任意合法 CalVer 更新；
- 同一 Tag 重复构建不产生版本差异。

## 12. 非目标

- 不自动提交、打 Tag、推送或创建发布提交。
- 不把版本更新绑定到每次构建、每次 `main` 合并或每次开发启动。
- 不重写 `v0.1.1` 历史。
- 不引入第三方版本服务或数据库。
- 不使用 GitHub Release 创建时间覆盖已批准的 Berlin Tag 日期规则。
- 不支持离线猜测当天序号。
- 不支持同一 Berlin 日期超过 99 个正式版本。

## 13. 完成标准

只有同时满足以下条件，版本功能才完成：

1. `pnpm release:prepare` 能生成合法、正确递增的 Berlin `YYYY.MDD.N`。
2. 同日重复发布递增 `N`，普通构建不改变版本。
3. 未发布版本不会被普通命令二次递增，跨日刷新只影响无 Tag 版本。
4. `package.json.version` 是唯一手工维护版本源。
5. 页脚、About、Electron metadata、安装包名、Tag 和 Release 版本一致。
   macOS 内部 `CFBundleVersion` 必须是同一公开版本的批准映射值，而不是字面相同字符串。
6. 发布 CI 在任何版本或日期不一致时停止。
7. `v0.1.1` 到 CalVer 的更新比较通过。
8. macOS 与 Windows 正式发布都经过同一版本校验。
9. 已发布版本和资产不能被覆盖或复用。
10. 版本单元、Git 集成、应用和产物测试全部通过。

## 14. 与全面优化计划的关系

本设计是全面优化规格的发布管理增补，不改变已批准的随机数据、Excel、PDF、Electron 保存和性能要求。实施计划应在依赖升级完成后加入 CalVer 核心与发布准备任务，并在 ASAR/CI 与双平台发布任务中接入版本一致性门禁。

## 15. 规范依据

- Apple `CFBundleVersion`：<https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion>
- Apple Core Foundation bundle version keys：<https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CoreFoundationKeys.html>
- Electron Builder `buildVersion`、artifact 与 mac bundle 配置：<https://www.electron.build/docs/configuration/>
- Microsoft Windows VERSIONINFO：<https://learn.microsoft.com/en-us/windows/win32/menurc/versioninfo-resource>
- npm package SemVer 说明：<https://docs.npmjs.com/about-semantic-versioning/>
