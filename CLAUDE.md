# BPMCore Architecture Notes

Use this file as the quick architecture source before changing the project.

## Naming

- Always write BPM in uppercase.
- The backend runtime app is `apps/api`.
- The reusable BPM package boundary is `libs/bpm-core`, exposed as
  `@rytass/bpm-core-nestjs-module`; `@bpm/core` is only an internal path alias.
- Do not reintroduce `apps/bpm-demo-host` or `@bpm/api/*`.

## Project Boundaries

- `apps/api`: NestJS host shell only. It wires Vault, TypeORM, GraphQL, CORS, validation, exception filters, health checks, DB-backed test-member login/session endpoints, wrapper-app seeding, and `BPMRootModule`.
- `libs/bpm-core`: reusable BPM backend core. Put BPM domain modules, entities, resolvers, mutations, services, migrations, auth contracts, and TypeORM helpers here. Exposed as `@rytass/bpm-core-nestjs-module`.
- `libs/bpm-core-client`: cross-platform typed GraphQL/REST client. Exposed as `@rytass/bpm-core-client`.
- `libs/bpm-core-react`: React UI library (providers, hooks, views, Next.js page shims). Exposed as `@rytass/bpm-core-react`.
- `apps/client`: Next.js backoffice UI. Pure thin host — every `app/<route>/page.tsx` is a one-line re-export from `@rytass/bpm-core-react/pages/<feature>`; `providers.tsx` wraps `<BPMNextProviders>` and renders two host-side pieces: `PdfWorkerSetup` (sets the react-pdf `pdfjs` worker URL on mount) and `HostShell` (`app/_components/host-shell.tsx`, which wraps pages in the host `HostLayout` sidebar except on `/` and `/login`). No BPM business logic lives here. On localhost it uses `http://localhost:17603/graphql` and `http://localhost:17603` (root-level `/auth/*` + `/attachments/*` endpoints, no `/api` prefix); on deployed hosts it defaults to same-origin `/graphql` plus same-origin root paths.
- `libs/shared`: shared BPM contracts for workflow, form, condition, identity, organization, and status types. Exposed as `@rytass/bpm-core-shared`.

## Public API Reference

`docs/api-reference.md` is the **canonical inventory** of every export from every BPMCore lib. It lists every type, interface, function, hook, component, NestJS module, entity, service, migration, view, page, and subpath in the four published packages.

**Maintenance invariant** — any change under `libs/*/src/**` (adding, removing, renaming, or moving a symbol), or any edit to `package.json` `exports`, `tsconfig.base.json` paths, or `libs/bpm-core-react/vite.config.ts` `PLANNED_ENTRIES`, MUST update `docs/api-reference.md` in the same commit. Bump the "Last verified against" line at the top of that file to the new version of each affected package.

Before adding new exports, check the file first — likely something close already exists. When you finish editing libs, re-grep your changes against the doc to confirm coverage. CI does not enforce this yet; humans and agents are the enforcement.

## Releasing

**Never hand-edit `version` in `libs/*/package.json`.** `nx release` (config in
`nx.json`) owns versions, per-package `CHANGELOG.md`, git tags and GitHub
releases for **all four** published packages:

```bash
npx nx release --dry-run        # review the resolved version and changelog
npx nx release --skip-publish   # everything up to the GitHub release
pnpm nx run-many -t build -p shared,bpm-core,bpm-core-client --skip-nx-cache
npx nx release publish --otp=<6 digits>   # a second process: build → publish
```

Run it as those separate processes; that is how v0.14.0 shipped (its first
step also had `NX_SKIP_NX_CACHE=true` set, which changes nothing there).
`--skip-publish` runs `prepublish-check` → version → changelogs → commit → tag →
`git push --follow-tags` → GitHub release and stops there, so it needs no OTP.
The OTP is typed only when publishing actually starts — a code lives about 30
seconds, which the earlier phases of a one-command release can outlast.

`npx nx release --otp=<6 digits>` does the lot in one command
(`prepublish-check` → version → changelogs → commit → tag →
`git push --follow-tags` → GitHub release → build → publish; `--yes` for an
unattended run). It is the form that left three packages off npm on v0.13.5 —
see below — so it is documented here, not recommended.

A manual bump skips the changelog generation, so a release ships with a
`CHANGELOG.md` that still ends at the previous version. That has happened; do
not repeat it.

