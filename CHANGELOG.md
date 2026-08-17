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