## 0.18.0 (2026-10-28)

### 🚀 Features

- **bpm-core-client:** check text field formats in a Web Worker ([a3c3d65](https://github.com/Rytass/BPMCore/commit/a3c3d65))
- **bpm-core-react:** name text length and format errors on the case pages ([074d4b9](https://github.com/Rytass/BPMCore/commit/074d4b9))
- **bpm-core-react:** set a text format in the form builder ([ce74cd1](https://github.com/Rytass/BPMCore/commit/ce74cd1))
- **bpm-core-react:** set where a return goes on the user task panel ([b3b9fe0](https://github.com/Rytass/BPMCore/commit/b3b9fe0))
- **bpm-core-react:** offer only reachable nodes in the return dialog ([690042a](https://github.com/Rytass/BPMCore/commit/690042a))

### 🩹 Fixes

- **bpm-core:** ask the directory only about delegation rules in scope ([022304e](https://github.com/Rytass/BPMCore/commit/022304e))
- **bpm-core-react:** drop patternErrorMessage when the designer clears it ([74a007b](https://github.com/Rytass/BPMCore/commit/74a007b))
- **bpm-core-react:** release the busy state when form validation throws ([a300d2b](https://github.com/Rytass/BPMCore/commit/a300d2b))
- **bpm-core:** hold service-task text writes to the field's rules ([fcde1df](https://github.com/Rytass/BPMCore/commit/fcde1df))
- **bpm-core-react:** check formats off the main thread on the case pages ([58a1a9d](https://github.com/Rytass/BPMCore/commit/58a1a9d))
- **bpm-core:** keep the directory's error out of the delegation refusal ([14ccd0e](https://github.com/Rytass/BPMCore/commit/14ccd0e))
- **bpm-core:** refuse to dispatch when the delegation directory lookup fails ([8ef8a88](https://github.com/Rytass/BPMCore/commit/8ef8a88))
- **bpm-core:** check the type of a text field whose visibleWhen is false ([b256040](https://github.com/Rytass/BPMCore/commit/b256040))
- **bpm-core-react:** word a timed-out format check on the approver page ([3a223a3](https://github.com/Rytass/BPMCore/commit/3a223a3))
- **shared:** refuse every repeated group in a text field pattern ([d0daa77](https://github.com/Rytass/BPMCore/commit/d0daa77))
- **bpm-core-react:** flag an over-long pattern or error message in the builder ([68baf21](https://github.com/Rytass/BPMCore/commit/68baf21))
- **shared:** refuse repeated alternations whose branches can start alike ([5e6e12e](https://github.com/Rytass/BPMCore/commit/5e6e12e))
- **bpm-core-react:** show the designer's message for a fill format error ([a69399d](https://github.com/Rytass/BPMCore/commit/a69399d))
- **bpm-core-react:** warn about every format the linter refuses ([d637d58](https://github.com/Rytass/BPMCore/commit/d637d58))

### 🔥 Performance

- **bpm-core:** ask the host directory once per node when resolving delegation ([cb62b00](https://github.com/Rytass/BPMCore/commit/cb62b00))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.9 (2026-10-27)

### 🚀 Features

- **bpm-core-react:** list deactivated members with open tasks on the member screen ([78a2006](https://github.com/Rytass/BPMCore/commit/78a2006))
- **bpm-core-react:** list the member's returned cases on the inbox ([617f507](https://github.com/Rytass/BPMCore/commit/617f507))
- **bpm-core-react:** let the applicant comment when resubmitting ([374c462](https://github.com/Rytass/BPMCore/commit/374c462))

### 🩹 Fixes

- **bpm-core-react:** cap the resubmission comment box and match its width ([05a1ff7](https://github.com/Rytass/BPMCore/commit/05a1ff7))
- **bpm-core-react:** keep each resubmission comment draft with its own case ([4623cb1](https://github.com/Rytass/BPMCore/commit/4623cb1))
- **bpm-core-react:** keep the inbox tasks when the returned cases fail to load ([49fa4e3](https://github.com/Rytass/BPMCore/commit/49fa4e3))
- **bpm-core-react:** keep the latest inactive-members reload ([e552a07](https://github.com/Rytass/BPMCore/commit/e552a07))
- **bpm-core-react:** allow saving an edited membership whose member is unresolved ([75df04a](https://github.com/Rytass/BPMCore/commit/75df04a))
- **bpm-core-react:** lock the member picker when editing a membership ([4bf22a6](https://github.com/Rytass/BPMCore/commit/4bf22a6))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

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
- **bpm-core-react:** send fill tasks to the case page from inbox and notifications ([235c3c0](https://github.com/Rytass/BPMCore/commit/235c3c0))
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
- **bpm-core-react:** clear, name and guard the approver's fill ([dc2af08](https://github.com/Rytass/BPMCore/commit/dc2af08))
- **bpm-core-react:** keep the fill payload in step with what the page shows ([80f1de1](https://github.com/Rytass/BPMCore/commit/80f1de1))
- **bpm-core-react:** send only the fill fields the approver changed ([1250eac](https://github.com/Rytass/BPMCore/commit/1250eac))
- **template:** stop rethrowing designer save and publish errors ([af93e67](https://github.com/Rytass/BPMCore/commit/af93e67))
- **bpm-core-client:** update launch mocks for the template version definition ([452d600](https://github.com/Rytass/BPMCore/commit/452d600))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.6 (2026-10-20)

This was a version bump only for bpm-core-react to align it with other projects, there were no code changes.

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

- **react:** name condition operators after the field in the template designer ([54d530a](https://github.com/Rytass/BPMCore/commit/54d530a))
- **react:** sample multiple-selection fields as arrays in the dry run ([295c23a](https://github.com/Rytass/BPMCore/commit/295c23a))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.3 (2026-10-19)

### 🚀 Features

- **react:** add a BPM message language provider ([355b15c](https://github.com/Rytass/BPMCore/commit/355b15c))
- **template:** translate publish lint lines per language ([60fa7bc](https://github.com/Rytass/BPMCore/commit/60fa7bc))
- **react:** enlarge approval comments in the instance history ([b3bb37c](https://github.com/Rytass/BPMCore/commit/b3bb37c))
- **react:** show structural publish failures in Chinese with node names ([ba90fbd](https://github.com/Rytass/BPMCore/commit/ba90fbd))
- **client:** translate structural publish-lint lines into designer copy ([490339c](https://github.com/Rytass/BPMCore/commit/490339c))

### 🩹 Fixes

- **template:** address review of the lint translation ([26d7a54](https://github.com/Rytass/BPMCore/commit/26d7a54))
- **react:** sample money fields as numbers in the designer dry run ([35dbd9a](https://github.com/Rytass/BPMCore/commit/35dbd9a))
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
- **template:** say a category in use cannot be deleted ([ab4236b](https://github.com/Rytass/BPMCore/commit/ab4236b))
- **react:** keep org unit and position picker menus on screen ([bb5cbaa](https://github.com/Rytass/BPMCore/commit/bb5cbaa))
- **react:** fully specify relative imports in emitted declarations ([022b3e2](https://github.com/Rytass/BPMCore/commit/022b3e2))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.17.0 (2026-10-15)

### 🚀 Features

- ⚠️  **workflow-engine:** end SLA-terminated instances as EXPIRED ([7dcca4e](https://github.com/Rytass/BPMCore/commit/7dcca4e))
- **template:** allow lastDecision in edge conditions ([e8b4788](https://github.com/Rytass/BPMCore/commit/e8b4788))
- **react:** add member task reassignment modal to admin users ([f12e9f8](https://github.com/Rytass/BPMCore/commit/f12e9f8))
- **workflow-engine:** add administrator in-place task reassignment ([02ce920](https://github.com/Rytass/BPMCore/commit/02ce920))
- **template-designer:** let the fallback mode pick a position ([257a361](https://github.com/Rytass/BPMCore/commit/257a361))
- **views:** ask for a successor unit before retiring an org unit ([b79cd5c](https://github.com/Rytass/BPMCore/commit/b79cd5c))
- ⚠️  **organization:** retire org units into a successor unit ([514e0b2](https://github.com/Rytass/BPMCore/commit/514e0b2))

### 🩹 Fixes

- **migrations:** check pg_trgm with the other required extensions ([30a1e58](https://github.com/Rytass/BPMCore/commit/30a1e58))
- **template:** check CEL roots per call site on publish ([868d236](https://github.com/Rytass/BPMCore/commit/868d236))
- **instance-detail:** show how a closed instance ended ([a110e08](https://github.com/Rytass/BPMCore/commit/a110e08))
- ⚠️  **delegation:** order rules by priority, higher first ([96cca55](https://github.com/Rytass/BPMCore/commit/96cca55))
- **react:** drop a late member task listing in the reassignment modal ([1a7724e](https://github.com/Rytass/BPMCore/commit/1a7724e))
- **react:** keep reassigned task titles and fit the result table ([3b90530](https://github.com/Rytass/BPMCore/commit/3b90530))
- **template-designer:** keep unknown approver fallbacks read-only ([5ea88fe](https://github.com/Rytass/BPMCore/commit/5ea88fe))

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

### 🩹 Fixes

- **views:** treat a blank member e-mail as missing ([d8504ed](https://github.com/Rytass/BPMCore/commit/d8504ed))
- **views:** drop empty parentheses when a member has no e-mail ([2b02a60](https://github.com/Rytass/BPMCore/commit/2b02a60))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

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
- **inbox:** show node names instead of node ids in task lists ([e9e8f46](https://github.com/Rytass/BPMCore/commit/e9e8f46))
- **designer:** show who submitted on the applicant's behalf in the instance detail ([4bcb291](https://github.com/Rytass/BPMCore/commit/4bcb291))
- **designer:** pick approvers from a member field and show readable dry-run assignees ([bc9592e](https://github.com/Rytass/BPMCore/commit/bc9592e))
- **forms:** add a member field type ([0fca8d4](https://github.com/Rytass/BPMCore/commit/0fca8d4))

### 🩹 Fixes

- **template-designer:** name a member-field dry-run assignee by its field label ([465fcc3](https://github.com/Rytass/BPMCore/commit/465fcc3))
- **template-designer:** sample a dry-run member field with a placeholder, not the initiator ([b567e41](https://github.com/Rytass/BPMCore/commit/b567e41))
- **template:** refuse a DYNAMIC_FORM resolver on a member field that can be left empty ([b3a3950](https://github.com/Rytass/BPMCore/commit/b3a3950))
- **organization:** default organizationTimeZone to Asia/Taipei ([cc6b908](https://github.com/Rytass/BPMCore/commit/cc6b908))
- **forms:** keep the new-tab cue out of copied link text ([4fcd8e8](https://github.com/Rytass/BPMCore/commit/4fcd8e8))
- **forms:** harden hidden fields and link display after review ([9ce1f82](https://github.com/Rytass/BPMCore/commit/9ce1f82))
- **designer:** say the sent list includes cases submitted on someone's behalf ([bfd928f](https://github.com/Rytass/BPMCore/commit/bfd928f))
- **workflow-engine:** index the submitter column that the sent list now matches ([557f458](https://github.com/Rytass/BPMCore/commit/557f458))
- **workflow-engine:** leave out the refusals of seats the initiator exclusion removes ([959912e](https://github.com/Rytass/BPMCore/commit/959912e))
- **workflow-engine:** harden business key lookup and count its length in characters ([844ce82](https://github.com/Rytass/BPMCore/commit/844ce82))
- **designer:** keep capped-out member ids eligible in the form renderer ([b8b4d4b](https://github.com/Rytass/BPMCore/commit/b8b4d4b))
- **designer:** stop re-requesting unresolvable members and warn on optional member fields ([8d6afa5](https://github.com/Rytass/BPMCore/commit/8d6afa5))
- **forms:** keep member ids out of case titles and check member references on publish ([2b3c9c0](https://github.com/Rytass/BPMCore/commit/2b3c9c0))

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
- **template-designer:** configure notify node webhooks ([813a03e](https://github.com/Rytass/BPMCore/commit/813a03e))
- **client:** add the webhook endpoint catalog query ([9e2c927](https://github.com/Rytass/BPMCore/commit/9e2c927))
- **instance-detail:** show webhook deliveries to administrators ([4e1e3c1](https://github.com/Rytass/BPMCore/commit/4e1e3c1))
- **client:** add webhook delivery listing and retry ([89387ae](https://github.com/Rytass/BPMCore/commit/89387ae))
- **workflow-webhook:** let administrators inspect and retry deliveries ([4a6128b](https://github.com/Rytass/BPMCore/commit/4a6128b))
- **workflow-webhook:** deliver notify webhooks through a transactional outbox ([cbb277f](https://github.com/Rytass/BPMCore/commit/cbb277f))
- **workflow-webhook:** add the endpoint registry, catalog and allowlist ([82afe97](https://github.com/Rytass/BPMCore/commit/82afe97))
- **workflow:** add the notify webhook contract to the shared lib ([e240632](https://github.com/Rytass/BPMCore/commit/e240632))
- **bpm:** make every BPMRootModule option optional and async-loadable ([0966edb](https://github.com/Rytass/BPMCore/commit/0966edb))
- **bpm-core-react:** let an approver add several people at once ([4543bee](https://github.com/Rytass/BPMCore/commit/4543bee))
- **bpm-core-react:** give an approval comment its own line in the timeline ([2b03494](https://github.com/Rytass/BPMCore/commit/2b03494))

### 🩹 Fixes

- **template-designer:** start number webhook constants empty ([c64bf20](https://github.com/Rytass/BPMCore/commit/c64bf20))
- **workflow-webhook:** harden the P1 catalog after independent review ([0ea9790](https://github.com/Rytass/BPMCore/commit/0ea9790))
- **designer:** judge notify nodes with the shared rule ([30f1077](https://github.com/Rytass/BPMCore/commit/30f1077))
- **delegation:** let the member tooltip reach assistive technology ([c6c355f](https://github.com/Rytass/BPMCore/commit/c6c355f))
- **workflow:** let the engine pick its service task dispatcher ([21bcde4](https://github.com/Rytass/BPMCore/commit/21bcde4))
- **bpm-core-react:** import ActivityLogRecord from the subpath that exports it ([31455c7](https://github.com/Rytass/BPMCore/commit/31455c7))
- **bpm-core-react:** restore the separator and colour of a timeline comment ([9f58b49](https://github.com/Rytass/BPMCore/commit/9f58b49))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5
- Claude Opus 5 (1M context)
- Kai-Chieh Yang

## 0.13.3 (2026-09-04)

This was a version bump only for bpm-core-react to align it with other projects, there were no code changes.

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

### 🚀 Features

- **orgs:** let an admin delete a position, and show why a delete was refused ([a9b3408](https://github.com/Rytass/BPMCore/commit/a9b3408))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.12.0 (2026-08-27)

### 🚀 Features

- **form:** wire cell-level DataSources through the client and renderer ([c7561ad](https://github.com/Rytass/BPMCore/commit/c7561ad))
- **form:** resolve table column DataSources per cell ([ca40a4c](https://github.com/Rytass/BPMCore/commit/ca40a4c))
- **form:** design table fields in the builder ([f70ac0c](https://github.com/Rytass/BPMCore/commit/f70ac0c))
- **form:** add table column factories and row-scoped binding rename ([0c8c07d](https://github.com/Rytass/BPMCore/commit/0c8c07d))
- **form:** render table fields with per-row editing ([5a04d7d](https://github.com/Rytass/BPMCore/commit/5a04d7d))
- **form:** validate and seed table values in the renderer helpers ([5c7edab](https://github.com/Rytass/BPMCore/commit/5c7edab))
- **form:** add table field definitions to the shared contract ([5f97165](https://github.com/Rytass/BPMCore/commit/5f97165))

### 🩹 Fixes

- **form:** fit the condition table to what it has to show ([c89b4d1](https://github.com/Rytass/BPMCore/commit/c89b4d1))
- **form:** drop the confirmation for changing the option source ([14ce722](https://github.com/Rytass/BPMCore/commit/14ce722))
- **form:** put each DataSource condition on one row ([051bb43](https://github.com/Rytass/BPMCore/commit/051bb43))
- **form:** stop promising a search threshold the source does not have ([8c8b311](https://github.com/Rytass/BPMCore/commit/8c8b311))
- **form:** name the DataSource check for what it actually checks ([1138ef1](https://github.com/Rytass/BPMCore/commit/1138ef1))
- **form:** make the DataSource block readable by a process designer ([fec8518](https://github.com/Rytass/BPMCore/commit/fec8518))
- **form:** stop the DataSource parameter label breaking mid-word ([fe4c609](https://github.com/Rytass/BPMCore/commit/fe4c609))
- **form:** only confirm a column retype when it discards something ([baf7c9b](https://github.com/Rytass/BPMCore/commit/baf7c9b))
- **form:** line up the field settings inputs across every field type ([2d8c128](https://github.com/Rytass/BPMCore/commit/2d8c128))
- **form:** track the open table column by index, not by key ([1928f61](https://github.com/Rytass/BPMCore/commit/1928f61))
- **form:** size a table cell's control to the table it sits in ([db79e5e](https://github.com/Rytass/BPMCore/commit/db79e5e))
- **form:** stop the field settings sprawling across a wide screen ([a697705](https://github.com/Rytass/BPMCore/commit/a697705))
- **form:** select a table column after its type changes ([2a511e2](https://github.com/Rytass/BPMCore/commit/2a511e2))
- **form:** name fields, columns and parameters in builder DataSource copy ([b9d703a](https://github.com/Rytass/BPMCore/commit/b9d703a))
- **form:** make every table column type reachable in the builder ([b596640](https://github.com/Rytass/BPMCore/commit/b596640))
- **form:** keep the table field out of the single-column width cap ([0ca798f](https://github.com/Rytass/BPMCore/commit/0ca798f))
- **form:** warn about table columns bound to a field being removed ([80c7471](https://github.com/Rytass/BPMCore/commit/80c7471))
- **form:** keep the DataSource picker out of table column settings ([cd264d0](https://github.com/Rytass/BPMCore/commit/cd264d0))
- **form:** keep the column key input mounted while it is being typed ([5d15da8](https://github.com/Rytass/BPMCore/commit/5d15da8))
- **form:** validate and submit the values the renderer actually shows ([0dda76a](https://github.com/Rytass/BPMCore/commit/0dda76a))

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
- **bpm-core-react:** let the designer configure the decision policy ([6a4caf1](https://github.com/Rytass/BPMCore/commit/6a4caf1))

### 🩹 Fixes

- ⚠️  **template:** reject deleting a referenced category ([#16](https://github.com/Rytass/BPMCore/pull/16))
- **template:** let a template actually change category ([#17](https://github.com/Rytass/BPMCore/pull/17))
- **shared:** keep an approver change from discarding a workable policy ([ea6afbe](https://github.com/Rytass/BPMCore/commit/ea6afbe))
- **bpm-core-react:** stop the member resolve effect looping on failure ([a0bfa66](https://github.com/Rytass/BPMCore/commit/a0bfa66))
- **bpm-core-react:** stop the dropped-policy notice outliving its subject ([7fddefe](https://github.com/Rytass/BPMCore/commit/7fddefe))
- **bpm-core-react:** re-request members left as unresolved placeholders ([567c776](https://github.com/Rytass/BPMCore/commit/567c776))
- **bpm-core-react:** finish the member picker's stale-response handling ([dda3692](https://github.com/Rytass/BPMCore/commit/dda3692))
- **bpm-core-react:** keep the dropped-policy notice on screen ([7557dc8](https://github.com/Rytass/BPMCore/commit/7557dc8))
- **bpm-core-react:** stop re-applying an unsatisfiable policy ([e548f14](https://github.com/Rytass/BPMCore/commit/e548f14))
- **bpm-core-react:** tolerate malformed stored quorum policies ([f4fcb41](https://github.com/Rytass/BPMCore/commit/f4fcb41))
- **bpm-core-react:** cap PERCENTAGE quorum threshold and sanitise every write ([d70528a](https://github.com/Rytass/BPMCore/commit/d70528a))
- **bpm-core-react:** stop member pickers offering stale or phantom rows ([f4f82c9](https://github.com/Rytass/BPMCore/commit/f4f82c9))
- **e2e:** poll on the expected value in the quorum threshold sanitiser spec ([099529f](https://github.com/Rytass/BPMCore/commit/099529f))
- **bpm-core-react:** correct decision-policy panel review findings ([ebf0337](https://github.com/Rytass/BPMCore/commit/ebf0337))
- **bpm-core-react:** show only the latest member search results ([9804d37](https://github.com/Rytass/BPMCore/commit/9804d37))

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
- Claude Opus 5 (1M context)
- Kai-Chieh Yang

# Changelog

All notable changes to `@rytass/bpm-core-react` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Form builder and renderer schemas now recognize the `autocomplete` option
  field while retaining Mezzanine controls and primitive form values.
- FormRenderer now supports host-bounded preview/runtime DataSource contexts,
  snapshot hydration, async Mezzanine Select/AutoComplete controls, complete
  list Radio/Checkbox controls, paging/search state, retry feedback, and
  submission blocking for unresolved dynamic values.
- FormBuilderView now loads the host DataSource Catalog, filters sources by
  control capability, edits field/constant bindings, preserves bindings when a
  field key changes, and confirms source/mode changes or dependent-field
  removal before updating the schema. DataSource schema lint is available from
  the editor.

### Fixed

- The template designer now restores missing legacy edge data before rendering,
  so older workflow JSON without an edge `data` object remains editable.
- Dynamic option failures no longer surface raw `FORM_DATA_SOURCE_*` codes.
  Launch, resubmit, field-level, form builder lint, and template
  designer/compose publish messages now show mapped copy, so a value that
  expired reads as "已選取的選項已失效，請重新選擇。" instead of an error code.
- A stale dynamic field now asks the host to resolve its selected values instead
  of trusting the merged option list, which still carries the instance snapshot
  and would vouch for a value the source has already dropped. A value the host
  cannot resolve turns the field `INVALID`, is marked individually, and blocks
  resubmit.
- A control bound to an optional DataSource parameter is no longer disabled
  forever when that dependency field is empty. `WAITING_FOR_DEPENDENCIES` now
  follows the server's `waitingForFieldKeys`; the browser's optimistic guess
  survives only until the first response, and AutoComplete makes no guess at all
  because nothing could correct it while the control is disabled.
- A read-only dynamic field with no value is quiet instead of reporting
  "選項來源暫時無法使用。" next to a retry button that could not do anything.
  `FormDataSourceFieldState` gained `canRetry`, and the renderer only offers
  retry when a query can actually be re-issued.
- A recoverable search failure such as `FORM_DATA_SOURCE_SEARCH_TOO_SHORT` now
  shows an inline hint and leaves the field as usable as it was, instead of
  marking the source unavailable and blocking a submission that was valid.
- `InstanceFormSection` now passes only `instanceId` when a returned instance is
  reopened for editing. It previously sent `templateId` as well, which the
  runtime context rejects (exactly one is required), so every dynamic option
  query during return-edit failed with "沒有權限查詢此欄位的選項。". The existing
  e2e coverage missed it because it only asserted snapshot labels, which need no
  query.

Releases are managed by [`nx release`](https://nx.dev/recipes/nx-release) with
Conventional Commits — see `nx.json` for the release config.

## 0.8.0 — 2026-08-10

### Added

- **SLA and return-comment controls in the template designer.** The node panel
  had no SLA fields at all, so a working-day deadline could only be set through
  the API. It now exposes the timer the way the approver resolver already
  works — a master toggle that progressively reveals the duration, its unit,
  the calendar mode, the timeout action, the escalation level and the warning
  threshold — plus a `returnBehavior.requireComment` toggle.

  The deadline is entered as a number and a unit rather than a raw ISO
  duration, so the form cannot produce a mixed `P1DT4H`; the calendar selector
  only appears for day-based durations, since a business calendar advances
  whole days only.

- **Required return comments in the instance view.** The return dialog marks
  the comment required and keeps the submit button disabled until it is filled,
  so approvers see the node's rule before the server rejects the decision.

### Fixed

- **Designer toggles were not label-clickable.** `FormField` renders
  `<label htmlFor={name}>`, but the toggles carried no matching `id`, so those
  labels pointed at nothing. All node-panel toggles now set `id` and `name`.

### Changed

- Widened peer dependency ranges to `^0.4.0 || ^0.5.0 || ^0.6.0 || ^0.7.0` for
  `@rytass/bpm-core-client` and `@rytass/bpm-core-shared`. The new designer
  controls read `SlaConfig.calendar` and `ReturnBehavior.requireComment`, which
  only exist from 0.7.0 — on older core packages the extra fields are simply
  absent and the panel falls back to its previous behaviour.

### Why a minor

New optional UI controls over additive contract fields; no component API or
existing behaviour changed.

## 0.7.7 — 2026-08-04

### Changed

- Widened peer dependency ranges to `^0.4.0 || ^0.5.0 || ^0.6.0` for
  `@rytass/bpm-core-client` and `@rytass/bpm-core-shared` so downstream apps can
  install the 0.6.x core packages (date picker timezone fix, manager resolution
  priority + depth filtering) without a peer conflict. No component or source
  changes.

## 0.7.6 — 2026-07-06

### Changed

- Widened peer dependency ranges to `^0.4.0 || ^0.5.0` for
  `@rytass/bpm-core-client` and `@rytass/bpm-core-shared` so downstream apps can
  install the 0.5.x core packages (member directory paged search) without a peer
  conflict. No component or source changes.

## 0.7.5 — 2026-07-03

### Changed

- The organization tree now opens fully expanded — collapsing is a per-user
  action, never a default. The depth / layer-width initial-collapse heuristics
  from 0.7.3 are removed, and a 全部展開 / 全部收合 shortcut panel (top-right
  of the canvas) folds the tree down to the root plus top-level org units or
  restores it in one click.

### Fixed

- Tree node cards no longer sit on the next rank's connection lines. The card
  scss is `min-height` and the action buttons wrap to a second row, so real
  card heights exceed the size declared to dagre; the layout now re-runs with
  the rendered dimensions ReactFlow reports (and no longer pins the node
  wrapper to an inline height, which had clamped those measurements), plus the
  rank separation is raised from dagre's default 50 to 96 so a readable edge
  corridor survives even before the measured relayout lands.

## 0.7.4 — 2026-07-03

### Fixed

- The `@xyflow/react` base stylesheet is now bundled into the package css.
  xyflow v12 does no runtime style injection, so any host that did not import
  `@xyflow/react/dist/style.css` itself rendered every ReactFlow surface
  (organization tree, workflow designer, instance detail) as an unpositioned
  document-flow stack — nodes piled up and clipped, Controls flattened into a
  horizontal strip. The stylesheet now ships as `dist/style.css`, imported
  automatically by the orgs / designer / instance-detail chunks, so consumers
  need zero configuration. Hosts that already import the xyflow stylesheet are
  unaffected (the rules are identical and loading them twice is harmless).

## 0.7.3 — 2026-07-02

### Fixed

- The organization tree editor's readable opening viewport now actually shows
  the tree: dagre can place the synthetic root at the far edge of an asymmetric
  layout, so anchoring on the root's own coordinates opened onto empty margin
  with every other node off-screen. The root is now re-centered over the layout
  width and the opening viewport anchors on the layout's horizontal center and
  top ranks.
- The 收合 / 展開 (and 編輯 / 新增) buttons on tree node cards now respond to
  real mouse clicks. The node action row was only marked `nodrag`, so a click
  with ≥1px of pointer jitter was captured by the canvas pan gesture and the
  click was suppressed before reaching the button; the row is now also `nopan`.
- The initial expansion of a large organization tree now also stops before any
  level that would render more than 12 sibling nodes side by side — depth alone
  still let a wide level open thousands of pixels across.
- Collapsing or expanding a subtree re-centers the viewport on the toggled node
  (at the user's current zoom), so the layout shift from the re-run dagre
  layout no longer leaves the change off-screen.

## 0.7.2 — 2026-07-02

### Fixed

- The organization tree editor now stays readable and interactive for large,
  very wide trees. Instead of `fitView` shrinking a ~19:1 tree to an unreadable
  line (which also made manual Zoom In feel stuck), large trees open at a
  readable zoom anchored on the root node while small trees still fit to view.

### Added

- Collapsible subtrees in the organization tree editor: every node with
  children shows a 收合 / 展開 toggle, and large trees start expanded to only
  the first few levels so they open readable and the user drills down. The
  MiniMap stays hidden for large trees.

## 0.7.1 — 2026-07-02

### Fixed

- Large organization trees now fit inside the tree editor: `minZoom` is derived
  from the dagre layout bounds instead of a fixed `0.25`, so `fitView` can
  shrink very wide/deep trees enough to reveal the whole graph rather than
  clipping it off-screen. The MiniMap is hidden above 80 nodes, where it
  degrades into an unreadable black block.

### Changed

- Peer dependencies now require `@rytass/bpm-core-client` ^0.4.0 and
  `@rytass/bpm-core-shared` ^0.4.0.

## 0.7.0 — 2026-06-10

### Added

- Workflow AI assistant surfaced in the template compose wizard.

## 0.6.0 — 2026-06-06

### Added

- Ad-hoc directive UI on the instance detail page: 會簽 / 加簽 buttons
  (shown when the node sets `allowAddSigner`), a 通知設定 button for
  stage-end and completion notifications (member or webhook targets), task
  rows tagged 「（臨時會簽）」/「（臨時加簽）」, and a 「待生效的臨時設定」
  table where the creator can withdraw pending directives.

### Changed

- **`InstanceTasksSection` requires the new `adhocDirectives` prop.** Hosts
  rendering the section standalone must fetch it with
  `listAdhocDirectives` from `@rytass/bpm-core-client/workflow`;
  `InstanceDetailView` wires it automatically.
- Peer dependencies now require `@rytass/bpm-core-client` ^0.3.0 and
  `@rytass/bpm-core-shared` ^0.3.0.

### Fixed

- Header action buttons keep stable identities across re-renders, so
  approve / reject clicks are no longer lost while instance data loads.

## 0.5.0 — 2026-06-04

Covers all changes since 0.4.1, including the undocumented internal
0.4.2–0.4.4 version bumps.

### Breaking

- **The standalone forms area is removed.** Forms are now designed only
  inside the template compose wizard and the designer's form drawer.
  Removed surfaces:
  - `FormsView` and the `./views/forms` subpath (the
    `./views/forms/builder` and `./views/forms/renderer` subpaths
    remain).
  - The `./pages/forms` and `./pages/forms/builder` Next.js page shims
    (`/forms`, `/forms/[id]/builder`). Hosts must delete the
    corresponding `app/forms/**` re-export files.
  - `BPMRoutes.forms()` and `BPMRoutes.formBuilder(formId)` — hosts
    providing a custom `BPMRoutes` map must drop these members.
- **`FormBuilderView` is now a pure controlled panel.** The `formId`
  and `embedded` props are removed; the component no longer loads from
  or saves to the server. Use `value` / `onChange` only — server
  persistence happens through the compose wizard or
  `composeApprovalTemplateWithForm`.
- **`TemplateNameModal` is removed.** Template creation goes through
  the compose wizard; the name-and-category modal flow no longer
  exists. `TemplateCategoryOption` now lives in `TemplatesView`.

### Added

- **Template compose wizard** (`./views/templates/compose`,
  `./pages/templates/compose`, route `/templates/compose`):
  `TemplateComposeWizardView` designs a form and an approval flow
  together — the form step embeds the builder, the review step can
  dry-run the flow — and publishes both atomically.
- **Designer upgrades** (`TemplateDesignerView`): embedded mode for
  wizard reuse, an in-page form edit drawer, a dry-run button
  (`showDryRun` prop / `BPM_TEMPLATE_DRY_RUN_ENABLED` env on the page
  shim), and one-click save-and-publish — the publish button forks and
  saves the draft as needed instead of requiring a separate save-draft
  step first.
- **Instance detail sections.** `InstanceDetailView` is split into
  individually exported `InstanceFormSection` /
  `InstanceAttachmentsSection` / `InstanceTasksSection` /
  `InstanceSignaturesSection` / `InstanceHistorySection`, toggleable
  via `showForm` / `showAttachments` / `showTasks` / `showSignatures` /
  `showHistory` props.
- **Notification drawer resolution states.** Resolved task
  notifications render their outcome instead of offering stale
  approve / reject actions.

### Changed

- `TemplatesView`: the create entry routes to the compose wizard (one
  primary 建立模板 button); the modal-based create flow is removed.

### Why a minor

Removes the standalone forms surfaces and `FormBuilderView`'s
server-backed mode — breaking under 0.x SemVer conventions
(0.4.x → 0.5.0).

## 0.4.1 — 2026-05-28

### Fixed

- **`<BPMNextProviders>` no longer breaks BPM views under Next.js 16 App
  Router prerender.** Previous versions wrapped the provider body in
  `<Suspense fallback={null}>` so that `useSearchParams()` could survive
  the static prerender phase. In Next 16, `useSearchParams()` triggers a
  client-side bailout at prerender time, the `<Suspense>` boundary then
  rendered `null`, and `<RouterAdapterProvider>` — which lived **inside**
  that boundary — vanished from the SSR/hydration tree. Every BPM view
  that called `useRouterAdapter()` on mount then threw
  `must be used inside <RouterAdapterProvider>` and Next.js surfaced the
  global error overlay.

  Fix: removed `useSearchParams()` from `BPMNextProviders` entirely. The
  `searchParams()` method on the wired-up `RouterAdapter` now returns a
  lazy snapshot from `defaultBrowserSearchParams()` (i.e.
  `window.location.search` on the client, empty `URLSearchParams` on
  the server). The `<Suspense>` wrapper is gone, so
  `<RouterAdapterProvider>` always mounts immediately and is present in
  every BPM view's ancestor chain throughout SSR and hydration.

- **Error thrown by `useRouterAdapter()` outside a provider pointed at a
  dead subpath.** The hint string referenced
  `<NextRouterAdapterProvider>` from
  `@rytass/bpm-core-react/pages/router-adapter` — neither the component
  nor the subpath has ever existed in the published package. Replaced
  with an accurate hint that names `<BPMNextProviders>` from
  `@rytass/bpm-core-react/next` (Next.js hosts) and
  `<RouterAdapterProvider>` (other hosts).

### Trade-off

- `RouterAdapter.searchParams()` is no longer reactive. Components that
  read it inside a render body will see the URL at first mount but will
  not re-render when the query string changes (without an accompanying
  pathname change). None of the shipped BPM views consume this method,
  so the change is API-compatible for the in-repo consumer. Hosts that
  want reactive query-string state should call Next's
  `useSearchParams()` directly in their page (wrapped in their own
  `<Suspense>` per Next 16 conventions), not via the BPM
  `RouterAdapter`.

### Why a patch

Bug fix only. Public API surface unchanged — same exports, same component
shape, same prop types.

## 0.4.0 — 2026-05-28

### Breaking

- **`<AppLayout>` removed from the public surface.** The 4-group
  Mezzanine `<Layout>` + `<Navigation>` shell BPM used to ship is no
  longer part of `@rytass/bpm-core-react`. Hosts are expected to own
  their navigation chrome and mount BPM views inside their existing
  sidebar / top bar. Together with `AppLayout`, the following exports
  are gone: `AppLayout`, `AppLayoutProps`, `AppNavigationGroup`.
- **Views no longer self-wrap.** Every view (`InboxView`, `FormsView`,
  `TemplatesView`, `AdminOrgsView`, … 13 in total) used to render
  `<AppLayout activeHref=…>…</AppLayout>` internally. They now return
  the page content fragment (a `<PageHeader>` + `<SectionGroup>`
  composition) so a host layout can wrap them. The `activeHref?` prop
  on `TemplatesView` / `DelegationsView` / `TemplateDesignerView` /
  `TemplateVersionsView` / `TemplateCategoriesView` / `AdminOrgsView` /
  `AdminUsersView` / `AdminDelegationsView` /
  `SettingsNotificationsView` is removed because it had no consumer
  after the layout was lifted out.
- **`DashboardPage` props simplified to `{}`** — `activeHref` removed
  for the same reason. The component still renders the five-metric
  workflow dashboard fragment unchanged.
- **`ApprovalInstanceListPage` no longer accepts `activeHref`.** The
  thin delegators (`SentView`, `CcView`, `SearchView`) drop the
  hard-coded `activeHref` argument accordingly.

### Added

- **`<BPMNotificationBellButton />`** — drop-in notification bell for
  host navigations. Opens the BPM `<NotificationDrawer />` (mounted by
  `<Providers>`) on click and renders an unread-count badge from
  `<NotificationUnreadProvider>`. Visual chrome uses Mezzanine
  `NavigationIconButton`, but the button is decoupled from the
  Mezzanine `<Navigation>` container — drop it anywhere in your nav.
  Hosts that want a fully custom trigger can skip this widget and
  consume `useNotificationDrawer().open` + `useNotificationUnread().unreadCount`
  directly.
- **`useBPMMember()` hook** — host-facing alias of `useAuth().member`.
  Returns the currently authenticated `ApiMember | null` without
  exposing the broader `useAuth()` surface.
- **`useBPMLogout()` hook** — host-facing alias of `useAuth().logout`.
  Returns `() => Promise<void>` that calls `logoutApi()` and redirects
  to the configured `loginPath`. Mount on host logout buttons / menu
  items so the host nav does not need to import `useAuth()` directly.

### Removed

- `AppLayout`, `AppLayoutProps`, `AppNavigationGroup` (see Breaking).
- `components/app-navigation.tsx` and `components/app-navigation.module.scss`
  are deleted from the lib source tree.

### Why a minor (0.x semver)

The library is still in `0.x` so breaking changes ride a minor bump per
the project's release convention. The change targets a single consumer
in the monorepo (`apps/client`) plus any external consumer wiring
`@rytass/bpm-core-react` into their own host — both are expected to
follow the migration recipe below.

### Migration

If your host re-exported page shims (`pages/<feature>`), you only need
to add a layout wrapper:

```diff
  // app/layout.tsx
  import { BPMNextProviders } from '@rytass/bpm-core-react/next';
+ import { MyHostLayout } from './_components/host-layout';

  export default function RootLayout({ children }) {
    return (
      <html lang="zh-TW"><body>
-       <BPMNextProviders>{children}</BPMNextProviders>
+       <BPMNextProviders>
+         <MyHostLayout>{children}</MyHostLayout>
+       </BPMNextProviders>
      </body></html>
    );
  }
```

For a reference `MyHostLayout` that reproduces the legacy 4-group BPM
nav using `useBPMRoutes` + `useBPMMember` + `useBPMLogout` +
`<BPMNotificationBellButton />`, copy
`apps/client/src/app/_components/host-layout.tsx` from the BPMCore
repo. Adjust groups, branding, and which routes you expose to match
your host.

If your host imported `AppLayout` directly, swap to the same host
layout pattern — `AppLayout` is no longer exported.

### Documentation

- README's `Usage` section rewritten around the new integration shape
  (host owns the layout; BPM provides widgets).
- New `docs/integration-guide.md` with a step-by-step host integration
  walkthrough, the recommended 4-group nav structure (`我的工作` /
  `查詢與代理` / `簽核設計` / `系統管理`), and notes on consuming the
  widgets / hooks.
- `docs/api-reference.md` updated to reflect the new root-barrel
  surface (`useBPMMember`, `useBPMLogout`, `BPMNotificationBellButton`)
  and the removal of `AppLayout` / `AppLayoutProps` /
  `AppNavigationGroup`.

## 0.3.8 — 2026-05-28

### Fixed

- **`React.ReactElement` return-type annotation** in
  `BPMRoutesProvider` and `RouterAdapterProvider` referenced the
  unimported `React` namespace. Compiled fine under typical `jsx:
  'react-jsx'` configs (which globalize the namespace) but broke
  under stricter consumer setups. Now uses the directly-imported
  `ReactElement` type to match the rest of the file.

### Changed

- **Dashboard "未讀通知" metric tile** now navigates to `routes.inbox()`
  instead of `routes.notifications()`. The previous target had no
  matching `pages/notifications` shim, so the click 404'd on hosts
  that hadn't built their own page at that path. Inbox is the
  most-actionable next step for an unread-notification click; the
  notification drawer bell stays available globally for in-place
  review.

### Documentation

- **`BPMRoutes.notifications()` JSDoc clarified** as a host-extension
  point: BPM's built-in views do not navigate to it by default. The
  default factory still returns `'/notifications'` so consumers can
  mount their own page at that path if desired; no BPM-shipped
  `pages/notifications` shim exists.

### Why a patch

Bug fix + behavior preservation. No public API change.

## 0.3.7 — 2026-05-28

### Documentation

- **`transpilePackages` list expanded** to include `@rytass/bpm-core-client`
  and `@rytass/bpm-core-shared` alongside `@rytass/bpm-core-react`. With
  pnpm strict mode + Turbopack, transitive peer-dep resolution into
  `node_modules/.pnpm/...` requires every package in the chain to be
  listed explicitly — previous versions only mentioned `@rytass/bpm-core-react`.
- **README "Status" banner refreshed** to `0.3.7` with a note pointing
  at the per-release CHANGELOG history.

### Why a patch

Documentation only.

## 0.3.6 — 2026-05-28

No source change. Lockstep peerDependency bump to `^0.1.9`.

## 0.3.5 — 2026-05-28

No source change. Lockstep peerDependency bump to `^0.1.8`.

## 0.3.4 — 2026-05-28

### Documentation

- **README "Mounting BPM under a non-root URL prefix"** added. Shows
  the exhaustive `createPrefixedRoutes(prefix)` factory covering all
  **19** `BPMRoutes` entries (previously the README only sketched
  2-3). Spreading `createDefaultBPMRoutes()` first means new BPMCore
  versions that add routes never silently regress consumer hosts.

### Why a patch

Documentation-only. No source change.

## 0.3.3 — 2026-05-28

### Fixed

- **Dist `.d.ts` files leaked workspace-source paths.** The 0.3.0–0.3.2
  release shipped declaration files that contained relative imports back
  into the vendor's monorepo (e.g. `import { ApiMember } from
  '../../libs/bpm-core-client/src/index.ts'`), which broke `tsc` for any
  consumer that didn't have BPMCore's source on disk at that exact
  relative path. The build now passes `compilerOptions.paths: {}` to
  `vite-plugin-dts` so the published types reference packages by their
  npm names (`@rytass/bpm-core-client`) rather than by resolved aliases.

### Added

- **`BPMNextProviders` props are now typed and forwarded.** The
  `loginPath`, `publicPaths`, and `locale` props were always accepted by
  the inner `<Providers>` but the `next` subpath wrapper hid them. They
  are now part of the exported `BPMNextProvidersProps` interface and
  forwarded through. Default `loginPath` remains `'/login'`, so hosts
  with a different auth route must pass their override explicitly.

### Documentation

- `BPMRoutes.caseDetail` and `BPMRoutes.caseNew(templateId?)` JSDoc
  carries `@example` annotations showing the default factory's literal
  paths so consumers can see what they're overriding without reading
  the source.

### Why a patch

The d.ts fix only affected consumers' type-check experience — runtime
behavior didn't change. The `BPMNextProviders` props forwarding is
additive (props were silently dropped before, now they work).

## 0.3.2 — 2026-05-28

### Added

- **`BPMRoutesContext` + `BPMRoutesProvider` + `useBPMRoutes()`** — opt-in
  path-mapping for hosts that embed BPM views under their own URL prefix.
  All BPM internal cross-navigation (instance detail, instance new,
  template designer, template versions, template categories, form
  builder, etc.) now resolves through `routes.caseDetail(id)` instead of
  inline `\`/instances/${id}\``. When no provider is mounted,
  `createDefaultBPMRoutes()` reproduces the previous string literals so
  upgrades from 0.3.1 require zero changes.

  Re-exported from the root barrel and from `@rytass/bpm-core-react/next`.

  Example (Next.js host mounting BPM under `/workspace`):

  ```tsx
  import { BPMRoutesProvider } from '@rytass/bpm-core-react/next';

  <BPMRoutesProvider value={{
    caseDetail: (id) => `/workspace/cases/${id}`,
    caseNew: (templateId) =>
      `/workspace/cases/new${templateId ? `?t=${templateId}` : ''}`,
    templates: () => '/workspace/templates',
    templateDesigner: (id) => `/workspace/templates/${id}/designer`,
    // ...rest follows the BPMRoutes interface
  }}>
    {children}
  </BPMRoutesProvider>
  ```

### Why a patch (additive only)

The provider is optional and the default factory preserves the exact
0.3.1 routes. No public symbol removed, no existing type signature
changed.

## 0.3.1 — 2026-05-27

### Fixed

- **`AppLayout` slot detection — the "left sidebar disappeared" bug.**
  Mezzanine `<Layout>` discovers its sidebar slot by component-identity
  match (`child.type === Navigation`). The previous `<AppNavigation>`
  wrapper rendered `<Navigation>` internally, so `<Layout><AppNavigation
  />...</Layout>` would silently drop the sidebar because `AppNavigation`
  ≠ `Navigation`. This shipped in 0.3.0 and broke every embedded view.

### ⚠️ Breaking

- **`AppNavigation` → `AppLayout`.** The standalone navigation component
  is replaced by `AppLayout`, which composes Mezzanine's
  `<Layout> + <Navigation> + <Layout.Main>{children}</Layout.Main>`
  internally. All 12 internal views were migrated.

  Migration for consumers who imported `AppNavigation` directly (very
  rare — most consume the `pages/*` shims which already use `AppLayout`):

  ```diff
  - import { AppNavigation } from '@rytass/bpm-core-react';
  + import { AppLayout } from '@rytass/bpm-core-react';

  - <Layout>
  -   <AppNavigation activeHref="/inbox" />
  -   <Layout.Main>
  -     <PageHeader title="待簽" />
  -     <SectionGroup>...</SectionGroup>
  -   </Layout.Main>
  - </Layout>
  + <AppLayout activeHref="/inbox">
  +   <PageHeader title="待簽" />
  +   <SectionGroup>...</SectionGroup>
  + </AppLayout>
  ```

  The exported types are now `AppLayoutProps` and `AppNavigationGroup`
  (the latter is the typed shape for overriding the 4-group nav tree via
  the `groups` prop).

## 0.3.0 — 2026-05-27

### Added

- **Full admin surface.** Up from the 0.2.0 login-only POC to 12 view
  subpaths, 19 Next.js page shims (`pages/<feature>`), and 4 view group
  barrels (`views/workflow`, `views/instances`, `views/settings`,
  `views/admin`).
- **`@rytass/bpm-core-react/next` subpath** — `<BPMNextProviders>`
  composes RouterAdapter + AuthProvider + NotificationDrawerProvider +
  NotificationUnreadProvider + CalendarConfigProviderMoment in one wrap.
- **Root barrel foundation** — Providers, hooks (`useAuth`,
  `useRouterAdapter`, `useNotificationUnread`,
  `useNotificationDrawer`), `AppNavigation`, `NotificationDrawer`,
  `ApprovalInstanceListPage`, `DashboardPage`, `BPMFormField`,
  `MemberPicker`, `OrgUnitPicker`, `PositionPicker`.

### Changed

- **Server Components everywhere by default.** `pages/<feature>` modules
  are now Server Components that export `default` + `metadata`. The
  `'use client'` boundary lives inside the underlying `<F>View`. The
  prior intermediate `<F>ClientView` shim layer (19 files) is removed.
- **`InstanceNewView` lifts `searchParams` to a prop.** Pages read
  `searchParams.templateId` server-side and pass it down instead of the
  view reading the browser URL.
- **Root page `/` performs a server-side redirect to `/dashboard`** for
  authenticated users (previously a client-side bounce).

## 0.2.0 — 2026-05-26

### Added

- Initial POC release. Login chain only (`/views/login`, `/pages/login`,
  providers, RouterAdapter). The remaining views planned for 0.3.0.
- Vite library-mode build pipeline emitting per-format chunks
  (`.js` for ESM, `.cjs` for CJS), SCSS CSS Modules with `bpm_` scope
  prefix, `'use client'` directive preserved via
  `rollup-preserve-directives`, type definitions via `vite-plugin-dts`.
- Decoupled from `next/navigation` via the `RouterAdapter` context —
  framework-agnostic consumers can plug in their own router.
