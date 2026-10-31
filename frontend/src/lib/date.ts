import dayjs, { type Dayjs } from 'dayjs';

const FAR_AWAY_DAYS = 6;

/** Scheduled pill: 'Tue 9:15:12 AM', or 'Nov 8, Tue 9:15:12 AM' when more than 6 days away. */
export function formatScheduled(iso: string, now: Dayjs = dayjs()): string {
  const when = dayjs(iso);
  const prefix = when.diff(now, 'day', true) > FAR_AWAY_DAYS ? 'MMM D, ' : '';
  return when.format(`${prefix}ddd h:mm:ss A`);
}

/** Sent rows: 'h:mm A' today, otherwise 'MMM D, h:mm A'. */
export function formatSentTime(iso: string, now: Dayjs = dayjs()): string {
  const when = dayjs(iso);
  return when.isSame(now, 'day') ? when.format('h:mm A') : when.format('MMM D, h:mm A');
}

/** Detail header date, e.g. 'Nov 3, 10:23 AM'. */
export const formatDetailDate = (iso: string): string => dayjs(iso).format('MMM D, h:mm A');

export const formatFullDate = (iso: string): string => dayjs(iso).format('MMM D, YYYY, h:mm:ss A');

/** Value for <input type="datetime-local">. */
export const toLocalInput = (date: Dayjs | Date): string => dayjs(date).format('YYYY-MM-DDTHH:mm');

export interface SendLaterPreset {
  label: string;
  at: Dayjs;
}

/** The four presets of the Send Later popover, relative to tomorrow. */
export function sendLaterPresets(now: Dayjs = dayjs()): SendLaterPreset[] {
  const tomorrow = now.add(1, 'day').startOf('day');
  return [
    { label: 'Tomorrow', at: tomorrow.hour(9) },
    { label: 'Tomorrow, 10:00 AM', at: tomorrow.hour(10) },
    { label: 'Tomorrow, 11:00 AM', at: tomorrow.hour(11) },
    { label: 'Tomorrow, 3:00 PM', at: tomorrow.hour(15) },
  ];
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
