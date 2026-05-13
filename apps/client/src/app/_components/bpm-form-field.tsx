'use client';

import { ReactElement } from 'react';
import { FormField, type FormFieldProps } from '@mezzanine-ui/react';
import { FormFieldDensity, FormFieldLayout } from '@mezzanine-ui/core/form';

type BPMFormFieldProps = Omit<
  FormFieldProps,
  'density' | 'fullWidth' | 'layout'
> &
  Partial<Pick<FormFieldProps, 'density' | 'fullWidth' | 'layout'>>;

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
