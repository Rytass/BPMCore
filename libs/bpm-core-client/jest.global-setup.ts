// `form-rendering.spec.ts` asserts calendar-day math that only diverges from
// UTC east of the prime meridian, so the suite needs a non-UTC zone pinned.
//
// Pinning `process.env.TZ` inside the spec file (e.g. in `beforeAll`) does
// NOT work: Jest replaces `process.env` inside the sandboxed test
// environment with a plain object, so assigning to `.TZ` there is silently
// inert — the real Node/ICU timezone cache is never invalidated. `TZ` must
// be set before the process that actually resolves dates/`Intl` is created.
//
// `globalSetup` runs once in Jest's main process before it forks the worker
// processes that execute test files, and `child_process.fork` (which Jest's
// worker pool uses) inherits the parent's `process.env` at fork time. So
// setting `TZ` here — on the real `process.env`, in the real main process —
// is what actually reaches the workers' Node runtime.
export default async function globalSetup(): Promise<void> {
  process.env.TZ = 'Asia/Taipei';
}
