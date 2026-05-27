'use client';

import type { ReactElement } from 'react';
import { FormField, type FormFieldProps } from '@mezzanine-ui/react';
import { FormFieldDensity, FormFieldLayout } from '@mezzanine-ui/core/form';

type BPMFormFieldProps = Omit<
  FormFieldProps,
  'density' | 'fullWidth' | 'layout'
> &
  Partial<Pick<FormFieldProps, 'density' | 'fullWidth' | 'layout'>>;

/**
 * Mezzanine `<FormField>` pre-configured with the BPM admin defaults
 * (`TIGHT` density, `HORIZONTAL` layout, full width). Use everywhere a
 * label-aligned field is needed.
 */
export function BPMFormField({
  density = FormFieldDensity.TIGHT,
  fullWidth = true,
  layout = FormFieldLayout.HORIZONTAL,
  ...props
}: BPMFormFieldProps): ReactElement {
  return (
    <FormField
      density={density}
      fullWidth={fullWidth}
      layout={layout}
      {...props}
    />
  );
}