**`targetDefaults."nx-release-publish".dependsOn = ["build"]` is what makes the
one-command form correct — do not remove it.** Three of the four packages
publish from `dist/libs/*`, and the only build in the pipeline used to be the
one inside `prepublish-check`, which runs as `preVersionCommand` — i.e. *before*
the version is written. So `dist` always carried the previous version, and
`nx release publish` skipped those three with "vX already exists in the
registry". `bpm-core-react` was unaffected only because its package root is the
source directory. Verified by reading `nx/dist/src/utils/package-json.js`
(targetDefaults are *merged into* the implicit target, so nx's own
`^nx-release-publish` ordering survives) and by watching the build run ahead of
publish in `nx release --dry-run`. That dry run is a weak check: it never
writes the version, so it cannot see the failure below.

**`dependsOn: ["build"]` is necessary but not sufficient — a release can exit 0
with three packages never reaching npm.** On v0.13.5 the build *did* run ahead
of publish, hit the nx cache, and restored a `dist` still carrying the old
version:

```
> nx run shared:build  [local cache]
> nx run shared:nx-release-publish
Skipped package "@rytass/bpm-core-shared" ... because v0.13.4 already exists
```

Only `bpm-core-react` reached npm. The command still reported success.

The mechanism, verified: daemonless, a single nx process keeps the Rust
`WorkspaceContext` file hashes it read at startup, and nothing in the
`nx release` path notifies that context when the version step rewrites
`libs/*/package.json` — only the daemon's watcher
(`daemon/server/project-graph-incremental-recomputation.js` →
`updateFilesInContext`) and `utils/sync-generators.js` ever push changed files
into it. So the version bump leaves the build hash untouched, and the cache
entry written moments earlier by the pre-version `prepublish-check` build —
under the *old* version — is a hit. Probed directly: within one process the
`build` hashes before and after rewriting every `libs/*/package.json` are
identical (`shared:build 404298817381`), while a fresh process computes a
different hash for the same tree. `package.json` **is** in the input set
(`nx show target inputs bpm-core:build` lists it); the stale hash value is the
problem, not the input set, so adding it to `inputs` fixes nothing.

