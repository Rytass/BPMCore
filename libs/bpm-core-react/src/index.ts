// Library-root subpath. Exposes the framework-agnostic providers, hooks, and
// shared components that every BPM view depends on. Page wrappers (Next.js
// Server Component shims) live under `./pages/*`. Pure presentational views
// live under `./views/*`.

export * from './lib/auth-provider';
export * from './lib/format-date-time';
export * from './lib/notification-drawer-provider';
export * from './lib/notification-unread-provider';
export * from './lib/providers';
export * from './lib/router-adapter';
export * from './lib/routes-config';

export * from './components/admin-pickers';
export * from './components/app-navigation';
export * from './components/approval-instance-list-page';
export * from './components/bpm-form-field';
export * from './components/dashboard-page';
export * from './components/notification-drawer';
