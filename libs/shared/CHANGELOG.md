## 0.21.2 (2026-11-12)

### 🩹 Fixes

- **designer:** show the initiator-manager hint only where it applies ([24463a9c](https://github.com/Rytass/BPMCore/commit/24463a9c))
- **designer:** warn when a manager chain away from the initiator may reach them ([801f63c6](https://github.com/Rytass/BPMCore/commit/801f63c6))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.21.1 (2026-11-11)

### 🚀 Features

- **workflow-engine:** judge the launchable list with the initiator customFields resolver ([92faedec](https://github.com/Rytass/BPMCore/commit/92faedec))
- **react:** read the designer's today in the host organization time zone ([9a31ff90](https://github.com/Rytass/BPMCore/commit/9a31ff90))
- **shared:** add the default organization time zone constant ([3dac42de](https://github.com/Rytass/BPMCore/commit/3dac42de))
- **workflow-engine:** refuse a submit or resubmit holding more files than maxFiles ([abf75d2f](https://github.com/Rytass/BPMCore/commit/abf75d2f))
- **shared:** tell which stages can start a manager chain with exactly one person ([6afc0c2d](https://github.com/Rytass/BPMCore/commit/6afc0c2d))
- **shared:** let a manager chain start from a form pick or an earlier stage ([d181c1e8](https://github.com/Rytass/BPMCore/commit/d181c1e8))
- **shared:** add excludeNodeActors to user task nodes ([0d6c5c42](https://github.com/Rytass/BPMCore/commit/0d6c5c42))
- **react:** ask for the approval comment in the designer and on the approve dialog ([f80aaf04](https://github.com/Rytass/BPMCore/commit/f80aaf04))
- **shared:** add setUserTaskRequireApprovalComment command and AI tool ([efe41c94](https://github.com/Rytass/BPMCore/commit/efe41c94))
- **workflow-engine:** require a comment when a person approves at a node ([84474780](https://github.com/Rytass/BPMCore/commit/84474780))

### 🩹 Fixes

- **shared:** count excludeNodeActors handing over to the initiator's managers as multiple approvers ([6c5e7de6](https://github.com/Rytass/BPMCore/commit/6c5e7de6))
- **bpm-core:** build one workflow engine so every caller sees the host resolver ([3e172843](https://github.com/Rytass/BPMCore/commit/3e172843))
- **workflow-engine:** time out the initiator customFields resolver and keep its errors server-side ([45ff109d](https://github.com/Rytass/BPMCore/commit/45ff109d))
- **react:** say ad-hoc approvers are not excluded in the excludeNodeActors hint ([815a89c4](https://github.com/Rytass/BPMCore/commit/815a89c4))
- **shared:** refuse a manager chain notify recipient without a whole-number level ([cdca8b1e](https://github.com/Rytass/BPMCore/commit/cdca8b1e))
- **workflow-engine:** count a repeated file_upload id once, as the binding does ([d75adb5c](https://github.com/Rytass/BPMCore/commit/d75adb5c))
- **shared:** keep manager chain level and stage ids as written ([1c741259](https://github.com/Rytass/BPMCore/commit/1c741259))
- **shared:** require an organization for a notify ORG_UNIT_MANAGER recipient ([1d348b84](https://github.com/Rytass/BPMCore/commit/1d348b84))
- **workflow-engine:** hold a set-form-field write to member and unit value shapes ([c9d0523c](https://github.com/Rytass/BPMCore/commit/c9d0523c))
- **shared:** quote the start-level schema line so the INITIATOR example compiles ([f0e64cf9](https://github.com/Rytass/BPMCore/commit/f0e64cf9))
- **shared:** keep any start level the toolset is handed so validation reports it ([ca7e762f](https://github.com/Rytass/BPMCore/commit/ca7e762f))
- **shared:** let the policy decide when a lone listed member may hand over to the initiator manager ([418b192b](https://github.com/Rytass/BPMCore/commit/418b192b))
- **shared:** keep a chain start and start level the toolset cannot read so validation reports them ([2ed228a9](https://github.com/Rytass/BPMCore/commit/2ed228a9))
- **shared:** keep the chain start when the toolset rewrites an approver ([71e3e1e7](https://github.com/Rytass/BPMCore/commit/71e3e1e7))
- **shared:** name a start without a type in words and read a fractional start level back ([02b86146](https://github.com/Rytass/BPMCore/commit/02b86146))
- **shared:** say parallel-branch stages are unsupported in excludeNodeActors hints ([ea6f5efa](https://github.com/Rytass/BPMCore/commit/ea6f5efa))
- **shared:** describe what a skipped exclusion stage reads ([6c62b03f](https://github.com/Rytass/BPMCore/commit/6c62b03f))
- **shared:** describe the stage rule in the excludeNodeActors tool and read a broken nodeIds safely ([c7a67f79](https://github.com/Rytass/BPMCore/commit/c7a67f79))
- **shared:** hold every excludeNodeActors stage to the NODE_ACTOR source rules ([d16f216a](https://github.com/Rytass/BPMCore/commit/d16f216a))
- **react:** harden the notify recipient panel after review ([17fab8db](https://github.com/Rytass/BPMCore/commit/17fab8db))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.21.0 (2026-11-11)

### 🚀 Features

- **bpm-core-react:** place refused fill values on their fields by path ([0f26687](https://github.com/Rytass/BPMCore/commit/0f26687))
- **bpm-core-client:** expose refused form values on request errors ([3a5d406](https://github.com/Rytass/BPMCore/commit/3a5d406))
- **shared:** add structured form data issue contract ([827e26d](https://github.com/Rytass/BPMCore/commit/827e26d))
- **client:** add a filterable expense example list built on field filters ([3d624fb](https://github.com/Rytass/BPMCore/commit/3d624fb))
- **react:** filterable toggle in the form builder and list field filters ([e8d58bf](https://github.com/Rytass/BPMCore/commit/e8d58bf))
- **client:** pass field filters and sort to the approval-instance list ([bbfd789](https://github.com/Rytass/BPMCore/commit/bbfd789))
- **workflow-engine:** filter and sort approval instances by form fields ([6e4a98f](https://github.com/Rytass/BPMCore/commit/6e4a98f))
- **template:** refuse to enable a filterable field over conflicting history ([42628b4](https://github.com/Rytass/BPMCore/commit/42628b4))
- **shared:** declare filterable form fields and the field filter contract ([166389e](https://github.com/Rytass/BPMCore/commit/166389e))
- **api:** add a staging notify webhook showcase pushed over SSE ([0cb3ea5](https://github.com/Rytass/BPMCore/commit/0cb3ea5))

### 🩹 Fixes

- **client:** read form data issues all or nothing ([c0e4281](https://github.com/Rytass/BPMCore/commit/c0e4281))
- **shared:** name the table, not a column, for a malformed filterable table ([c4b0420](https://github.com/Rytass/BPMCore/commit/c4b0420))
- **shared:** describe filterable value mismatches in Chinese ([afd27a7](https://github.com/Rytass/BPMCore/commit/afd27a7))
- **client:** name data-source values in case titles from the option snapshot ([14ade77](https://github.com/Rytass/BPMCore/commit/14ade77))
- **shared:** narrow the self-approval flag with typeof in the resolver fallback parser ([19497cf](https://github.com/Rytass/BPMCore/commit/19497cf))

### 🔥 Performance

- **template:** scan instances only for fields a publish newly makes filterable ([b18dda2](https://github.com/Rytass/BPMCore/commit/b18dda2))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.20.1 (2026-11-10)

### 🩹 Fixes

- **workflow-graph:** read a multiple-selection "" as unfilled ([298753a](https://github.com/Rytass/BPMCore/commit/298753a))
- **workflow-graph:** guard designer conditions against absent form keys ([a3d2cb6](https://github.com/Rytass/BPMCore/commit/a3d2cb6))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.20.0 (2026-11-08)

### 🚀 Features

- **workflow-chat:** require a BPM API session for /api/chat ([9906851](https://github.com/Rytass/BPMCore/commit/9906851))
- ⚠️  **form-data-source:** pass a binding's position explicitly and lint NOTIFY expressions ([9987b12](https://github.com/Rytass/BPMCore/commit/9987b12))
- **form-data-source:** bind DataSource and webhook parameters to expressions ([c2b18d3](https://github.com/Rytass/BPMCore/commit/c2b18d3))
- **designer:** write, preview and upgrade expressions in the designer ([ec36bb7](https://github.com/Rytass/BPMCore/commit/ec36bb7))
- **template:** lint expressions against their AST at publish ([61d07f5](https://github.com/Rytass/BPMCore/commit/61d07f5))
- **expression-function:** register host and built-in functions ([f8763b4](https://github.com/Rytass/BPMCore/commit/f8763b4))
- **expression-function:** define the function registry contract ([31e7e16](https://github.com/Rytass/BPMCore/commit/31e7e16))
- **condition:** evaluate expressions under a budget with sanitized errors ([38ef1f8](https://github.com/Rytass/BPMCore/commit/38ef1f8))

### 🩹 Fixes

- **form-data-source:** take a new pick over an expired EXPRESSION value ([3499115](https://github.com/Rytass/BPMCore/commit/3499115))
- **condition:** check cel-v2 function argument types and log engine warm-up ([0834758](https://github.com/Rytass/BPMCore/commit/0834758))
- **workflow-engine:** send webhooks after the transaction commits ([d74aba6](https://github.com/Rytass/BPMCore/commit/d74aba6))

### ⚠️  Breaking Changes

- **form-data-source:** pass a binding's position explicitly and lint NOTIFY expressions  ([9987b12](https://github.com/Rytass/BPMCore/commit/9987b12))
  FormDataSourceService.searchFormFieldOptions takes a
  required position instead of optional rowValues, and the
  NotifyWebhookBindingSource union gains an EXPRESSION member, so an
  exhaustive switch over from.kind needs a new case.

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.19.0 (2026-11-04)

### 🩹 Fixes

- **bpm-core:** read form attachments from file_upload fields only ([e9cd71a](https://github.com/Rytass/BPMCore/commit/e9cd71a))
- **bpm-core-react:** list file_upload files as the host holds them, in pick order ([20bf634](https://github.com/Rytass/BPMCore/commit/20bf634))
- **bpm-core:** refuse a form attachment the case may not take ([4710a23](https://github.com/Rytass/BPMCore/commit/4710a23))
- **bpm-core:** bind a free attachment only for the members who file the case ([ecd9d76](https://github.com/Rytass/BPMCore/commit/ecd9d76))
- **bpm-core-react:** list every attachment a file_upload value holds ([da7ee9b](https://github.com/Rytass/BPMCore/commit/da7ee9b))
- **bpm-core:** release form attachments a resubmit no longer refers to ([2580381](https://github.com/Rytass/BPMCore/commit/2580381))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.18.1 (2026-11-01)

### 🚀 Features

- add form-field and prior-node approver sources ([#132](https://github.com/Rytass/BPMCore/pull/132))

### 🩹 Fixes

- **bpm-core-react:** fill timeline rows only from their own decision ([f336c1d](https://github.com/Rytass/BPMCore/commit/f336c1d))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang @coollugi

## 0.18.0 (2026-10-28)

### 🚀 Features

- **bpm-core-client:** check text field formats in a Web Worker ([a3c3d65](https://github.com/Rytass/BPMCore/commit/a3c3d65))
- **shared:** detect text formats that repeat a repeating group ([5a18fc7](https://github.com/Rytass/BPMCore/commit/5a18fc7))
- **bpm-core-react:** name text length and format errors on the case pages ([074d4b9](https://github.com/Rytass/BPMCore/commit/074d4b9))
- **shared:** check text length and format with one shared rule ([a38127d](https://github.com/Rytass/BPMCore/commit/a38127d))
- **shared:** add the setUserTaskReturnAllowedTargets command ([ded2690](https://github.com/Rytass/BPMCore/commit/ded2690))
- **shared:** list the nodes a return to a chosen node may go to ([306ac32](https://github.com/Rytass/BPMCore/commit/306ac32))

### 🩹 Fixes

- **bpm-core:** ask the directory only about delegation rules in scope ([022304e](https://github.com/Rytass/BPMCore/commit/022304e))
- **bpm-core:** hold service-task text writes to the field's rules ([fcde1df](https://github.com/Rytass/BPMCore/commit/fcde1df))
- **bpm-core-react:** check formats off the main thread on the case pages ([58a1a9d](https://github.com/Rytass/BPMCore/commit/58a1a9d))
- **bpm-core:** keep the directory's error out of the delegation refusal ([14ccd0e](https://github.com/Rytass/BPMCore/commit/14ccd0e))
- **bpm-core:** refuse to dispatch when the delegation directory lookup fails ([8ef8a88](https://github.com/Rytass/BPMCore/commit/8ef8a88))
- **shared:** refuse a text pattern whose parentheses close the anchoring early ([330ef06](https://github.com/Rytass/BPMCore/commit/330ef06))
- **bpm-core:** check the type of a text field whose visibleWhen is false ([b256040](https://github.com/Rytass/BPMCore/commit/b256040))
- **bpm-core:** share one pattern time budget per validation pass ([8f81919](https://github.com/Rytass/BPMCore/commit/8f81919))
- **shared:** refuse every repeated group in a text field pattern ([d0daa77](https://github.com/Rytass/BPMCore/commit/d0daa77))
- **shared:** refuse repeated alternations whose branches can start alike ([5e6e12e](https://github.com/Rytass/BPMCore/commit/5e6e12e))
- **shared:** report a non-text value on a text field that has rules ([41eac23](https://github.com/Rytass/BPMCore/commit/41eac23))
- **shared:** keep a later stage that loops back out of the return targets ([86c2fd0](https://github.com/Rytass/BPMCore/commit/86c2fd0))

### 🔥 Performance

- **shared:** walk return targets over adjacency maps ([a56de04](https://github.com/Rytass/BPMCore/commit/a56de04))
- **shared:** compile each text field pattern once and reuse it ([7410ba6](https://github.com/Rytass/BPMCore/commit/7410ba6))
- **bpm-core:** ask the host directory once per node when resolving delegation ([cb62b00](https://github.com/Rytass/BPMCore/commit/cb62b00))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.9 (2026-10-27)

This was a version bump only for shared to align it with other projects, there were no code changes.

## 0.17.8 (2026-10-22)

### 🩹 Fixes

- **bpm-core-react:** re-enable the instance header actions after a decision ([70e1a92](https://github.com/Rytass/BPMCore/commit/70e1a92))
- **bpm-core-react:** open the field overview on every field when nothing is set ([f90188d](https://github.com/Rytass/BPMCore/commit/f90188d))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.17.7 (2026-10-22)

### 🚀 Features

- **bpm-core-react:** add the field access overview to the template designer ([1de7665](https://github.com/Rytass/BPMCore/commit/1de7665))
- **shared:** add the field access matrix and its commands ([b0a9aa3](https://github.com/Rytass/BPMCore/commit/b0a9aa3))
- **bpm-core-react:** let the fill node's approver fill in fields on the case page ([9cd9eb2](https://github.com/Rytass/BPMCore/commit/9cd9eb2))
- **bpm-core:** flag tasks whose node lets the approver fill in fields ([57f1d61](https://github.com/Rytass/BPMCore/commit/57f1d61))
- **bpm-core-react:** resolve per-field access for the instance viewer ([7cd040c](https://github.com/Rytass/BPMCore/commit/7cd040c))
- **bpm-core:** adopt fieldAccess node model per ADR 20 ([b25cf71](https://github.com/Rytass/BPMCore/commit/b25cf71))
- **bpm-core-client:** send approver-filled data and keep it off launch and resubmit forms ([a33d7f9](https://github.com/Rytass/BPMCore/commit/a33d7f9))
- **bpm-core:** refuse conditions that read approver-filled fields too early ([5ad995f](https://github.com/Rytass/BPMCore/commit/5ad995f))
- **bpm-core:** refuse form rules that clash with approver-filled fields ([a55253e](https://github.com/Rytass/BPMCore/commit/a55253e))
- **bpm-core:** refuse to publish field permissions the engine cannot honour ([7361a9e](https://github.com/Rytass/BPMCore/commit/7361a9e))
- **bpm-core:** flag task notifications that need the form opened ([77fd492](https://github.com/Rytass/BPMCore/commit/77fd492))
- **bpm-core:** let the filling node write approver-filled fields on approval ([502500c](https://github.com/Rytass/BPMCore/commit/502500c))
- **shared:** add field permission helpers for approver-filled fields ([6386b1c](https://github.com/Rytass/BPMCore/commit/6386b1c))

### 🩹 Fixes

- **shared:** read a SET_FORM_FIELD path the way the engine writes it ([3ba2962](https://github.com/Rytass/BPMCore/commit/3ba2962))
- **bpm-core-react:** send only the fill fields the approver changed ([1250eac](https://github.com/Rytass/BPMCore/commit/1250eac))
- **template:** stop rethrowing designer save and publish errors ([af93e67](https://github.com/Rytass/BPMCore/commit/af93e67))
- **bpm-core-client:** update launch mocks for the template version definition ([452d600](https://github.com/Rytass/BPMCore/commit/452d600))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.6 (2026-10-20)

This was a version bump only for shared to align it with other projects, there were no code changes.

## 0.17.5 (2026-10-20)

### 🚀 Features

- **workflow-engine:** record the write order of activity logs ([d3a946a](https://github.com/Rytass/BPMCore/commit/d3a946a))

### 🩹 Fixes

- **organization:** open only the designer's three organization reads ([28b5146](https://github.com/Rytass/BPMCore/commit/28b5146))
- **workflow-engine:** read activity logs in write order ([4b9865f](https://github.com/Rytass/BPMCore/commit/4b9865f))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.4 (2026-10-19)

### 🚀 Features

- **form:** translate DataSource error copy per language ([787e7a3](https://github.com/Rytass/BPMCore/commit/787e7a3))

### 🩹 Fixes

- **shared:** compile multiple-selection conditions with list semantics ([c9c7782](https://github.com/Rytass/BPMCore/commit/c9c7782))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.3 (2026-10-19)

### 🚀 Features

- **react:** add a BPM message language provider ([355b15c](https://github.com/Rytass/BPMCore/commit/355b15c))
- **template:** translate publish lint lines per language ([60fa7bc](https://github.com/Rytass/BPMCore/commit/60fa7bc))
- **client:** translate structural publish-lint lines into designer copy ([490339c](https://github.com/Rytass/BPMCore/commit/490339c))

### 🩹 Fixes

- **client:** cover blank node labels and never throw while translating lint ([0a8b3af](https://github.com/Rytass/BPMCore/commit/0a8b3af))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.2 (2026-10-18)

### 🚀 Features

- **client:** add notification sync wrappers ([c89d759](https://github.com/Rytass/BPMCore/commit/c89d759))
- **notification:** page and sync notifications without rescanning ([f03f981](https://github.com/Rytass/BPMCore/commit/f03f981))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.17.1 (2026-10-16)

### 🩹 Fixes

- **react:** give the require condition CommonJS declarations ([ab0121b](https://github.com/Rytass/BPMCore/commit/ab0121b))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.17.0 (2026-10-15)

### 🚀 Features

- ⚠️  **workflow-engine:** end SLA-terminated instances as EXPIRED ([7dcca4e](https://github.com/Rytass/BPMCore/commit/7dcca4e))
- **template:** allow lastDecision in edge conditions ([e8b4788](https://github.com/Rytass/BPMCore/commit/e8b4788))
- **workflow-engine:** add administrator in-place task reassignment ([02ce920](https://github.com/Rytass/BPMCore/commit/02ce920))
- **toolset:** accept POSITION fallbacks in the assistant toolset ([7d0ddff](https://github.com/Rytass/BPMCore/commit/7d0ddff))
- **shared:** add POSITION approver fallback type ([2744b99](https://github.com/Rytass/BPMCore/commit/2744b99))
- ⚠️  **organization:** retire org units into a successor unit ([514e0b2](https://github.com/Rytass/BPMCore/commit/514e0b2))

### 🩹 Fixes

- **migrations:** check pg_trgm with the other required extensions ([30a1e58](https://github.com/Rytass/BPMCore/commit/30a1e58))
- **template:** check CEL roots per call site on publish ([868d236](https://github.com/Rytass/BPMCore/commit/868d236))
- ⚠️  **delegation:** order rules by priority, higher first ([96cca55](https://github.com/Rytass/BPMCore/commit/96cca55))
- **toolset:** read manager fallbacks and keep them across rewrites ([099b72f](https://github.com/Rytass/BPMCore/commit/099b72f))

### ⚠️  Breaking Changes

- **workflow-engine:** end SLA-terminated instances as EXPIRED  ([7dcca4e](https://github.com/Rytass/BPMCore/commit/7dcca4e))
  an instance ended by SLA `TERMINATE_INSTANCE` is now
  `EXPIRED` instead of `CANCELLED`, and its activity log is
  `INSTANCE_EXPIRED` with a null actor instead of `INSTANCE_CANCELLED` in
  the initiator's name. Instances terminated before this change stay
  CANCELLED. A host implementing `BPMWorkflowEngineService` itself must add
  `expireApprovalInstance`.
- **delegation:** order rules by priority, higher first  ([96cca55](https://github.com/Rytass/BPMCore/commit/96cca55))
  when several active delegation rules of one principal
  match a task, the rule with the highest priority now applies instead of
  the oldest. No data migration is needed: priority had no effect before,
  but principals with overlapping rules may now be delegated differently,
  so review their priorities.
- **organization:** retire org units into a successor unit  ([514e0b2](https://github.com/Rytass/BPMCore/commit/514e0b2))
  deleteOrgUnit now also refuses a unit that has no open
  memberships but still has an open ORG_UNIT-scoped manager rule; it used to
  retire it and leave the rule silently dormant. Pass transferToOrgUnitId (or
  end the rule first) to retire such a unit. The refusal message keeps its
  leading "Org unit with memberships cannot be deleted" sentence.

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.16.2 (2026-10-14)

### 🚀 Features

- **react:** support react-pdf 11 and pdfjs-dist 6 in the PDF preview ([ab7f3ca](https://github.com/Rytass/BPMCore/commit/ab7f3ca))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.16.0 (2026-10-13)

### 🚀 Features

- ⚠️  **attachment:** boot without attachment settings ([808bc65](https://github.com/Rytass/BPMCore/commit/808bc65))

### ⚠️  Breaking Changes

- **attachment:** boot without attachment settings  ([808bc65](https://github.com/Rytass/BPMCore/commit/808bc65))
  BPMResolvedAttachmentOptions.publicBaseUrl is
  string | null, DEFAULT_BPM_ATTACHMENT_OPTIONS no longer carries a
  signedUrlSecret, and attachmentAllowInsecureSignedUrlSecret is
  deprecated and ignored. A host running more than one API replica must
  set a shared attachmentSignedUrlSecret, since a generated one only
  verifies on the process that signed the URL.
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5.5

## 0.15.0 (2026-10-13)

### ⚠️  Breaking Changes

- **workflow-engine / organization:** the engine now reads "today" in the organization time zone (`organizationTimeZone`, default `Asia/Taipei`) instead of UTC. For a membership or manager rule whose `effectiveFrom` / `effectiveTo` is today, approver resolution applies or retires it from local midnight — up to eight hours earlier than before in UTC+8. A host whose organization dates are kept in UTC sets `organizationTimeZone: 'UTC'` before upgrading. Running instances keep their tasks. ([d6e43f3](https://github.com/Rytass/BPMCore/commit/d6e43f3); this note was missing from the generated changelog because the footer sits on a `docs:` commit)
- **template:** publishing now refuses a `DYNAMIC_FORM` resolver whose member field can be left empty — the field must be `required`, not `hidden`, and have no `visibleWhen`. Drafts still save; versions already published are not re-validated. ([b3a3950](https://github.com/Rytass/BPMCore/commit/b3a3950))

### 🗄️ Upgrade

- New migrations add nullable columns and indexes only; no data is dropped. Hosts run with `migrationsRun: false`, so **run the migrations before deploying 0.15.0**.

### 🚀 Features

- **forms:** add store-only hidden fields and link display for text fields ([ae38a92](https://github.com/Rytass/BPMCore/commit/ae38a92))
- **designer:** pick approvers from a member field and show readable dry-run assignees ([bc9592e](https://github.com/Rytass/BPMCore/commit/bc9592e))
- **forms:** add a member field type ([0fca8d4](https://github.com/Rytass/BPMCore/commit/0fca8d4))

### 🩹 Fixes

- **template-designer:** name a member-field dry-run assignee by its field label ([465fcc3](https://github.com/Rytass/BPMCore/commit/465fcc3))
- **template-designer:** sample a dry-run member field with a placeholder, not the initiator ([b567e41](https://github.com/Rytass/BPMCore/commit/b567e41))
- **template:** refuse a DYNAMIC_FORM resolver on a member field that can be left empty ([b3a3950](https://github.com/Rytass/BPMCore/commit/b3a3950))
- **shared:** freeze the default manager resolver every new node shares ([281aeb2](https://github.com/Rytass/BPMCore/commit/281aeb2))
- **organization:** default organizationTimeZone to Asia/Taipei ([cc6b908](https://github.com/Rytass/BPMCore/commit/cc6b908))
- **forms:** harden hidden fields and link display after review ([9ce1f82](https://github.com/Rytass/BPMCore/commit/9ce1f82))
- **workflow-engine:** index the submitter column that the sent list now matches ([557f458](https://github.com/Rytass/BPMCore/commit/557f458))
- **workflow-engine:** leave out the refusals of seats the initiator exclusion removes ([959912e](https://github.com/Rytass/BPMCore/commit/959912e))
- **workflow-engine:** harden business key lookup and count its length in characters ([844ce82](https://github.com/Rytass/BPMCore/commit/844ce82))
- **forms:** keep member ids out of case titles and check member references on publish ([2b3c9c0](https://github.com/Rytass/BPMCore/commit/2b3c9c0))
- **shared:** default new nodes to the initiator's manager instead of a placeholder member id ([e2aed61](https://github.com/Rytass/BPMCore/commit/e2aed61))

### 🔥 Performance

- **notification:** name the submitter at submit instead of inside the approval transaction ([da64763](https://github.com/Rytass/BPMCore/commit/da64763))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5.5
- Kai-Chieh Yang

## 0.14.0 (2026-10-12)

### 🚀 Features

- **workflow-engine:** sign manager chains in order and keep the initiator out of re-delegation ([6eaf1e6](https://github.com/Rytass/BPMCore/commit/6eaf1e6))
- **designer:** offer SEQUENTIAL again and show signing order in task views ([ed38d04](https://github.com/Rytass/BPMCore/commit/ed38d04))
- ⚠️  **workflow-engine:** make SEQUENTIAL sign one candidate at a time ([70e9cde](https://github.com/Rytass/BPMCore/commit/70e9cde))
- **designer:** configure initiator exclusion on user task nodes ([b7b51cd](https://github.com/Rytass/BPMCore/commit/b7b51cd))
- **workflow-engine:** let a user task exclude the initiator from its approvers ([a4c6e51](https://github.com/Rytass/BPMCore/commit/a4c6e51))
- **designer:** configure the ORG_MANAGER_CHAIN resolver in the template designer ([ab64fe4](https://github.com/Rytass/BPMCore/commit/ab64fe4))
- **workflow-engine:** add ORG_MANAGER_CHAIN resolver that walks up to a position level ([001af84](https://github.com/Rytass/BPMCore/commit/001af84))

### 🩹 Fixes

- **workflow-engine:** reopen a rejected pre-approval for its requester on sequential tasks ([2cf8004](https://github.com/Rytass/BPMCore/commit/2cf8004))
- **designer:** show the signing order and turn hand-offs in the instance timeline ([7ade44a](https://github.com/Rytass/BPMCore/commit/7ade44a))
- **workflow-engine:** re-delegate on activation, anchor the SLA warning and give consumers a turn signal ([f50c781](https://github.com/Rytass/BPMCore/commit/f50c781))
- **toolset:** show initiator exclusion in node summaries ([5ea8ea5](https://github.com/Rytass/BPMCore/commit/5ea8ea5))
- **workflow-engine:** filter the initiator before dedupe and keep exclusion nodes completable ([5a6570a](https://github.com/Rytass/BPMCore/commit/5a6570a))
- **designer:** explain the chain policy switch and keep the chain fallback in the toolset ([743df14](https://github.com/Rytass/BPMCore/commit/743df14))
- **workflow-engine:** let ORG_MANAGER_CHAIN climb past unit heads under org-unit rules ([5baa2e6](https://github.com/Rytass/BPMCore/commit/5baa2e6))
- **workflow-engine:** scope the transfer re-point to pre-approvals on the origin node ([70d99d7](https://github.com/Rytass/BPMCore/commit/70d99d7))

### ⚠️  Breaking Changes

- **workflow-engine:** make SEQUENTIAL sign one candidate at a time  ([70e9cde](https://github.com/Rytass/BPMCore/commit/70e9cde))
  the SEQUENTIAL decision policy used to behave exactly like
  PARALLEL_ALL (every candidate got the task at once). It now means what its
  name says: candidates sign one after another, in the order the approver
  resolver returned them.
  - task_candidates gains a nullable `sequence` column (migration
    0000000025000-task-candidate-sequence) and a WAITING status for candidates
    whose turn has not come. Only the first candidate is PENDING, assigned and
    notified; an approval activates the next one (fresh SLA window, a
    TASK_CANDIDATE_ACTIVATED activity log, a new assignment notification).
  - A WAITING candidate who tries to decide gets a ConflictException.
  - Reject, return and instance cancellation close the WAITING candidates too.
  - Transferring (including SLA escalation) keeps the SEQUENTIAL policy and
    carries the remaining WAITING candidates to the replacement task.
  - TASK_CREATED lists only the active candidate in candidateMemberIds and adds
    sequentialCandidateMemberIds with the full order.
  - Candidates are read ordered by sequence, unordered ones last.
  SEQUENTIAL tasks created before this change keep their old behaviour: their
  candidates are all PENDING with a NULL sequence and nothing is backfilled.
  PARALLEL_*, QUORUM, ad-hoc tasks and dry run are unchanged.
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01C3u1QC5Uo4tZvyTaJE6Gap

### ❤️ Thank You

- Claude Opus 5.5
- Kai-Chieh Yang

## 0.13.5 (2026-10-12)

### 🩹 Fixes

- **deps:** patch critical advisories in next, handlebars, proxy-addr and shell-quote ([c58a51a](https://github.com/Rytass/BPMCore/commit/c58a51a))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.13.4 (2026-09-17)

### 🚀 Features

- **admin:** add the webhook endpoints page ([ac03c59](https://github.com/Rytass/BPMCore/commit/ac03c59))
- **client:** add webhook endpoint administration API ([0fa9c2a](https://github.com/Rytass/BPMCore/commit/0fa9c2a))
- **workflow-webhook:** manage notify webhook endpoints in the database ([63e2f95](https://github.com/Rytass/BPMCore/commit/63e2f95))
- **client:** add the webhook endpoint catalog query ([9e2c927](https://github.com/Rytass/BPMCore/commit/9e2c927))
- **instance-detail:** show webhook deliveries to administrators ([4e1e3c1](https://github.com/Rytass/BPMCore/commit/4e1e3c1))
- **client:** add webhook delivery listing and retry ([89387ae](https://github.com/Rytass/BPMCore/commit/89387ae))
- **workflow-webhook:** let administrators inspect and retry deliveries ([4a6128b](https://github.com/Rytass/BPMCore/commit/4a6128b))
- **workflow-webhook:** deliver notify webhooks through a transactional outbox ([cbb277f](https://github.com/Rytass/BPMCore/commit/cbb277f))
- **workflow-webhook:** add the endpoint registry, catalog and allowlist ([82afe97](https://github.com/Rytass/BPMCore/commit/82afe97))
- **workflow:** add the notify webhook contract to the shared lib ([e240632](https://github.com/Rytass/BPMCore/commit/e240632))
- **bpm:** make every BPMRootModule option optional and async-loadable ([0966edb](https://github.com/Rytass/BPMCore/commit/0966edb))

### 🩹 Fixes

- **workflow-webhook:** harden the P1 catalog after independent review ([0ea9790](https://github.com/Rytass/BPMCore/commit/0ea9790))
- **workflow:** let the engine pick its service task dispatcher ([21bcde4](https://github.com/Rytass/BPMCore/commit/21bcde4))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.13.3 (2026-09-04)

This was a version bump only for shared to align it with other projects, there were no code changes.

## 0.13.2 (2026-09-04)

### 🩹 Fixes

- **organization:** stop a deleted org unit from burning its code forever ([0f6897f](https://github.com/Rytass/BPMCore/commit/0f6897f))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.13.1 (2026-09-04)

### 🩹 Fixes

- **release:** build before publishing, and follow the 0.x bump convention ([a41932a](https://github.com/Rytass/BPMCore/commit/a41932a))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.13.0 (2026-09-03)

This was a version bump only for shared to align it with other projects, there were no code changes.

## 0.12.0 (2026-08-27)

### 🚀 Features

- **form:** wire cell-level DataSources through the client and renderer ([c7561ad](https://github.com/Rytass/BPMCore/commit/c7561ad))
- **form:** resolve table column DataSources per cell ([ca40a4c](https://github.com/Rytass/BPMCore/commit/ca40a4c))
- **form:** add table column factories and row-scoped binding rename ([0c8c07d](https://github.com/Rytass/BPMCore/commit/0c8c07d))
- **form:** validate and seed table values in the renderer helpers ([5c7edab](https://github.com/Rytass/BPMCore/commit/5c7edab))
- **condition:** compile table emptiness from the row count ([624c96d](https://github.com/Rytass/BPMCore/commit/624c96d))
- **form:** add table field definitions to the shared contract ([5f97165](https://github.com/Rytass/BPMCore/commit/5f97165))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5 (1M context)

## 0.11.0 (2026-08-18)

### 🚀 Features

- **notification:** bound delivery dispatch with a timeout ([d8115f0](https://github.com/Rytass/BPMCore/commit/d8115f0))

### 🩹 Fixes

- **notification:** move nodemailer to ^9.0.1 ([e094738](https://github.com/Rytass/BPMCore/commit/e094738))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.10.0 (2026-08-18)

### 🚀 Features

- **form-data-source:** add read-only resolve queries and dependency-wait signals ([e8d9b78](https://github.com/Rytass/BPMCore/commit/e8d9b78))
- **template:** let hosts observe changes and refuse deactivated publishes ([3882dc2](https://github.com/Rytass/BPMCore/commit/3882dc2))
- **notification:** honour recipient preferences instead of dropping rows ([576b8c4](https://github.com/Rytass/BPMCore/commit/576b8c4))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.9.1 (2026-08-18)

### 🩹 Fixes

- **bpm-core-react:** keep moment a required dependency ([41dd5fa](https://github.com/Rytass/BPMCore/commit/41dd5fa))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.9.0 (2026-08-17)

### 🚀 Features

- **notification:** lift routing fields onto the created event ([e02270b](https://github.com/Rytass/BPMCore/commit/e02270b))
- **notification:** let a host observe notifications as they are created ([#21](https://github.com/Rytass/BPMCore/pull/21))
- **shared:** detect a quorum no approver set can ever satisfy ([5671497](https://github.com/Rytass/BPMCore/commit/5671497))
- **shared:** expose the decision policy to the workflow toolset ([f6152b0](https://github.com/Rytass/BPMCore/commit/f6152b0))
- **shared:** add a command for the user task decision policy ([9d719bb](https://github.com/Rytass/BPMCore/commit/9d719bb))

### 🩹 Fixes

- ⚠️  **template:** reject deleting a referenced category ([#16](https://github.com/Rytass/BPMCore/pull/16))
- **template:** let a template actually change category ([#17](https://github.com/Rytass/BPMCore/pull/17))
- **shared:** keep an approver change from discarding a workable policy ([ea6afbe](https://github.com/Rytass/BPMCore/commit/ea6afbe))
- **e2e:** poll on the expected value in the quorum threshold sanitiser spec ([099529f](https://github.com/Rytass/BPMCore/commit/099529f))
- **bpm-core-react:** correct decision-policy panel review findings ([ebf0337](https://github.com/Rytass/BPMCore/commit/ebf0337))

### ⚠️  Breaking Changes

- **template:** reject deleting a referenced category  ([#16](https://github.com/Rytass/BPMCore/pull/16))
  `deleteApprovalTemplateCategory` now throws
  `BadRequestException` when templates still reference the category, instead
  of deactivating it and reporting success.
  The old behaviour substituted a different operation for the one requested
  and returned the same entity type either way, so a caller could not tell
  that the delete had not happened — nor that `isActive` had been flipped as
  a side effect it never asked for. Downstream, the category vanished from
  groupings because it was now inactive, with nothing to explain why.
  Deactivation is not lost: `deactivateApprovalTemplateCategory(id)` has
  always existed and is unchanged, so the fallback was never the only way to
  reach that state.
  The designer's category screen already wraps the call in try/catch and
  surfaces the message, and it only closes the confirmation dialog on
  success, so the new error reaches the author without a UI change.
  Reported by a consumer on 0.7.0, who had to re-implement the reference
  check ahead of the call to avoid telling users something had been deleted
  when it had not.
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5
- Kai-Chieh Yang

## 0.7.0 (2026-08-10)

### 🚀 Features

- **shared:** add business-day SLA and required return comment contracts ([584acd7](https://github.com/Rytass/BPMCore/commit/584acd7))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5 (1M context)

# Changelog

All notable changes to `@rytass/bpm-core-shared` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Added versioned form option-source, direct binding, selection-mode, and
  persisted label-snapshot contracts.
- Added `autocomplete` fields plus pure option-field guards and legacy schema
  normalization.
- `FormDataSourceValueSnapshot` now carries an optional `revalidationPolicy`,
  recording the policy the source declared when the snapshot was written. Once a
  source leaves the host registry its descriptor is gone, so without this record
  there is no way to tell whether reusing the snapshot would quietly skip an
  `ALWAYS` revalidation. The field is optional so snapshots persisted before it
  existed keep loading.

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

## 0.6.0 — 2026-08-04

### Added

- **`preferClosestOrgUnit` optional flag** on the `ORG_MANAGER` and
  `ORG_UNIT_MANAGER` variants of `ApproverResolver`. When enabled, the
  workflow engine resolves only the deepest org-unit-level manager rules
  on the winning priority tier, so ancestor-level catch-all rules do not
  dilute the approver list. Defaults to `false` (unchanged behavior).
  `parseApproverResolver` in `workflow-toolset.ts` parses the new field.

### Why a minor

New optional type field — backward compatible, additive.

## 0.5.1 — 2026-07-06

### Fixed

- **Broken 0.5.0 tarball.** 0.5.0 was published from the project source root, so
  the npm tarball shipped only TypeScript sources with no compiled `.js`/`.d.ts`
  while `main`/`exports` point at `./src/index.js`. 0.5.1 is republished from the
  build output (`dist/libs/shared`). Configured `nx-release-publish` with
  `packageRoot: dist/libs/shared`. No source changes.

## 0.5.0 — 2026-07-06

No source changes. Version aligned with `@rytass/bpm-core-client` and
`@rytass/bpm-core-nestjs-module` 0.5.0 (fixed release group). The new
`BPMMemberSearchPage` paged-search types added in that release live in
`@rytass/bpm-core-nestjs-module`, not here.

## 0.4.0 — 2026-07-02

No source changes. Version aligned with `@rytass/bpm-core-client` and
`@rytass/bpm-core-nestjs-module` 0.4.0 (fixed release group).

## 0.3.0 — 2026-06-06

No source changes. Version aligned with `@rytass/bpm-core-client` and
`@rytass/bpm-core-nestjs-module` 0.3.0 (fixed release group).

## 0.2.0 — 2026-06-04

No source change. Lockstep bump with `@rytass/bpm-core-nestjs-module`
and `@rytass/bpm-core-client` 0.2.0.

## 0.1.10 — 2026-05-28

No source change. Lockstep bump.

## 0.1.9 — 2026-05-28

No source change. Lockstep bump alongside
`@rytass/bpm-core-nestjs-module@0.1.9` (machine-to-machine auth +
nested AuthProvider docs) and `@rytass/bpm-core-client@0.1.9`
(`OrgUnitType` is now a re-export from this package, not a separate
definition — see that CHANGELOG).

## 0.1.8 — 2026-05-28

No source change. Lockstep bump alongside
`@rytass/bpm-core-nestjs-module@0.1.8` (README drift fixes for Casbin
example, position signatures, and metadataJson write-only clarification).

## 0.1.7 — 2026-05-28

### ⚠️ Type-level breaking (consumers writing literal values)

- **`OrgUnitType` literal case corrected**: was `'company' | 'division'
  | 'department' | 'team'` (lowercase, matched the database row values
  but **not** the GraphQL SDL); now `'COMPANY' | 'DIVISION' |
  'DEPARTMENT' | 'TEAM'` (UPPERCASE, matches what the GraphQL wire
  actually carries on every read and every write).

  Consumers calling `createOrgUnit({ type: 'company' })` against the
  published `@rytass/bpm-core-client@0.1.6` or earlier received a
  GraphQL enum-coercion error at runtime — the lowercase form was
  rejected by the BPM server. The TS type was misleading. This release
  realigns the type with the wire reality.

  Migration: update any literal `'company'` / `'division'` /
  `'department'` / `'team'` passed to `createOrgUnit` / `updateOrgUnit`
  / `readOrganizationDashboard` `orgUnitType` filter to the UPPERCASE
  form. JSDoc on the type explains the casing.

### Documentation

- JSDoc added to `OrgUnitType` explaining the lowercase database value
  vs UPPERCASE wire format asymmetry.

### Why a patch (despite the rename)

The lowercase form did not work in practice — any consumer who got
past `tsc` failed at runtime against the GraphQL server. Calling this a
patch reflects "fixing a documented contract" rather than "changing
working behavior".

## 0.1.6 — 2026-05-28

No source changes. Lockstep bump alongside
`@rytass/bpm-core-nestjs-module@0.1.6` (new `MemberNotFoundException`
export) and `@rytass/bpm-core-client@0.1.6` (new `configureBPMClient`).

## 0.1.5 — 2026-05-28

### Documentation

- **`MemberMetadata.customFields` JSDoc.** Documented as opaque
  host-shaped JSON: BPM stores the object verbatim, serializes it back
  to GraphQL clients via `MemberProfile.customFieldsJson`, and never
  introspects keys. Hosts populate the field via the
  `options.readCustomFields?.(member)` hook in
  `createBPMMemberBaseResolverProvider`. This was previously implied by
  the source but undocumented in the published JSDoc.

### Why a patch

No public type signatures change. JSDoc only.

## 0.1.4 — 2026-05-27

No source changes. Bumped in lockstep with
`@rytass/bpm-core-nestjs-module@0.1.4` (re-publish after the 0.1.3
backend tarball shipped only `.ts` source — see that package's CHANGELOG).

## 0.1.3 — 2026-05-27 (deprecated on npm)

Lockstep bump alongside the broken 0.1.3 backend release. Avoid;
upgrade directly to 0.1.4 or newer.

## 0.1.2 — 2026-05-27

No source changes. Bumped in lockstep with
`@rytass/bpm-core-nestjs-module@0.1.2` (see its CHANGELOG for the
migration class-name fix).

## 0.1.1 — 2026-05-27

No source changes. Version bumped in lockstep with
`@rytass/bpm-core-nestjs-module@0.1.1` so the fixed-versioning release
group stays aligned (see `nx.json` `release.projectsRelationship`).

## 0.1.0 — Unreleased

### Added

- Initial published surface: workflow, form, condition, identity,
  organization, and status type contracts under
  `@rytass/bpm-core-shared` plus per-domain subpaths (`/condition`,
  `/form`, `/status`, `/workflow`).
