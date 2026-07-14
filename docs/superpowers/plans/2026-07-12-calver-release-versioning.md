# CalVer Release Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved Europe/Berlin `YYYY.MDD.N` release version as the single source for the UI, Electron metadata, package artifacts, annotated Git tags, and GitHub Releases.

**Architecture:** `package.json.version` remains the only committed version value. A pure `scripts/versioning.mjs` owns parsing, comparison and macOS build-number derivation; effectful preparation and validation commands own Git and filesystem checks. Task 20 consumes the package/bundle configuration, and Task 21 consumes tag validation and artifact checks so no release is created before both platforms pass.

**Tech Stack:** Node.js 24.14.0, pnpm 9.15.9, Electron 43.1.0, Electron Builder 26.15.3, Next.js 16.2.10, Vitest 4.1.10, GitHub Actions.

## Global Constraints

- Public version format is `YYYY.MDD.N` in IANA time zone `Europe/Berlin`; `N` starts at 1 and is at most 99.
- Supported public years are 2000–2099; month/day must pass real calendar validation; numeric SemVer parts have no leading zeroes.
- macOS `CFBundleVersion` is deterministically `YYMM.DD.N`; `CFBundleShortVersionString` is the public version.
- `package.json.version` is the only manually maintained version source; ordinary build/test commands never modify it.
- Preparation fetches tags and refuses offline sequence guessing, dirty worktrees, non-`main`, stale/diverged `main`, malformed `v*` tags, collisions, and unreleased-version double increments.
- Release tags are annotated `v<version>` tags whose tagger date maps to the version date in Europe/Berlin.
- A formal Release is created only after macOS and Windows quality, package, version, and packaged-E2E gates pass; released versions/assets are never overwritten.
- Historical `v0.1.1` remains valid and is never rewritten.

---

### Task 1: Pure CalVer Core and Update Comparison

**Files:**
- Create: `scripts/versioning.mjs`
- Create: `tests/release/versioning.test.ts`
- Modify: `electron/main.cjs`
- Modify: `tests/config/electron-spawn.test.ts`

**Interfaces:**
- Produces: `parseCalVer(version)`, `formatCalVer(date, sequence, timeZone)`, `compareAppVersions(left, right)`, `toMacBundleVersion(version)`, `nextReleaseVersion({ now, timeZone, publishedTags })`.

- [ ] **Step 1: Write RED table tests** covering January/July/October/December, leap days, DST boundaries, sequences 1/2/10/99/100, malformed/leading-zero versions, cross-day/month/year ordering, `0.1.1 < first CalVer`, invalid tags, and macOS mappings such as `2026.1231.10 -> 2612.31.10`.
- [ ] **Step 2: Run RED:** `corepack pnpm@9.15.9 test:unit tests/release/versioning.test.ts`; expect module-not-found failures.
- [ ] **Step 3: Implement pure functions** without filesystem, Git, shell, network, locale-default, or mutable global state. Return `null` from `parseCalVer` for invalid input and throw stable errors for invalid formatting/sequence/tag sets.
- [ ] **Step 4: Replace Electron's private numeric comparator** with `compareAppVersions`, retaining normalization of a leading `v` and proving `0.1.1` discovers any valid CalVer update.
- [ ] **Step 5: Run focused and full tests:** versioning, Electron config/security, then `test:unit`; commit `feat(release): add CalVer version core`.

### Task 2: Safe Release Preparation and Tag Validation

**Files:**
- Create: `scripts/prepare-release.mjs`
- Create: `scripts/validate-release-version.mjs`
- Create: `tests/release/prepare-release.test.ts`
- Create: `tests/release/validate-release.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm release:prepare [-- --refresh-unreleased]` and `pnpm release:validate [-- --prepared]`.

- [ ] **Step 1: Write RED temporary-Git-repository tests** for `NOT_ON_MAIN`, `DIRTY_WORKTREE`, `TAG_FETCH_FAILED`, stale/diverged/locally-ahead main, invalid current/tag versions, highest-tag ancestry, `.1` and maximum-same-day+1, collision/limit, unreleased idempotence, refresh restrictions, annotated/lightweight tags, Berlin tagger-date validation, and atomic two-space JSON preservation.
- [ ] **Step 2: Run RED** and confirm missing command modules rather than fixture errors.
- [ ] **Step 3: Implement a shell-free Git adapter** using `spawnSync`/`execFile` argument arrays. Validate every precondition before an atomic same-directory temporary-file rename. The prepare command updates only `package.json` and prints manual commit/tag/push commands; it never commits, tags, or pushes.
- [ ] **Step 4: Implement prepared/tag validators** with the stable error codes from the specification. Tag mode requires annotated tag metadata, exact `v${package.version}`, Berlin date equality, highest-version status, and no asset/version drift inputs.
- [ ] **Step 5: Run integration tests, dependency policy, `release:validate --prepared` in a fixture, and full unit tests; commit `feat(release): add safe CalVer preparation`.

