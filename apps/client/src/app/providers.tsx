'use client';

import { ReactNode } from 'react';
import {
  CalendarConfigProviderMoment,
  CalendarLocale,
} from '@mezzanine-ui/react/moment';
import { AuthProvider } from './auth-provider';

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps): React.ReactElement {
  return (
    <CalendarConfigProviderMoment locale={CalendarLocale.ZH_TW}>
      <AuthProvider>{children}</AuthProvider>
    </CalendarConfigProviderMoment>
  );
}
