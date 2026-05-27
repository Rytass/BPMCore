import moment from 'moment';

/**
 * Default BPM datetime formatter: `YYYY-MM-DD HH:mm:ss`. Returns `'-'` for
 * `null` / `undefined` so list cells render a consistent placeholder.
 */
export function formatDateTime(value: string | null | undefined): string {
  return value ? moment(value).format('YYYY-MM-DD HH:mm:ss') : '-';
}
