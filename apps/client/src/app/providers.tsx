'use client';

import { ReactNode } from 'react';
import {
  CalendarConfigProviderMoment,
  CalendarLocale,
} from '@mezzanine-ui/react/moment';
import { AuthProvider } from './auth-provider';
import { NotificationUnreadProvider } from './notification-unread-provider';

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps): React.ReactElement {
  return (
    <CalendarConfigProviderMoment locale={CalendarLocale.ZH_TW}>
      <AuthProvider>
        <NotificationUnreadProvider>{children}</NotificationUnreadProvider>
      </AuthProvider>
    </CalendarConfigProviderMoment>
  );
}