### Task 3: Single-Source UI and Desktop Metadata

**Files:**
- Create: `electron-builder.config.mjs`
- Create: `src/lib/app-version.ts`
- Create: `tests/release/version-consumers.test.ts`
- Modify: `next.config.mjs`
- Modify: `src/features/report-editor/report-editor.tsx`
- Modify: `electron/main.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: package version and `toMacBundleVersion()`.
- Produces: immutable build-time public version, visible `版本 <version>` footer, Electron About version, versioned artifact names, public/macOS bundle versions.

- [ ] **Step 1: Write RED consumer tests** asserting the footer, About configuration, builder `productName`, `artifactName`, `mac.bundleVersion`, `mac.bundleShortVersion`, and Windows product/file version all derive from `package.json.version`; reject second hard-coded version literals.
- [ ] **Step 2: Run RED** and confirm missing version injection/config behavior.
- [ ] **Step 3: Inject the package version at Next build time** and expose it through a read-only module; render `版本 ${version}` in the existing editor footer without runtime HTTP/IPC version state.
- [ ] **Step 4: Configure Electron About and Builder** from package version. Artifact names must be `Cable-Report-Generator-${version}-${platform}-${arch}.${ext}` and macOS internal/public versions must use the approved mapping.
- [ ] **Step 5: Run consumer tests, lint, TypeScript, unit tests, and build; commit `feat(release): synchronize app version consumers`.

### Task 4: Tag-Only Cross-Platform Release Aggregation

**Files:**
- Modify: `.github/workflows/desktop-e2e.yml` (created by comprehensive Task 21)
- Modify: `.github/workflows/build-windows-exe.yml`
- Modify: `scripts/verify-acceptance.mjs` (created by comprehensive Task 21)
- Modify: `tests/build/package-policy.test.ts` (created by comprehensive Task 20)
- Modify: `README.md`
- Modify: `PACKAGING.md`
- Modify: `WINDOWS.md`

**Interfaces:**
- Consumes: annotated `v*` tag, package version, platform artifacts, Task 20 package verification, Task 21 packaged E2E/acceptance reports.
- Produces: one immutable GitHub Release titled `v<version>` containing DMG, ZIP and NSIS EXE.

- [ ] **Step 1: Write RED workflow/package policy tests** requiring `fetch-depth: 0`, tag-only formal release, pre-build `release:validate`, versioned artifact names, read-only matrix jobs, a single aggregate release job, and no per-platform Release overwrite.
- [ ] **Step 2: Run RED** after Tasks 20–21 exist; expect workflow contract failures.
- [ ] **Step 3: Make the macOS/Windows matrix upload immutable artifacts** only after version, quality, package and packaged-E2E gates. The aggregate job downloads both platform artifacts and creates one Release only on `refs/tags/v*` after acceptance verification.
- [ ] **Step 4: Extend acceptance verification** to compare package version, annotated tag, tagger Berlin date, app metadata, macOS bundle values, filenames and Release title. Reject missing/duplicate/wrong-version artifacts.
- [ ] **Step 5: Document exact prepare/review/commit/annotated-tag/push/retry/new-version rollback commands. Run workflow tests, full acceptance, YAML parse and final review; commit `ci(release): gate CalVer desktop releases`.

## Final Release Procedure

- [ ] Merge the reviewed comprehensive branch to `main`, run all Task 21 acceptance gates, and confirm both CI platforms are green.
- [ ] Run `corepack pnpm@9.15.9 release:prepare` on clean, current `main`; review and commit only the generated version changes.
- [ ] Run `release:validate --prepared`, full quality/packaged acceptance, then create `git tag -a v<version> -m "Release v<version>"` on the Berlin release date.
- [ ] Push `main` and the annotated tag; wait for the tag workflow to publish DMG, ZIP and EXE.
- [ ] Verify the GitHub Release title, tag, filenames, checksums/metadata and in-app version; record the Release URL and immutable commit/tag in the progress ledger.
