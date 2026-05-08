import moment from 'moment';

export function formatDateTime(value: string | null): string {
  return value ? moment(value).format('YYYY-MM-DD HH:mm:ss') : '-';
}
