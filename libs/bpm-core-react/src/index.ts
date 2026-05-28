// Library-root subpath. Exposes the framework-agnostic providers, hooks, and
// shared components that every BPM view depends on. Page wrappers (Next.js
// Server Component shims) live under `./pages/*`. Pure presentational views
// live under `./views/*`.
//
// The library does NOT ship a navigation shell / sidebar / top bar. Hosts
// are expected to mount BPM views inside their own layout chrome and wire
// the host nav themselves. The exports below provide the building blocks
// hosts need to integrate BPM into their existing chrome (auth member,
// logout, notification bell + unread badge, drawer overlay, etc.).

export * from './lib/auth-provider';
export * from './lib/format-date-time';
export * from './lib/notification-drawer-provider';
export * from './lib/notification-unread-provider';
export * from './lib/providers';
export * from './lib/router-adapter';
export * from './lib/routes-config';
export * from './lib/use-bpm-logout';
export * from './lib/use-bpm-member';

export * from './components/admin-pickers';
export * from './components/approval-instance-list-page';
export * from './components/bpm-form-field';
export * from './components/bpm-notification-bell-button';
export * from './components/dashboard-page';
export * from './components/notification-drawer';
