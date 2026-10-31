import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import { formatDetailDate, formatScheduled, formatSentTime, formatSize, sendLaterPresets, toLocalInput } from './date';

// 2026-11-03 is a Tuesday. Local time is used throughout, like the UI.
const now = dayjs('2026-11-03T10:30:00');

describe('formatScheduled', () => {
  it('uses weekday and seconds within 6 days', () => {
    expect(formatScheduled(dayjs('2026-11-03T09:15:12').format(), now)).toBe('Tue 9:15:12 AM');
    expect(formatScheduled(dayjs('2026-11-05T20:15:12').format(), now)).toBe('Thu 8:15:12 PM');
    expect(formatScheduled(dayjs('2026-11-09T10:30:00').format(), now)).toBe('Mon 10:30:00 AM'); // exactly 6 days
  });

  it('prefixes the date when more than 6 days away', () => {
    expect(formatScheduled(dayjs('2026-11-10T09:00:00').format(), now)).toBe('Nov 10, Tue 9:00:00 AM');
  });
});

describe('formatSentTime', () => {
  it('shows only the time for today', () => {
    expect(formatSentTime(dayjs('2026-11-03T08:05:00').format(), now)).toBe('8:05 AM');
  });

  it('adds the date for other days', () => {
    expect(formatSentTime(dayjs('2026-11-02T18:45:00').format(), now)).toBe('Nov 2, 6:45 PM');
  });
});

describe('other formats', () => {
  it('formats the detail date', () => {
    expect(formatDetailDate(dayjs('2026-11-03T10:23:00').format())).toBe('Nov 3, 10:23 AM');
  });

  it('formats datetime-local values', () => {
    expect(toLocalInput(dayjs('2026-11-03T09:05:59'))).toBe('2026-11-03T09:05');
  });

  it('formats file sizes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(843 * 1024)).toBe('843 KB');
    expect(formatSize(1.2 * 1024 * 1024)).toBe('1.2 MB');
  });
});

describe('sendLaterPresets', () => {
  it('offers tomorrow at 9, 10, 11 and 15 o\'clock', () => {
    const presets = sendLaterPresets(now);
    expect(presets.map((p) => p.label)).toEqual(['Tomorrow', 'Tomorrow, 10:00 AM', 'Tomorrow, 11:00 AM', 'Tomorrow, 3:00 PM']);
    expect(presets.map((p) => p.at.format('YYYY-MM-DD HH:mm'))).toEqual([
      '2026-11-04 09:00',
      '2026-11-04 10:00',
      '2026-11-04 11:00',
      '2026-11-04 15:00',
    ]);
  });
});
