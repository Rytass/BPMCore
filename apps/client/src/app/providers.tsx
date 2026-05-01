'use client';

import { ReactNode } from 'react';
import {
  CalendarConfigProviderMoment,
  CalendarLocale,
} from '@mezzanine-ui/react/moment';

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps): React.ReactElement {
  return (
    <CalendarConfigProviderMoment locale={CalendarLocale.ZH_TW}>
      {children}
    </CalendarConfigProviderMoment>
  );
}
