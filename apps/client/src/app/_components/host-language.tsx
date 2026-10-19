'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  BPM_LANGUAGES,
  DEFAULT_BPM_LANGUAGE,
  type BPMLanguage,
} from '@rytass/bpm-core-react';

const STORAGE_KEY = 'bpm-client-language';

interface HostLanguageContextValue {
  readonly language: BPMLanguage;
  readonly setLanguage: (language: BPMLanguage) => void;
}

const HostLanguageContext = createContext<HostLanguageContextValue>({
  language: DEFAULT_BPM_LANGUAGE,
  setLanguage: (): void => undefined,
});

function readStoredLanguage(): BPMLanguage | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    return BPM_LANGUAGES.find((language) => language === stored) ?? null;
  } catch {
    return null;
  }
}

function storeLanguage(language: BPMLanguage): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Private windows and blocked storage only lose the remembered choice.
  }
}

export interface HostLanguageProviderProps {
  readonly children: (language: BPMLanguage) => ReactNode;
}

/**
 * Holds the language the user picked in the host navigation and remembers it
 * in this browser. The stored choice is read after mount, so the server
 * render and the first client render agree on the default.
 */
export function HostLanguageProvider({
  children,
}: HostLanguageProviderProps): ReactElement {
  const [language, setLanguageState] =
    useState<BPMLanguage>(DEFAULT_BPM_LANGUAGE);

  useEffect((): void => {
    const stored = readStoredLanguage();

    if (stored) {
      setLanguageState(stored);
    }
  }, []);

  const setLanguage = useCallback((next: BPMLanguage): void => {
    setLanguageState(next);
    storeLanguage(next);
  }, []);

  const value = useMemo<HostLanguageContextValue>(
    () => ({ language, setLanguage }),
    [language, setLanguage],
  );

  return (
    <HostLanguageContext.Provider value={value}>
      {children(language)}
    </HostLanguageContext.Provider>
  );
}

export function useHostLanguage(): HostLanguageContextValue {
  return useContext(HostLanguageContext);
}
