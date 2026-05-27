---
name: planning-bpm-e2e-coverage
description: Plan comprehensive BPMCore end-to-end verification coverage. Use when asked to create, review, expand, or execute a complete/100% e2e test plan for BPMCore features, local develop seeded journeys, staging verification, Playwright suites, GraphQL/API coverage, workflow runtime behavior, or wrapper-app integration validation.
---

# Planning BPM E2E Coverage

Use this skill to produce or update a complete BPMCore e2e verification plan.
Default to Taiwan Traditional Chinese. Do not run tests unless the user
explicitly asks to execute validation.

## Scope

Plan coverage for the current BPMCore repository:

- `apps/api`: NestJS wrapper host, auth/session endpoints, Vault-backed DB,
  GraphQL, migrations, reset/seeding.
- `apps/client`: Next.js backoffice UI.
- `libs/bpm-core`: embeddable BPM modules, GraphQL APIs, entities, migrations,
  workflow runtime, host integration contracts.
- `libs/shared`: form/workflow/condition/identity/organization shared types.

Do not include roadmap items that are still unimplemented unless the user asks
for future coverage. Mark those as out of current functional scope.

## Planning Workflow

1. Inspect current implementation before planning:
   - `AGENTS.md`
   - `README.md`
   - `docs/09-roadmap.md`
   - `apps/client/src/app/**/page.tsx`
   - `apps/client-e2e/specs/*.ts`
   - `libs/bpm-core/src/lib/**/*.queries.ts`
   - `libs/bpm-core/src/lib/**/*.mutations.ts`
   - `apps/api/src/app/*controller.ts`
   - `apps/api/tools/reset-demo-data.ts`
2. Separate coverage into these layers:
   - environment/migration/seed
   - auth/session
   - UI routes
   - GraphQL Query/Mutation surface
   - workflow runtime behavior
   - wrapper-app integration contracts
   - security/readability permissions
   - performance/query/index coverage
3. For each feature, specify:
   - user journey
   - setup data or seeded account
   - UI assertions
   - API/GraphQL assertions
   - DB or artifact assertions where useful
   - negative/permission cases
4. Prefer real develop/staging data paths over GraphQL mocks for 100% coverage.
   Mocked Playwright specs are acceptable only as fast smoke coverage.
5. If asked to implement the plan, add tests incrementally and verify each
   finished slice with focused Playwright runs plus relevant typecheck/lint/unit
   checks.

## Required Coverage Matrix

For the full current matrix, read:

- `references/coverage-matrix.md`

Use that file as the baseline when the user asks for a complete plan. Update it
when new implemented features are discovered.

## Local Verification Assumptions

The user normally starts dev servers manually. Before any execution plan,
include checks for:

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:17602
curl -s -o /dev/null -w '%{http_code}' http://localhost:17603/graphql
curl -s -o /dev/null -w '%{http_code}' http://localhost:17603/api/health
```

`17603/graphql` returning `400` for a bare GET is acceptable; it indicates the
GraphQL endpoint is reachable.

For deterministic full coverage, plan to reset develop seed first:

```bash
pnpm demo:reset
```

Only propose running this when destructive reset is acceptable.

## Output Format

When the user asks for a plan, return:

1. Coverage principles.
2. Preconditions and seed strategy.
3. E2E suite matrix.
4. Gap list: existing specs vs missing specs.
5. Completion criteria.
6. Suggested execution order.

Keep the plan implementation-focused. Avoid generic QA advice.
