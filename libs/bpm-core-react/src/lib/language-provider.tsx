'use client';

import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * Languages BPM views can write their messages in. This is separate from the
 * Mezzanine calendar `locale` on `<Providers>`, which only formats dates.
 */
export type BPMLanguage = 'en' | 'zh-TW';

export const DEFAULT_BPM_LANGUAGE: BPMLanguage = 'zh-TW';

export const BPM_LANGUAGES: readonly BPMLanguage[] = ['zh-TW', 'en'];

const BPMLanguageContext = createContext<BPMLanguage>(DEFAULT_BPM_LANGUAGE);

interface BPMLanguageProviderProps {
  readonly children: ReactNode;
  readonly language: BPMLanguage;
}

/**
 * Sets the language BPM views write their messages in. Hosts that let a user
 * choose pass that choice here as state; a change re-renders every view below.
 *
 * Outside this provider `useBPMLanguage()` answers `'zh-TW'`, so views render
 * in tests and Storybook without it.
 */
export function BPMLanguageProvider({
  children,
  language,
}: BPMLanguageProviderProps): ReactElement {
  return (
    <BPMLanguageContext.Provider value={language}>
      {children}
    </BPMLanguageContext.Provider>
  );
}

export function useBPMLanguage(): BPMLanguage {
  return useContext(BPMLanguageContext);
}
