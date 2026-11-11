'use client';

import {
  createContext,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react';
import { DEFAULT_BPM_ORGANIZATION_TIME_ZONE } from '@rytass/bpm-core-shared';
import { resolveOrganizationTimeZone } from './organization-time-zone';

const BPMOrganizationTimeZoneContext = createContext<string>(
  DEFAULT_BPM_ORGANIZATION_TIME_ZONE,
);

interface BPMOrganizationTimeZoneProviderProps {
  readonly children: ReactNode;
  /**
   * IANA zone the host passes to `BPMRootModule` as `organizationTimeZone`.
   * Blank or missing means `DEFAULT_BPM_ORGANIZATION_TIME_ZONE`; an unknown
   * zone falls back to it with a console warning.
   */
  readonly timeZone?: string;
}

/**
 * Tells BPM views which zone "today" is read in against organization effective
 * dates, so the template designer's position pickers and dry run agree with
 * the engine's `organizationTimeZone`.
 *
 * Outside this provider `useBPMOrganizationTimeZone()` answers the default.
 */
export function BPMOrganizationTimeZoneProvider({
  children,
  timeZone,
}: BPMOrganizationTimeZoneProviderProps): ReactElement {
  const resolvedTimeZone = useMemo(
    (): string => resolveOrganizationTimeZone(timeZone),
    [timeZone],
  );

  return (
    <BPMOrganizationTimeZoneContext.Provider value={resolvedTimeZone}>
      {children}
    </BPMOrganizationTimeZoneContext.Provider>
  );
}

export function useBPMOrganizationTimeZone(): string {
  return useContext(BPMOrganizationTimeZoneContext);
}
