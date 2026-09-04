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