import { expect, test } from 'vitest';
import type { RandomSource } from './random-source';
import { generateWorkingTimes } from './time-sequence';

function sequence(values: readonly number[]): RandomSource {
  let index = 0;
  return {
    next() {
      const value = values[index++];
      if (value === undefined) throw new Error('unexpected random call');
      return value;
    },
  };
}

test('jumps from the morning period across lunch', () => {
  expect(generateWorkingTimes(
    '10-07-2026 11:59:50 AM',
    2,
    sequence([0, 0, 0]),
  )).toEqual([
    '10-07-2026 11:59:50 AM',
    '10-07-2026 01:01:00 PM',
  ]);
});

test('jumps after 18:00 from Friday to Monday', () => {
  expect(generateWorkingTimes(
    '10-07-2026 05:59:50 PM',
    2,
    sequence([0, 0, 0]),
  )).toEqual([
    '10-07-2026 05:59:50 PM',
    '13-07-2026 09:01:00 AM',
  ]);
});

test('uses inclusive 50-second and 90-second interval bounds', () => {
  expect(generateWorkingTimes(
    '10-07-2026 09:00:00 AM',
    2,
    sequence([0]),
  )).toEqual([
    '10-07-2026 09:00:00 AM',
    '10-07-2026 09:00:50 AM',
  ]);

  expect(generateWorkingTimes(
    '10-07-2026 09:00:00 AM',
    2,
    sequence([1 - Number.EPSILON]),
  )).toEqual([
    '10-07-2026 09:00:00 AM',
    '10-07-2026 09:01:30 AM',
  ]);
});

test('corrects a pre-09:00 starting time with injected randomness', () => {
  expect(generateWorkingTimes(
    '10-07-2026 08:45:20 AM',
    1,
    sequence([0, 0.5]),
  )).toEqual(['10-07-2026 09:01:30 AM']);
});

test('rejects invalid real dates and returns no entries for count zero', () => {
  expect(generateWorkingTimes(
    '31-02-2026 09:00:00 AM',
    1,
    sequence([]),
  )).toEqual([]);
  expect(generateWorkingTimes(
    '10-07-2026 09:00:00 AM',
    0,
    sequence([]),
  )).toEqual([]);
});
