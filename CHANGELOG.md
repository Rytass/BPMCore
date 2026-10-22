## 0.17.8 (2026-10-22)

### 🚀 Features

- **api:** read webhook allowlist and encryption key from Vault ([d2a12c6](https://github.com/Rytass/BPMCore/commit/d2a12c6))

### 🩹 Fixes

- **bpm-core-react:** open the field overview on every field when nothing is set ([f90188d](https://github.com/Rytass/BPMCore/commit/f90188d))
- **bpm-core-react:** re-enable the instance header actions after a decision ([70e1a92](https://github.com/Rytass/BPMCore/commit/70e1a92))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.17.7 (2026-10-22)

### 🚀 Features

- **bpm-core:** keep approver-filled fields out of end-user submissions ([51fe897](https://github.com/Rytass/BPMCore/commit/51fe897))
- **bpm-core:** let the filling node write approver-filled fields on approval ([502500c](https://github.com/Rytass/BPMCore/commit/502500c))
- **bpm-core:** validate approver-filled fields whenever the filling node approves ([3d5ae3d](https://github.com/Rytass/BPMCore/commit/3d5ae3d))
- **bpm-core:** flag task notifications that need the form opened ([77fd492](https://github.com/Rytass/BPMCore/commit/77fd492))
- **bpm-core:** refuse to publish field permissions the engine cannot honour ([7361a9e](https://github.com/Rytass/BPMCore/commit/7361a9e))
- **bpm-core:** refuse form rules that clash with approver-filled fields ([a55253e](https://github.com/Rytass/BPMCore/commit/a55253e))
- **bpm-core:** refuse conditions that read approver-filled fields too early ([5ad995f](https://github.com/Rytass/BPMCore/commit/5ad995f))
- **bpm-core:** adopt fieldAccess node model per ADR 20 ([b25cf71](https://github.com/Rytass/BPMCore/commit/b25cf71))
- **bpm-core:** flag tasks whose node lets the approver fill in fields ([57f1d61](https://github.com/Rytass/BPMCore/commit/57f1d61))
- **bpm-core-client:** send approver-filled data and keep it off launch and resubmit forms ([a33d7f9](https://github.com/Rytass/BPMCore/commit/a33d7f9))
- **bpm-core-react:** resolve per-field access for the instance viewer ([7cd040c](https://github.com/Rytass/BPMCore/commit/7cd040c))
- **bpm-core-react:** let the fill node's approver fill in fields on the case page ([9cd9eb2](https://github.com/Rytass/BPMCore/commit/9cd9eb2))
- **bpm-core-react:** send fill tasks to the case page from inbox and notifications ([235c3c0](https://github.com/Rytass/BPMCore/commit/235c3c0))
- **bpm-core-react:** add the field access overview to the template designer ([1de7665](https://github.com/Rytass/BPMCore/commit/1de7665))
- **shared:** add field permission helpers for approver-filled fields ([6386b1c](https://github.com/Rytass/BPMCore/commit/6386b1c))
- **shared:** add the field access matrix and its commands ([b0a9aa3](https://github.com/Rytass/BPMCore/commit/b0a9aa3))

### 🩹 Fixes

- **bpm-core:** keep the read-early lint from crashing on malformed drafts ([2fb2c26](https://github.com/Rytass/BPMCore/commit/2fb2c26))
- **bpm-core:** let the first snapshot node win in task node summaries ([9637f4c](https://github.com/Rytass/BPMCore/commit/9637f4c))
- **bpm-core:** order task node summary rows by snapshot position ([091d808](https://github.com/Rytass/BPMCore/commit/091d808))
- **bpm-core-client:** update launch mocks for the template version definition ([452d600](https://github.com/Rytass/BPMCore/commit/452d600))
- **bpm-core-react:** send only the fill fields the approver changed ([1250eac](https://github.com/Rytass/BPMCore/commit/1250eac))
- **bpm-core-react:** keep the fill payload in step with what the page shows ([80f1de1](https://github.com/Rytass/BPMCore/commit/80f1de1))
- **bpm-core-react:** clear, name and guard the approver's fill ([dc2af08](https://github.com/Rytass/BPMCore/commit/dc2af08))
- **shared:** read a SET_FORM_FIELD path the way the engine writes it ([3ba2962](https://github.com/Rytass/BPMCore/commit/3ba2962))
- **template:** stop rethrowing designer save and publish errors ([af93e67](https://github.com/Rytass/BPMCore/commit/af93e67))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.6 (2026-10-20)

### 🩹 Fixes

- **form:** read the first field error without Array.prototype.at ([abc14a8](https://github.com/Rytass/BPMCore/commit/abc14a8))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.17.5 (2026-10-20)

### ⚠️ Upgrade notes

- **Migration `ActivityLogSeq0000000029000` locks `activity_logs` for its whole run.** It adds `activity_logs.seq` and backfills every existing row in one transaction, holding an ACCESS EXCLUSIVE lock from the `ADD COLUMN` through the backfill, `SET NOT NULL` and the unique index build. Nothing can read or write `activity_logs` meanwhile, and every submit, decision and history read touches it, so on a large table plan the run as downtime in a maintenance window. `lock_timeout` bounds only the wait to take the lock, not how long it is held.
- Run it inside a transaction (the default) and before serving 0.17.5.
- The backfill rewrites every row: leave free disk for roughly another copy of the table plus its WAL, and run `VACUUM (ANALYZE) activity_logs` afterwards.

### 🚀 Features

- **workflow-engine:** record the write order of activity logs ([d3a946a](https://github.com/Rytass/BPMCore/commit/d3a946a))

### 🩹 Fixes

- **organization:** let template designers read the organization ([4f76202](https://github.com/Rytass/BPMCore/commit/4f76202))
- **organization:** open only the designer's three organization reads ([28b5146](https://github.com/Rytass/BPMCore/commit/28b5146))
- **workflow-engine:** read activity logs in write order ([4b9865f](https://github.com/Rytass/BPMCore/commit/4b9865f))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.4 (2026-10-19)

### 🚀 Features

- **form:** translate DataSource error copy per language ([787e7a3](https://github.com/Rytass/BPMCore/commit/787e7a3))

### 🩹 Fixes

- **client:** scope the language menu to messages and require its provider ([94f072b](https://github.com/Rytass/BPMCore/commit/94f072b))
- **react:** sample multiple-selection fields as arrays in the dry run ([295c23a](https://github.com/Rytass/BPMCore/commit/295c23a))
- **react:** name condition operators after the field in the template designer ([54d530a](https://github.com/Rytass/BPMCore/commit/54d530a))
- **shared:** compile multiple-selection conditions with list semantics ([c9c7782](https://github.com/Rytass/BPMCore/commit/c9c7782))
- **workflow-engine:** route list-valued conditions by their structured fields ([ab2f848](https://github.com/Rytass/BPMCore/commit/ab2f848))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.17.3 (2026-10-19)

### 🚀 Features

- **client:** translate structural publish-lint lines into designer copy ([490339c](https://github.com/Rytass/BPMCore/commit/490339c))
- **client:** let users switch the message language ([c18cb91](https://github.com/Rytass/BPMCore/commit/c18cb91))
- **react:** show structural publish failures in Chinese with node names ([ba90fbd](https://github.com/Rytass/BPMCore/commit/ba90fbd))
- **react:** enlarge approval comments in the instance history ([b3bb37c](https://github.com/Rytass/BPMCore/commit/b3bb37c))
- **react:** add a BPM message language provider ([355b15c](https://github.com/Rytass/BPMCore/commit/355b15c))
- **template:** translate publish lint lines per language ([60fa7bc](https://github.com/Rytass/BPMCore/commit/60fa7bc))

### 🩹 Fixes

- **client:** cover blank node labels and never throw while translating lint ([0a8b3af](https://github.com/Rytass/BPMCore/commit/0a8b3af))
- **react:** sample money fields as numbers in the designer dry run ([35dbd9a](https://github.com/Rytass/BPMCore/commit/35dbd9a))
- **template:** address review of the lint translation ([26d7a54](https://github.com/Rytass/BPMCore/commit/26d7a54))

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

- **react:** fully specify relative imports in emitted declarations ([022b3e2](https://github.com/Rytass/BPMCore/commit/022b3e2))
- **react:** keep org unit and position picker menus on screen ([bb5cbaa](https://github.com/Rytass/BPMCore/commit/bb5cbaa))
- **react:** give the require condition CommonJS declarations ([ab0121b](https://github.com/Rytass/BPMCore/commit/ab0121b))
- **template:** return the id of a deleted category ([784f69e](https://github.com/Rytass/BPMCore/commit/784f69e))
- **template:** say a category in use cannot be deleted ([ab4236b](https://github.com/Rytass/BPMCore/commit/ab4236b))

### ❤️ Thank You

- Chia Yu Pai @fantasywind

## 0.17.0 (2026-10-15)

### 🚀 Features

- **client:** pass a successor unit when retiring an org unit ([e527c3c](https://github.com/Rytass/BPMCore/commit/e527c3c))
- **client:** add administrator task reassignment API wrappers ([eac273c](https://github.com/Rytass/BPMCore/commit/eac273c))
- ⚠️  **organization:** retire org units into a successor unit ([514e0b2](https://github.com/Rytass/BPMCore/commit/514e0b2))
- **react:** add member task reassignment modal to admin users ([f12e9f8](https://github.com/Rytass/BPMCore/commit/f12e9f8))
- **shared:** add POSITION approver fallback type ([2744b99](https://github.com/Rytass/BPMCore/commit/2744b99))
- **template:** lint blank POSITION fallback position ids ([2a29ece](https://github.com/Rytass/BPMCore/commit/2a29ece))
- **template:** allow lastDecision in edge conditions ([e8b4788](https://github.com/Rytass/BPMCore/commit/e8b4788))
- **template-designer:** let the fallback mode pick a position ([257a361](https://github.com/Rytass/BPMCore/commit/257a361))
- **toolset:** accept POSITION fallbacks in the assistant toolset ([7d0ddff](https://github.com/Rytass/BPMCore/commit/7d0ddff))
- **views:** ask for a successor unit before retiring an org unit ([b79cd5c](https://github.com/Rytass/BPMCore/commit/b79cd5c))
- **workflow-engine:** resolve POSITION fallbacks to every current holder ([a42bf54](https://github.com/Rytass/BPMCore/commit/a42bf54))
- **workflow-engine:** add administrator in-place task reassignment ([02ce920](https://github.com/Rytass/BPMCore/commit/02ce920))
- ⚠️  **workflow-engine:** end SLA-terminated instances as EXPIRED ([7dcca4e](https://github.com/Rytass/BPMCore/commit/7dcca4e))

### 🩹 Fixes

- ⚠️  **delegation:** order rules by priority, higher first ([96cca55](https://github.com/Rytass/BPMCore/commit/96cca55))
- **delegation:** check scope condition roots when a rule is saved ([bc8af75](https://github.com/Rytass/BPMCore/commit/bc8af75))
- **instance-detail:** show how a closed instance ended ([a110e08](https://github.com/Rytass/BPMCore/commit/a110e08))
- **migrations:** check pg_trgm with the other required extensions ([30a1e58](https://github.com/Rytass/BPMCore/commit/30a1e58))
- **organization:** keep a continued membership's original end date ([ce1f84f](https://github.com/Rytass/BPMCore/commit/ce1f84f))
- **react:** keep reassigned task titles and fit the result table ([3b90530](https://github.com/Rytass/BPMCore/commit/3b90530))
- **react:** drop a late member task listing in the reassignment modal ([1a7724e](https://github.com/Rytass/BPMCore/commit/1a7724e))
- **template:** check CEL roots per call site on publish ([868d236](https://github.com/Rytass/BPMCore/commit/868d236))
- **template-designer:** keep unknown approver fallbacks read-only ([5ea88fe](https://github.com/Rytass/BPMCore/commit/5ea88fe))
- **toolset:** read manager fallbacks and keep them across rewrites ([099b72f](https://github.com/Rytass/BPMCore/commit/099b72f))
- **workflow-engine:** refuse unknown approver fallback types by name ([15b8d1c](https://github.com/Rytass/BPMCore/commit/15b8d1c))
- **workflow-engine:** keep a group stage open when a holder transfers ([2cb0a96](https://github.com/Rytass/BPMCore/commit/2cb0a96))
- **workflow-engine:** keep the task holder and reject decided targets on group transfer ([515b3c2](https://github.com/Rytass/BPMCore/commit/515b3c2))

### 🔥 Performance

- **workflow-engine:** read member open task templates in one query ([49ae231](https://github.com/Rytass/BPMCore/commit/49ae231))

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

- **views:** drop empty parentheses when a member has no e-mail ([2b02a60](https://github.com/Rytass/BPMCore/commit/2b02a60))
- **views:** treat a blank member e-mail as missing ([d8504ed](https://github.com/Rytass/BPMCore/commit/d8504ed))
- **workflow-engine:** count only the member's own tasks on the dashboard ([8f12de3](https://github.com/Rytass/BPMCore/commit/8f12de3))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Kai-Chieh Yang

## 0.16.0 (2026-10-13)

### 🚀 Features

- ⚠️  **attachment:** boot without attachment settings ([808bc65](https://github.com/Rytass/BPMCore/commit/808bc65))

### 🩹 Fixes

- **api:** sign production sessions with a generated key when none is set ([ddf1e16](https://github.com/Rytass/BPMCore/commit/ddf1e16))

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

- **designer:** pick approvers from a member field and show readable dry-run assignees ([bc9592e](https://github.com/Rytass/BPMCore/commit/bc9592e))
- **designer:** show who submitted on the applicant's behalf in the instance detail ([4bcb291](https://github.com/Rytass/BPMCore/commit/4bcb291))
- **forms:** add a member field type ([0fca8d4](https://github.com/Rytass/BPMCore/commit/0fca8d4))
- **forms:** add store-only hidden fields and link display for text fields ([ae38a92](https://github.com/Rytass/BPMCore/commit/ae38a92))
- **inbox:** show node names instead of node ids in task lists ([e9e8f46](https://github.com/Rytass/BPMCore/commit/e9e8f46))
- **organization:** read effective dates in a configurable organizationTimeZone ([905982c](https://github.com/Rytass/BPMCore/commit/905982c))
- **workflow-client:** select nodeLabel wherever tasks are selected ([273bd4f](https://github.com/Rytass/BPMCore/commit/273bd4f))
- **workflow-engine:** add business_key column with per-template unique index ([cb1b9bf](https://github.com/Rytass/BPMCore/commit/cb1b9bf))
- **workflow-engine:** let hosts submit and look up instances by business key ([daa7d9d](https://github.com/Rytass/BPMCore/commit/daa7d9d))
- **workflow-engine:** require delegates and transfer targets on manager chains to match the grade they replace ([2cc0432](https://github.com/Rytass/BPMCore/commit/2cc0432))
- **workflow-engine:** add a nullable submitted-by column to approval instances ([06e7c97](https://github.com/Rytass/BPMCore/commit/06e7c97))
- **workflow-engine:** keep the member who submitted on someone's behalf out of excluding nodes ([0e02334](https://github.com/Rytass/BPMCore/commit/0e02334))
- **workflow-engine:** let the member who submitted for the applicant read the instance ([7416df8](https://github.com/Rytass/BPMCore/commit/7416df8))
- **workflow-engine:** tell the applicant who submitted the document on their behalf ([3a20985](https://github.com/Rytass/BPMCore/commit/3a20985))
- **workflow-engine:** select submittedByMemberId on the client instance record ([81e7f4d](https://github.com/Rytass/BPMCore/commit/81e7f4d))
- **workflow-engine:** expose the node name on tasks as nodeLabel ([25b0705](https://github.com/Rytass/BPMCore/commit/25b0705))

### 🩹 Fixes

- **designer:** stop re-requesting unresolvable members and warn on optional member fields ([8d6afa5](https://github.com/Rytass/BPMCore/commit/8d6afa5))
- **designer:** keep capped-out member ids eligible in the form renderer ([b8b4d4b](https://github.com/Rytass/BPMCore/commit/b8b4d4b))
- **designer:** say the sent list includes cases submitted on someone's behalf ([bfd928f](https://github.com/Rytass/BPMCore/commit/bfd928f))
- **forms:** keep member ids out of case titles and check member references on publish ([2b3c9c0](https://github.com/Rytass/BPMCore/commit/2b3c9c0))
- **forms:** harden hidden fields and link display after review ([9ce1f82](https://github.com/Rytass/BPMCore/commit/9ce1f82))
- **forms:** keep the new-tab cue out of copied link text ([4fcd8e8](https://github.com/Rytass/BPMCore/commit/4fcd8e8))
- **organization:** default organizationTimeZone to Asia/Taipei ([cc6b908](https://github.com/Rytass/BPMCore/commit/cc6b908))
- **shared:** default new nodes to the initiator's manager instead of a placeholder member id ([e2aed61](https://github.com/Rytass/BPMCore/commit/e2aed61))
- **shared:** freeze the default manager resolver every new node shares ([281aeb2](https://github.com/Rytass/BPMCore/commit/281aeb2))
- **template:** refuse a DYNAMIC_FORM resolver on a member field that can be left empty ([b3a3950](https://github.com/Rytass/BPMCore/commit/b3a3950))
- **template-designer:** sample a dry-run member field with a placeholder, not the initiator ([b567e41](https://github.com/Rytass/BPMCore/commit/b567e41))
- **template-designer:** name a member-field dry-run assignee by its field label ([465fcc3](https://github.com/Rytass/BPMCore/commit/465fcc3))
- **workflow-engine:** name the node and the org in approver-resolution errors and keep the dry run going ([f45bfaf](https://github.com/Rytass/BPMCore/commit/f45bfaf))
- **workflow-engine:** say 通知對象 for notify recipients ([226dbda](https://github.com/Rytass/BPMCore/commit/226dbda))
- **workflow-engine:** reject malformed member values on submit ([f13113e](https://github.com/Rytass/BPMCore/commit/f13113e))
- **workflow-engine:** translate missing org units and finish the dry-run edge cases ([b528aaa](https://github.com/Rytass/BPMCore/commit/b528aaa))
- **workflow-engine:** name the fallback problem in the dry-run manager message ([7f571f0](https://github.com/Rytass/BPMCore/commit/7f571f0))
- **workflow-engine:** harden business key lookup and count its length in characters ([844ce82](https://github.com/Rytass/BPMCore/commit/844ce82))
- **workflow-engine:** skip the submitter before choosing the initiator-manager replacement tier ([355373e](https://github.com/Rytass/BPMCore/commit/355373e))
- **workflow-engine:** keep every refused delegation on record when the dedupe or a kept stored member hides its row ([aad1c8c](https://github.com/Rytass/BPMCore/commit/aad1c8c))
- **workflow-engine:** leave out the refusals of seats the initiator exclusion removes ([959912e](https://github.com/Rytass/BPMCore/commit/959912e))
- **workflow-engine:** index the submitter column that the sent list now matches ([557f458](https://github.com/Rytass/BPMCore/commit/557f458))
- **workflow-engine:** bound the submitter name lookup inside the approval transaction ([dbf1d3b](https://github.com/Rytass/BPMCore/commit/dbf1d3b))
- **workflow-engine:** normalise the ad-hoc task nodeLabel like the list paths ([ded39e9](https://github.com/Rytass/BPMCore/commit/ded39e9))
- **workflow-engine:** consume the token of a NOTIFY node skipped by its entry condition ([#78](https://github.com/Rytass/BPMCore/issues/78))
- **workflow-engine:** end a dry-run skip reason with a full stop before the stop reason ([8a855f4](https://github.com/Rytass/BPMCore/commit/8a855f4))
- **workflow-engine:** read task node labels from the entity's own table path ([16d6e8e](https://github.com/Rytass/BPMCore/commit/16d6e8e))

### 🔥 Performance

- **notification:** name the submitter at submit instead of inside the approval transaction ([da64763](https://github.com/Rytass/BPMCore/commit/da64763))
- **workflow-engine:** read task node labels in Postgres instead of loading whole snapshots ([65bbbe1](https://github.com/Rytass/BPMCore/commit/65bbbe1))
- **workflow-engine:** batch the grade lookups of a manager-chain node's delegations ([99ae382](https://github.com/Rytass/BPMCore/commit/99ae382))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5.5
- Kai-Chieh Yang

## 0.14.0 (2026-10-12)

### 🚀 Features

- **designer:** configure the ORG_MANAGER_CHAIN resolver in the template designer ([ab64fe4](https://github.com/Rytass/BPMCore/commit/ab64fe4))
- **designer:** configure initiator exclusion on user task nodes ([b7b51cd](https://github.com/Rytass/BPMCore/commit/b7b51cd))
- **designer:** offer SEQUENTIAL again and show signing order in task views ([ed38d04](https://github.com/Rytass/BPMCore/commit/ed38d04))
- **workflow-engine:** add ORG_MANAGER_CHAIN resolver that walks up to a position level ([001af84](https://github.com/Rytass/BPMCore/commit/001af84))
- **workflow-engine:** let a user task exclude the initiator from its approvers ([a4c6e51](https://github.com/Rytass/BPMCore/commit/a4c6e51))
- ⚠️  **workflow-engine:** make SEQUENTIAL sign one candidate at a time ([70e9cde](https://github.com/Rytass/BPMCore/commit/70e9cde))
- **workflow-engine:** sign manager chains in order and keep the initiator out of re-delegation ([6eaf1e6](https://github.com/Rytass/BPMCore/commit/6eaf1e6))

### 🩹 Fixes

- **designer:** explain the chain policy switch and keep the chain fallback in the toolset ([743df14](https://github.com/Rytass/BPMCore/commit/743df14))
- **designer:** show the signing order and turn hand-offs in the instance timeline ([7ade44a](https://github.com/Rytass/BPMCore/commit/7ade44a))
- **toolset:** show initiator exclusion in node summaries ([5ea8ea5](https://github.com/Rytass/BPMCore/commit/5ea8ea5))
- **workflow-engine:** move open pre-approvals to the new holder on transfer ([685a387](https://github.com/Rytass/BPMCore/commit/685a387))
- **workflow-engine:** scope the transfer re-point to pre-approvals on the origin node ([70d99d7](https://github.com/Rytass/BPMCore/commit/70d99d7))
- **workflow-engine:** let ORG_MANAGER_CHAIN climb past unit heads under org-unit rules ([5baa2e6](https://github.com/Rytass/BPMCore/commit/5baa2e6))
- **workflow-engine:** filter the initiator before dedupe and keep exclusion nodes completable ([5a6570a](https://github.com/Rytass/BPMCore/commit/5a6570a))
- **workflow-engine:** pin the initiator-manager fallback and treat a null exclusion as off ([6402e54](https://github.com/Rytass/BPMCore/commit/6402e54))
- **workflow-engine:** follow a transfer when a pre-approval points at a transferred task ([5132a80](https://github.com/Rytass/BPMCore/commit/5132a80))
- **workflow-engine:** re-delegate on activation, anchor the SLA warning and give consumers a turn signal ([f50c781](https://github.com/Rytass/BPMCore/commit/f50c781))
- **workflow-engine:** reopen a rejected pre-approval for its requester on sequential tasks ([2cf8004](https://github.com/Rytass/BPMCore/commit/2cf8004))
- **workflow-engine:** reopen for the requester across a sequential transfer and align the sequential-origin check ([d657320](https://github.com/Rytass/BPMCore/commit/d657320))

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

- Chia Yu Pai @fantasywind
- Claude Opus 5.5
- Kai-Chieh Yang

## 0.13.5 (2026-10-12)

### 🩹 Fixes

- **deps:** patch critical advisories in next, handlebars, proxy-addr and shell-quote ([c58a51a](https://github.com/Rytass/BPMCore/commit/c58a51a))
- **workflow-engine:** keep ad-hoc fields on the task a transfer creates ([d6732ef](https://github.com/Rytass/BPMCore/commit/d6732ef))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5
- Claude Opus 5.5
- Kai-Chieh Yang

## 0.13.4 (2026-09-17)

### 🚀 Features

- **admin:** add the webhook endpoints page ([ac03c59](https://github.com/Rytass/BPMCore/commit/ac03c59))
- **api:** add demo webhook endpoints and an in-process receiver ([6e16f28](https://github.com/Rytass/BPMCore/commit/6e16f28))
- **api:** read the demo webhook secret from Vault and simulate receivers ([6db467b](https://github.com/Rytass/BPMCore/commit/6db467b))
- **api:** enable database webhook endpoints in the wrapper host ([1fceb88](https://github.com/Rytass/BPMCore/commit/1fceb88))
- **bpm:** make every BPMRootModule option optional and async-loadable ([0966edb](https://github.com/Rytass/BPMCore/commit/0966edb))
- **bpm:** wire the webhook endpoint registry into BPMRootModule ([0009643](https://github.com/Rytass/BPMCore/commit/0009643))
- **bpm-core-react:** give an approval comment its own line in the timeline ([2b03494](https://github.com/Rytass/BPMCore/commit/2b03494))
- **bpm-core-react:** let an approver add several people at once ([4543bee](https://github.com/Rytass/BPMCore/commit/4543bee))
- **client:** add webhook delivery listing and retry ([89387ae](https://github.com/Rytass/BPMCore/commit/89387ae))
- **client:** add the webhook endpoint catalog query ([9e2c927](https://github.com/Rytass/BPMCore/commit/9e2c927))
- **client:** add webhook endpoint administration API ([0fa9c2a](https://github.com/Rytass/BPMCore/commit/0fa9c2a))
- **instance-detail:** show webhook deliveries to administrators ([4e1e3c1](https://github.com/Rytass/BPMCore/commit/4e1e3c1))
- **template:** lint notify webhooks when publishing a template ([b6f75ec](https://github.com/Rytass/BPMCore/commit/b6f75ec))
- **template:** check webhook endpoints and bindings before publishing ([8c40553](https://github.com/Rytass/BPMCore/commit/8c40553))
- **template-designer:** configure notify node webhooks ([813a03e](https://github.com/Rytass/BPMCore/commit/813a03e))
- **workflow:** make a multi-person ad-hoc countersign need everyone ([f13e227](https://github.com/Rytass/BPMCore/commit/f13e227))
- **workflow:** add the notify webhook contract to the shared lib ([e240632](https://github.com/Rytass/BPMCore/commit/e240632))
- **workflow-webhook:** add the endpoint registry, catalog and allowlist ([82afe97](https://github.com/Rytass/BPMCore/commit/82afe97))
- **workflow-webhook:** deliver notify webhooks through a transactional outbox ([cbb277f](https://github.com/Rytass/BPMCore/commit/cbb277f))
- **workflow-webhook:** let administrators inspect and retry deliveries ([4a6128b](https://github.com/Rytass/BPMCore/commit/4a6128b))
- **workflow-webhook:** manage notify webhook endpoints in the database ([63e2f95](https://github.com/Rytass/BPMCore/commit/63e2f95))

### 🩹 Fixes

- **bpm-core-react:** restore the separator and colour of a timeline comment ([9f58b49](https://github.com/Rytass/BPMCore/commit/9f58b49))
- **bpm-core-react:** import ActivityLogRecord from the subpath that exports it ([31455c7](https://github.com/Rytass/BPMCore/commit/31455c7))
- **client:** tolerate hosts that omit the webhook deliveries field ([a0c00f1](https://github.com/Rytass/BPMCore/commit/a0c00f1))
- **delegation:** hand back an entity from the rule mutations ([02acc1b](https://github.com/Rytass/BPMCore/commit/02acc1b))
- **delegation:** let the member tooltip reach assistive technology ([c6c355f](https://github.com/Rytass/BPMCore/commit/c6c355f))
- **designer:** judge notify nodes with the shared rule ([30f1077](https://github.com/Rytass/BPMCore/commit/30f1077))
- **notification:** hand back an entity from the preference mutation ([3a9ab2c](https://github.com/Rytass/BPMCore/commit/3a9ab2c))
- **template-designer:** start number webhook constants empty ([c64bf20](https://github.com/Rytass/BPMCore/commit/c64bf20))
- **workflow:** keep cancelled rows as entities so their GraphQL getters resolve ([746fdb3](https://github.com/Rytass/BPMCore/commit/746fdb3))
- **workflow:** report the state a submit actually committed ([67da905](https://github.com/Rytass/BPMCore/commit/67da905))
- **workflow:** stop an end node completing the case twice ([e4b1931](https://github.com/Rytass/BPMCore/commit/e4b1931))
- **workflow:** guard the completion against an active task too ([3ae69e7](https://github.com/Rytass/BPMCore/commit/3ae69e7))
- **workflow:** drop a task from the inbox once that member has decided it ([187d38d](https://github.com/Rytass/BPMCore/commit/187d38d))
- **workflow:** keep a cast vote visible while the countersign waits ([a2a6f21](https://github.com/Rytass/BPMCore/commit/a2a6f21))
- **workflow:** let the engine pick its service task dispatcher ([21bcde4](https://github.com/Rytass/BPMCore/commit/21bcde4))
- **workflow-engine:** let a webhook-only notify node run ([2e2813a](https://github.com/Rytass/BPMCore/commit/2e2813a))
- **workflow-engine:** end dry-run branches at notify nodes ([6850920](https://github.com/Rytass/BPMCore/commit/6850920))
- **workflow-webhook:** harden the P1 catalog after independent review ([0ea9790](https://github.com/Rytass/BPMCore/commit/0ea9790))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5
- Claude Opus 5 (1M context)
- Kai-Chieh Yang

## 0.13.3 (2026-09-04)

### 🩹 Fixes

- **attachment:** validate the signing secret at bootstrap, not at import ([d07f996](https://github.com/Rytass/BPMCore/commit/d07f996))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

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

- **bpm-auth:** let a host stamp its own route metadata on BPM resolvers ([49bedb7](https://github.com/Rytass/BPMCore/commit/49bedb7))
- **client:** add deletePosition ([2375fb2](https://github.com/Rytass/BPMCore/commit/2375fb2))
- **identity:** let a host turn off the identity GraphQL queries ([33630f8](https://github.com/Rytass/BPMCore/commit/33630f8))
- **orgs:** let an admin delete a position, and show why a delete was refused ([a9b3408](https://github.com/Rytass/BPMCore/commit/a9b3408))

### 🩹 Fixes

- ⚠️  **attachment:** refuse to sign production attachment URLs with the public dev key ([c40ce67](https://github.com/Rytass/BPMCore/commit/c40ce67))
- **bpm-auth:** list only real GraphQL handlers, and keep symbol metadata keys ([9cc4593](https://github.com/Rytass/BPMCore/commit/9cc4593))
- **condition:** load cel-js on first use, not on import ([e2a64c9](https://github.com/Rytass/BPMCore/commit/e2a64c9))
- **condition:** name the Node version when cel-js cannot be required ([2691e63](https://github.com/Rytass/BPMCore/commit/2691e63))
- **migrations:** explain what to do when CREATE EXTENSION is denied ([a0c9c38](https://github.com/Rytass/BPMCore/commit/a0c9c38))
- **migrations:** stop dropping extensions this migration may not have created ([88256d1](https://github.com/Rytass/BPMCore/commit/88256d1))
- **organization:** let update inputs say "leave this alone", and allow deleting a position ([e09e012](https://github.com/Rytass/BPMCore/commit/e09e012))
- **template:** let UpdateApprovalTemplateInput say "keep the category" ([c11c248](https://github.com/Rytass/BPMCore/commit/c11c248))

### ⚠️  Breaking Changes

- **attachment:** refuse to sign production attachment URLs with the public dev key  ([c40ce67](https://github.com/Rytass/BPMCore/commit/c40ce67))
  a NODE_ENV=production process that never set
  attachmentSignedUrlSecret no longer starts. BPMRootModule mounts
  AttachmentModule unconditionally, so this reaches hosts that serve no
  attachments at all. Set the secret, or set
  attachmentAllowInsecureSignedUrlSecret: true to acknowledge that the signing
  key is public.
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016VKxnq3cFuySFMLMZhtd2E

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.12.0 (2026-08-27)

### 🚀 Features

- **condition:** compile table emptiness from the row count ([624c96d](https://github.com/Rytass/BPMCore/commit/624c96d))
- **demo:** seed a table field purchase scenario ([ab5661e](https://github.com/Rytass/BPMCore/commit/ab5661e))
- **form:** add table field definitions to the shared contract ([5f97165](https://github.com/Rytass/BPMCore/commit/5f97165))
- **form:** lint table field structure before publishing ([d9e95ee](https://github.com/Rytass/BPMCore/commit/d9e95ee))
- **form:** validate submitted table form data ([69036d1](https://github.com/Rytass/BPMCore/commit/69036d1))
- **form:** validate and seed table values in the renderer helpers ([5c7edab](https://github.com/Rytass/BPMCore/commit/5c7edab))
- **form:** render table fields with per-row editing ([5a04d7d](https://github.com/Rytass/BPMCore/commit/5a04d7d))
- **form:** add table column factories and row-scoped binding rename ([0c8c07d](https://github.com/Rytass/BPMCore/commit/0c8c07d))
- **form:** design table fields in the builder ([f70ac0c](https://github.com/Rytass/BPMCore/commit/f70ac0c))
- **form:** resolve table column DataSources per cell ([ca40a4c](https://github.com/Rytass/BPMCore/commit/ca40a4c))
- **form:** wire cell-level DataSources through the client and renderer ([c7561ad](https://github.com/Rytass/BPMCore/commit/c7561ad))
- **template:** reject published conditions that address table internals ([04d74e3](https://github.com/Rytass/BPMCore/commit/04d74e3))
- **workflow:** keep tables out of case titles and summarise them by row count ([b5453c8](https://github.com/Rytass/BPMCore/commit/b5453c8))

### 🩹 Fixes

- **condition:** keep table values from deciding form conditions ([894ef00](https://github.com/Rytass/BPMCore/commit/894ef00))
- **condition:** never match an edge value comparison against row records ([58b4194](https://github.com/Rytass/BPMCore/commit/58b4194))
- **form:** validate and submit the values the renderer actually shows ([0dda76a](https://github.com/Rytass/BPMCore/commit/0dda76a))
- **form:** keep the column key input mounted while it is being typed ([5d15da8](https://github.com/Rytass/BPMCore/commit/5d15da8))
- **form:** read a required cell as an own property in the renderer validator ([f20a03f](https://github.com/Rytass/BPMCore/commit/f20a03f))
- **form:** keep the DataSource picker out of table column settings ([cd264d0](https://github.com/Rytass/BPMCore/commit/cd264d0))
- **form:** report a table column's binding lint as an actionable binding error ([ed4fed2](https://github.com/Rytass/BPMCore/commit/ed4fed2))
- **form:** read required DataSource parameters as own properties ([a5895a7](https://github.com/Rytass/BPMCore/commit/a5895a7))
- **form:** keep a table's row indexes stable past a malformed row ([21d5a57](https://github.com/Rytass/BPMCore/commit/21d5a57))
- **form:** warn about table columns bound to a field being removed ([80c7471](https://github.com/Rytass/BPMCore/commit/80c7471))
- **form:** keep the table field out of the single-column width cap ([0ca798f](https://github.com/Rytass/BPMCore/commit/0ca798f))
- **form:** make every table column type reachable in the builder ([b596640](https://github.com/Rytass/BPMCore/commit/b596640))
- **form:** name fields, columns and parameters in builder DataSource copy ([b9d703a](https://github.com/Rytass/BPMCore/commit/b9d703a))
- **form:** select a table column after its type changes ([2a511e2](https://github.com/Rytass/BPMCore/commit/2a511e2))
- **form:** stop the field settings sprawling across a wide screen ([a697705](https://github.com/Rytass/BPMCore/commit/a697705))
- **form:** size a table cell's control to the table it sits in ([db79e5e](https://github.com/Rytass/BPMCore/commit/db79e5e))
- **form:** track the open table column by index, not by key ([1928f61](https://github.com/Rytass/BPMCore/commit/1928f61))
- **form:** line up the field settings inputs across every field type ([2d8c128](https://github.com/Rytass/BPMCore/commit/2d8c128))
- **form:** only confirm a column retype when it discards something ([baf7c9b](https://github.com/Rytass/BPMCore/commit/baf7c9b))
- **form:** stop the DataSource parameter label breaking mid-word ([fe4c609](https://github.com/Rytass/BPMCore/commit/fe4c609))
- **form:** make the DataSource block readable by a process designer ([fec8518](https://github.com/Rytass/BPMCore/commit/fec8518))
- **form:** name the DataSource check for what it actually checks ([1138ef1](https://github.com/Rytass/BPMCore/commit/1138ef1))
- **form:** stop promising a search threshold the source does not have ([8c8b311](https://github.com/Rytass/BPMCore/commit/8c8b311))
- **form:** put each DataSource condition on one row ([051bb43](https://github.com/Rytass/BPMCore/commit/051bb43))
- **form:** drop the confirmation for changing the option source ([14ce722](https://github.com/Rytass/BPMCore/commit/14ce722))
- **form:** fit the condition table to what it has to show ([c89b4d1](https://github.com/Rytass/BPMCore/commit/c89b4d1))
- **template:** close the whitespace gap in the table-internals condition lint ([6d15d07](https://github.com/Rytass/BPMCore/commit/6d15d07))
- **workflow:** stop nested form writes from replacing a non-record value ([336951c](https://github.com/Rytass/BPMCore/commit/336951c))
- **workflow:** no-op indexed set-form-field paths and read cells as own properties ([952b7bf](https://github.com/Rytass/BPMCore/commit/952b7bf))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5 (1M context)

## 0.11.0 (2026-08-18)

### 🚀 Features

- **notification:** bound delivery dispatch with a timeout ([d8115f0](https://github.com/Rytass/BPMCore/commit/d8115f0))

### 🩹 Fixes

- **notification:** move nodemailer to ^9.0.1 ([e094738](https://github.com/Rytass/BPMCore/commit/e094738))
- **notification:** read claimed ids from the UPDATE result pair ([2fe6e44](https://github.com/Rytass/BPMCore/commit/2fe6e44))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5

## 0.10.0 (2026-08-18)

### 🚀 Features

- **form-data-source:** add read-only resolve queries and dependency-wait signals ([e8d9b78](https://github.com/Rytass/BPMCore/commit/e8d9b78))
- **notification:** honour recipient preferences instead of dropping rows ([576b8c4](https://github.com/Rytass/BPMCore/commit/576b8c4))
- **template:** let hosts observe changes and refuse deactivated publishes ([3882dc2](https://github.com/Rytass/BPMCore/commit/3882dc2))

### 🩹 Fixes

- **api:** accept full-size uploads and report oversized ones as 413 ([3b12d61](https://github.com/Rytass/BPMCore/commit/3b12d61))
- **api:** stop GraphQL errors leaking implementation detail ([5a31c6a](https://github.com/Rytass/BPMCore/commit/5a31c6a))
- **attachment:** widen the insecure-secret warning and reject blank tokens ([894b7ea](https://github.com/Rytass/BPMCore/commit/894b7ea))

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

- **bpm-core-react:** let the designer configure the decision policy ([6a4caf1](https://github.com/Rytass/BPMCore/commit/6a4caf1))
- **notification:** let a host observe notifications as they are created ([#21](https://github.com/Rytass/BPMCore/pull/21))
- **notification:** lift routing fields onto the created event ([e02270b](https://github.com/Rytass/BPMCore/commit/e02270b))
- **shared:** add a command for the user task decision policy ([9d719bb](https://github.com/Rytass/BPMCore/commit/9d719bb))
- **shared:** expose the decision policy to the workflow toolset ([f6152b0](https://github.com/Rytass/BPMCore/commit/f6152b0))
- **shared:** detect a quorum no approver set can ever satisfy ([5671497](https://github.com/Rytass/BPMCore/commit/5671497))

### 🩹 Fixes

- **bpm-core-react:** show only the latest member search results ([9804d37](https://github.com/Rytass/BPMCore/commit/9804d37))
- **bpm-core-react:** correct decision-policy panel review findings ([ebf0337](https://github.com/Rytass/BPMCore/commit/ebf0337))
- **bpm-core-react:** stop member pickers offering stale or phantom rows ([f4f82c9](https://github.com/Rytass/BPMCore/commit/f4f82c9))
- **bpm-core-react:** cap PERCENTAGE quorum threshold and sanitise every write ([d70528a](https://github.com/Rytass/BPMCore/commit/d70528a))
- **bpm-core-react:** tolerate malformed stored quorum policies ([f4fcb41](https://github.com/Rytass/BPMCore/commit/f4fcb41))
- **bpm-core-react:** stop re-applying an unsatisfiable policy ([e548f14](https://github.com/Rytass/BPMCore/commit/e548f14))
- **bpm-core-react:** keep the dropped-policy notice on screen ([7557dc8](https://github.com/Rytass/BPMCore/commit/7557dc8))
- **bpm-core-react:** finish the member picker's stale-response handling ([dda3692](https://github.com/Rytass/BPMCore/commit/dda3692))
- **bpm-core-react:** re-request members left as unresolved placeholders ([567c776](https://github.com/Rytass/BPMCore/commit/567c776))
- **bpm-core-react:** stop the dropped-policy notice outliving its subject ([7fddefe](https://github.com/Rytass/BPMCore/commit/7fddefe))
- **bpm-core-react:** stop the member resolve effect looping on failure ([a0bfa66](https://github.com/Rytass/BPMCore/commit/a0bfa66))
- **e2e:** poll on the expected value in the quorum threshold sanitiser spec ([099529f](https://github.com/Rytass/BPMCore/commit/099529f))
- **shared:** keep an approver change from discarding a workable policy ([ea6afbe](https://github.com/Rytass/BPMCore/commit/ea6afbe))
- **template:** block publishing a deadlocked quorum node ([89ab6a2](https://github.com/Rytass/BPMCore/commit/89ab6a2))
- **template:** let a template actually change category ([#17](https://github.com/Rytass/BPMCore/pull/17))
- ⚠️  **template:** reject deleting a referenced category ([#16](https://github.com/Rytass/BPMCore/pull/16))

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

## 0.7.0 (2026-08-10)

### 🚀 Features

- **api:** register a Taiwan business calendar for the wrapper app ([79a4bbe](https://github.com/Rytass/BPMCore/commit/79a4bbe))
- **bpm-core:** resolve task SLA due dates through a host business calendar ([3cb9d4d](https://github.com/Rytass/BPMCore/commit/3cb9d4d))
- **bpm-core:** enforce required return comments ([6cb288f](https://github.com/Rytass/BPMCore/commit/6cb288f))
- **bpm-core:** lint the new SLA and return-behaviour node fields ([f10c0bb](https://github.com/Rytass/BPMCore/commit/f10c0bb))
- **bpm-core-react:** add SLA and return-comment controls to the designer ([2f30f2c](https://github.com/Rytass/BPMCore/commit/2f30f2c))
- **shared:** add business-day SLA and required return comment contracts ([584acd7](https://github.com/Rytass/BPMCore/commit/584acd7))

### 🩹 Fixes

- **bpm-core:** stop SLA escalation from walking the whole management chain ([f7e4669](https://github.com/Rytass/BPMCore/commit/f7e4669))

### ❤️ Thank You

- Chia Yu Pai @fantasywind
- Claude Opus 5 (1M context)