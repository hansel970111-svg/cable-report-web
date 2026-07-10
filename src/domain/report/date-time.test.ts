import { expect, test } from 'vitest';
import { isValidReportDateTime } from './date-time';

test('accepts minute 00 and validates real calendar dates and 12-hour time', () => {
  expect(isValidReportDateTime('29-02-2024 09:00:00 AM')).toBe(true);
  expect(isValidReportDateTime('31-02-2024 09:00:00 AM')).toBe(false);
  expect(isValidReportDateTime('10-07-2026 13:00:00 PM')).toBe(false);
  expect(isValidReportDateTime('10-07-2026 12:00:00 AM')).toBe(true);
});
