import type { ApprovalTemplateLaunchMode } from '@rytass/bpm-core-client/template';

/** 發起方式 option shown in the designer and the compose wizard. */
export interface LaunchModeOption {
  readonly id: ApprovalTemplateLaunchMode;
  readonly name: string;
  readonly description: string;
}

const LAUNCH_MODE_OPTION_BY_ID: Readonly<
  Record<ApprovalTemplateLaunchMode, LaunchModeOption>
> = {
  HOST_ONLY: {
    description:
      '不會出現在發起清單，使用者無法從畫面送出或重送；由串接系統以程式送件。',
    id: 'HOST_ONLY',
    name: '僅限系統送件',
  },
  OPEN: {
    description: '出現在發起清單，使用者可從畫面送出。',
    id: 'OPEN',
    name: '一般發起',
  },
};

export const LAUNCH_MODE_OPTIONS: readonly LaunchModeOption[] = [
  LAUNCH_MODE_OPTION_BY_ID.OPEN,
  LAUNCH_MODE_OPTION_BY_ID.HOST_ONLY,
];

/** A template with no stored mode, or an unknown value, behaves as OPEN. */
export const DEFAULT_LAUNCH_MODE: ApprovalTemplateLaunchMode = 'OPEN';

export function readLaunchMode(
  value: string | null | undefined,
): ApprovalTemplateLaunchMode {
  return value === 'HOST_ONLY' ? 'HOST_ONLY' : DEFAULT_LAUNCH_MODE;
}

export function readLaunchModeOption(
  mode: ApprovalTemplateLaunchMode,
): LaunchModeOption {
  return LAUNCH_MODE_OPTION_BY_ID[mode];
}

/**
 * Draft-save input fragment. `launchMode` is always sent so the server stores
 * the mode the user sees; an omitted field would keep whatever is stored.
 */
export function buildDraftLaunchModeInput(
  launchMode: ApprovalTemplateLaunchMode,
): { readonly launchMode: ApprovalTemplateLaunchMode } {
  return { launchMode };
}