This workspace is daemonless: `.nx/workspace-data/d/disabled` has sat there
since 2026-08-25 (a `TypeError` in the daemon's incremental recomputation), and
`daemon/client/client.js` also disables the daemon inside a sandbox. With the
daemon enabled the in-process hash is still stale for the first ~200ms, so the
daemon is a race, not a fix.

`bpm-core-react` escapes for a second reason: its `build` is `nx:run-commands`,
and the `targetDefaults` key is the executor `@nx/js:tsc`, not the target name
`build`, so `isCacheableTask` never marks it cacheable and it always really
runs.

Why v0.13.4 published cleanly is **not** established. `dependsOn: ["build"]`
predates it and `prepublish-check` writes that stale entry on every release, so
"a build ran first" is not the trigger. Treat the one-command form as
unreliable, not as broken since a known date.

**Never trust the exit code — verify the registry after every release.**
`npm view` is locally cached and shows the old version for a minute or two, and
the registry itself lags: on v0.14.0 all four URLs below still answered 404 for
about a minute after `Published to https://registry.npmjs.org/`. A 404 straight
after a publish is not yet a skipped package — look for `Skipped package` in the
output, and ask the registry again before recovering:

```bash
for p in bpm-core-shared bpm-core-nestjs-module bpm-core-client bpm-core-react; do
  curl -s -o /dev/null -w "$p %{http_code}\n" \
    "https://registry.npmjs.org/@rytass%2F$p/<version>"   # 404 = never published
done
```

**Recovery when a package was skipped** — this is the path that worked:

```bash
pnpm nx run-many -t build -p shared,bpm-core,bpm-core-client --skip-nx-cache
npx nx release publish --projects=shared,bpm-core,bpm-core-client,bpm-core-react --otp=<6 digits>
```

List **all four**: a fixed release group rejects a subset ("Cannot filter to a
subset of projects within fixed release group") and the already-published one
skips itself. This is the one sanctioned use of `--projects`, and the rule
above is exactly why the build is run first and by hand.

**What v0.14.0 established about the two candidate fixes.**

Two processes work. `nx release publish` ran as its own process after
`nx release --skip-publish` and put all four packages on npm at 0.14.0. Its
builds were still restored from the cache (`nx run shared:build  [local cache]`)
— but a fresh process hashes the already-bumped `package.json`, so the entry it
hit was the one the hand-run build had just written, after the bump, and the
tarballs were 0.14.0. Whether the publish would have been right without that
hand-run build was not tested; keep the build in the sequence. A cache hit in
the publish output is therefore not a failure by itself; the version in the
`📦  @rytass/…@<version>` lines is what to read.

`NX_SKIP_NX_CACHE=true` does **not** reach the publish phase — do not rely on
it. nx reads the variable in `runCommand` (`tasks-runner/run-command.js`) and
in the CLI argument splitter (`utils/command-line-utils.js`), which is why it
works on `nx run shared:build`; `command-line/release/publish.js` calls
`runCommandForTasks` directly and never consults it. With the variable set,
`nx release publish --dry-run` still reports the three builds as
`[local cache]`, and so did the real v0.14.0 publish. The flag form is
different: `nx release publish --skip-nx-cache` does make the builds run
(verified with `--dry-run` only, not across a real publish).

**An OTP that starts with `0` cannot be passed as `--otp=`.** nx parses the
value as a number: `--otp=075689` was echoed back as `--otp=75689` and pnpm
answered "This operation requires a one-time password". Nothing had been
published, so re-running with the next code that does not start with `0` was
enough. `NPM_CONFIG_OTP=<code> npx nx release publish` should avoid the parsing
(`pnpm config get otp` returns the value with its leading zero), but that has
not been tried on a real publish.

**Never pass `--projects` or `--groups` to a release.** `publish.js` turns on
`excludeTaskDependencies` whenever either is set, which silently drops that
build step. nx's own "OTP expired, re-run this" hint is of that shape
(`nx release publish --projects=… --otp=…`); it is safe only because `dist` is
already current by then. Building by hand first is the rule if you ever narrow a
release.

**All four packages are one fixed version set** — `shared`, `bpm-core`,
`bpm-core-client` and `bpm-core-react` share a version number, a `v{version}`
tag, one workspace `CHANGELOG.md` and one GitHub release, plus a per-package
`CHANGELOG.md` each. `prepublish-check` runs for all four before versioning.

The cost of a fixed set: a change to any package bumps all four, so
`bpm-core-react` ships a new version even when only backend code moved. That is
the accepted trade for one number to reason about — `bpm-core-react` used to
version on its own cadence and drifted to 0.8.0 while the core sat at 0.7.0.

Inter-package ranges are maintained automatically
(`preserveMatchingDependencyRanges: false`). Do not hand-edit the
`@rytass/bpm-core-*` entries in each package's `peerDependencies`; `nx release`
rewrites them to the new version. The historical accumulation in
`bpm-core-react` (`^0.4.0 || ^0.5.0 || ^0.6.0 || ^0.7.0`) was collapsed to a
single current range when the versions were aligned at 0.9.0 — do not
reintroduce that pattern by hand.

**`useCommitScope: false` is required — do not remove it.** nx defaults to
`true`, which only counts a commit toward the bump when its scope matches a
*project* name; everything else is treated as an indirect change and forced down
to `patch` regardless of type. This repo scopes commits by domain
(`feat(template)`, `fix(calendar)`), so with the default a release containing
three features resolved to `patch` — verified against
`nx/dist/src/command-line/release/utils/semver.js`. With it set to `false`, every
commit touching the project's files counts, and the same set correctly resolved
to `minor`.

Still read the resolved version in the dry run, and override when needed:

```bash
npx nx release minor --skip-publish   # or patch / an exact version
```

Then build and publish as above.

**`release.version.adjustSemverBumpsForZeroMajorVersion` is `true` — the 0.x
convention.** Without it a `BREAKING CHANGE:` footer resolves to a major bump,
which on 0.x means 1.0.0; v0.13.0 had to be named by hand for exactly that
reason. With it on, every level shifts down one while the major is still 0:

| commit                          | resolves to |
| ------------------------------- | ----------- |
| `fix:`                          | patch       |
| `feat:`                         | patch       |
| `BREAKING CHANGE:` footer       | minor       |

Both rows were verified against the v0.13.0 tag on a throwaway branch: a
breaking commit resolved to 0.14.0 (not 1.0.0) and a `feat:` commit to 0.13.1.

The cost is real and was accepted deliberately: `feat:` no longer earns a minor
bump. That does **not** make `useCommitScope: false` pointless — it still
decides whether a commit counts toward the bump at all, and without it a
domain-scoped `feat(template)` would be treated as an indirect change. The flag
only lowers the level a counted commit produces. Once the packages reach 1.0.0
the shifting stops on its own and normal semver resumes.

The 0.9.0 release had to be given explicitly (`npx nx release 0.9.0`) because
aligning the version set meant clearing `bpm-core-react`'s already-published
0.8.0; the core packages skip 0.8.0 entirely. From the `v0.9.0` tag onward the
bump resolves automatically again.

Full publish commands, and why the backend and frontend packages publish from
different directories, are in `docs/api-reference.md` → "Publish Procedure".

## Auth Model

BPMCore does not own login, token issuance, or a user table. The host app is
expected to provide:

- a `BPMAuthContext` source through GraphQL/HTTP context or `BPMRootModule` `authContextFactory` — without one, every authenticated BPM operation answers 401
- a member resolver, either as the `memberResolver` runtime value or the `BPM_MEMBER_RESOLVER` provider

Neither is *required* to boot: since the zero-configuration round every
`BPMRootModule` option has a default, and an unresolved member falls back to
`DefaultBPMMemberResolver`, which answers with the member's own id (raw ids as
display names, empty emails) and warns outside `development` / `test`. That is
a placeholder to keep a new host booting, not an identity system.

There is no mock auth fallback in `@rytass/bpm-core-nestjs-module`. The test accounts in `apps/api` are DB-backed wrapper-app simulation data in `api_test_members`, seeded by `pnpm demo:reset` / `pnpm staging:reset`, and are not part of the reusable BPM module.

## Development

Normal local runtime:

```bash
pnpm api
pnpm client
```

Use `pnpm demo:reset` before local scenario testing when the develop schema
needs a clean Taiwan manufacturing seed.

Normal verification:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm e2e:client
```

Nest 12 ships as ESM. Jest loads it through `require()` only under
`--experimental-vm-modules`, which the committed root `.env.test` sets for every
`test` target (nx loads it). Without it every backend suite fails with "Must use
import to load ES Module". Keep secrets out of that file. nx never overrides
a variable already in the environment, so a shell or runner that sets its own
`NODE_OPTIONS` masks it; append the flag there instead, as `ci.yml` does.

`docker compose` is not required for normal development. Use Vault-backed develop secrets and `bpm_core/develop` unless the user explicitly asks otherwise.

Beyond the database, every runtime secret is optional. `API_SESSION_SECRET`
and `BPM_ATTACHMENT_SIGNING_SECRET` fall back to a random per-process key under
`NODE_ENV=production` (with a stderr warning), and an unset
`BPM_API_PUBLIC_URL` builds attachment URLs from the request origin. Set the two
secrets anyway on any deployment that runs more than one replica or must keep
sessions across a restart; the API host passes the BPM attachment values into
`BPMRootModule`.

## Dependency Overrides

Security fixes for transitive dependencies live in `pnpm-workspace.yaml`
`overrides`. **Always write them as a `^` range, never as an exact version.**
The one deliberate `~` is `next`, which keeps the 16.4 minor the root pins (see
the comment beside it).

An exact pin stops pnpm taking the next patch, so an override added to fix one
advisory silently becomes the thing holding a known-vulnerable version in
place. That is not hypothetical: `axios@1.15.2`, `postcss@8.5.10`,
`fast-uri@3.1.2` and `brace-expansion@5.0.5` each sat one patch below their fix
and accounted for 29 of the repository's open alerts before being converted to
ranges.

Some overrides exist to force a **single copy** rather than to raise a floor.
Keep them, and keep the whole `@nx/*` set on the same version as `nx`.

The mechanism to understand before running `pnpm update`: the published libs
declare deliberately **open** peer ranges (`@nestjs/core: >=10.0.0`,
`graphql: >=16.0.0`, `reflect-metadata: >=0.1.13`, `ai: >=6.0.0`,
`@mezzanine-ui/react: >=1.0.0`, `pdfjs-dist: ^5.4.296 || ^6.3.289`) so hosts on a range of
versions can consume them — and `autoInstallPeers: true` resolves every one of
those peers to whatever is **newest**. A `pnpm update` therefore installs a
second copy of anything whose latest release has moved past the version the
workspace itself picked. Each single-copy override below exists because that
happened:

| package | what two copies broke |
| ------------------------- | ---------------------------------------------- |
| `typeorm` | two unrelated `TypeOrmModuleOptions` types |
| `next` | `bpm-core-react`'s peer resolved against the eslint config's older copy |
| `reflect-metadata` | 0.1.14 + 0.2.2 gave `@nestjs/core` two snapshots, so two `ModuleRef` classes — every module injecting one failed to resolve it |
| `@nestjs/*` | Nest 12 installed beside the workspace's 11 |
| `graphql` | 17 installed while every `@nestjs/graphql` plugin still expects 16 |
| `pdfjs-dist` | `PDFDocumentProxy` and react-pdf's `DocumentCallback` became unrelated types, and two PDF workers would ship |
| `@mezzanine-ui/*` | two React contexts and two stylesheets; providers stop matching the components under them |
| `ai` / `@ai-sdk/*` | ai 7 / @ai-sdk 4 installed beside the assistant's 6 / 3 |
| `@rytass/secret-adapter-vault-nestjs` | two `VaultService` classes; `apps/api` injects one into `TypeOrmModule.forRootAsync` and gets the other tree's |

Only `pdfjs-dist` and `@mezzanine-ui/*` are exact pins, and they mirror pins the
app already makes deliberately — react-pdf itself depends on `pdfjs-dist`
exactly. Move those with the app's own pins, never on their own.

**After any `pnpm update`, check for new copies, not just that it built.**
Typechecking passes through some of these; the Nest one only showed up because
`bpm-root.module.boot.spec.ts` instantiates the whole module graph. Compare
`git show HEAD:pnpm-lock.yaml` against the new one for packages that gained a
version.

CI reports `pnpm audit` on every run and fails only on `critical`. A blocking
`high` gate would be permanently red — `image-size`, reached through
`@nx/webpack > less`, has no published fix — and a permanently red gate stops
being read. Nothing is suppressed into an allowlist; the outstanding findings
stay visible in the log.

## Dev Supervisor 控制通道（`pnpm dev:ctl`）

在使用者已自行啟動 `pnpm dev` 的前提下，agent 改完程式碼後**應主動**用
`pnpm dev:ctl restart <api|client>` 重啟受影響的 service，依 exit code 判斷
結果；exit `3` 代表 dev server 沒在跑——請使用者執行 `pnpm dev`，agent
**不得**自行啟動。指令一覽、exit code 契約、失敗 `reason` 判讀（webpack
橫幅與 Next.js `⨯` 符號等 crash pattern）、`readinessConfidence` 與 client
lazy-compile 侷限，見 `operating-dev-supervisor` skill。

## Template Designer AI Assistant

The flow designer page ships an LLM chat assistant (`WorkflowChatDrawer`) that
drives the workflow **toolset** to draw/edit the flow from natural language. It
runs through the Next.js route `apps/client/src/app/api/chat/route.ts` (a one-line
re-export of `createWorkflowChatPOST` from `@rytass/bpm-core-react/next/workflow-chat-route`).
Tools have no server `execute` — every tool call is executed in the browser via
`useWorkflowDesignerController.executeTool`, so the assistant can only do what a
user can do on that page (other requests are declined by the system prompt).

The feature is **opt-in and hidden by default** at the lib level. The designer
page shim shows it only when `BPM_AI_ASSISTANT_ENABLED=true`; without
`OPENAI_API_KEY` the toggle is shown disabled as a placeholder. `TemplateDesignerView`
also accepts `showAiAssistant` / `aiAssistantAvailable` props for direct control.

Next.js server env (the client host, not `apps/api`), in `apps/client/.env.local`:
- `BPM_AI_ASSISTANT_ENABLED` — `'true'` to show the assistant (default hidden).
- `OPENAI_API_KEY` — OpenAI key (server-only, never `NEXT_PUBLIC_`). The route
  talks to OpenAI directly via `@ai-sdk/openai` — no Vercel AI Gateway.
- `BPM_LLM_MODEL` — optional OpenAI model id; defaults to `gpt-5.4-mini`.
- `BPM_TEMPLATE_DRY_RUN_ENABLED` — set to `'false'` to hide the designer's
  "試跑流程" (dry-run) button (shown by default). `TemplateDesignerView` also
  accepts a `showDryRun` prop for direct control.
