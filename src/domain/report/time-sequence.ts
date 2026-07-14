import {
  formatReportDateTime,
  parseReportDateTime,
  type ReportDateTimeParts,
} from './date-time';
import type { RandomSource } from './random-source';

type WorkingTime = {
  day: number;
  month: number;
  year: number;
  hour: number;
  minute: number;
  second: number;
};

function toWorkingTime(parts: ReportDateTimeParts): WorkingTime {
  let hour = parts.hour % 12;
  if (parts.ampm === 'PM') hour += 12;
  return { ...parts, hour };
}

function formatWorkingTime(value: WorkingTime): string {
  const ampm = value.hour >= 12 ? 'PM' : 'AM';
  const hour = value.hour % 12 || 12;
  return formatReportDateTime({ ...value, hour, ampm });
}

function toDate(value: Pick<WorkingTime, 'year' | 'month' | 'day'>): Date {
  return new Date(value.year, value.month - 1, value.day);
}

function nextWorkingDate(value: Pick<WorkingTime, 'year' | 'month' | 'day'>) {
  const date = toDate(value);
  do {
    date.setDate(date.getDate() + 1);
  } while (date.getDay() === 0 || date.getDay() === 6);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function startOfPeriod(
  date: Pick<WorkingTime, 'year' | 'month' | 'day'>,
  hour: number,
  random: RandomSource,
): WorkingTime {
  return {
    ...date,
    hour,
    minute: Math.floor(random.next() * 5) + 1,
    second: Math.floor(random.next() * 60),
  };
}

function moveIntoWorkingHours(value: WorkingTime, random: RandomSource): WorkingTime {
  const timeInMinutes = value.hour * 60 + value.minute;
  if (timeInMinutes < 9 * 60) {
    return startOfPeriod(value, 9, random);
  }
  if (timeInMinutes >= 12 * 60 && timeInMinutes < 13 * 60) {
    return startOfPeriod(value, 13, random);
  }
  if (timeInMinutes >= 18 * 60) {
    return startOfPeriod(nextWorkingDate(value), 9, random);
  }
  return value;
}

function addInterval(value: WorkingTime, seconds: number): WorkingTime {
  const next = { ...value, second: value.second + seconds };
  while (next.second >= 60) {
    next.second -= 60;
    next.minute += 1;
  }
  while (next.minute >= 60) {
    next.minute -= 60;
    next.hour += 1;
  }
  return next;
}

export function generateWorkingTimes(
  startingDateTime: string,
  count: number,
  random: RandomSource,
): string[] {
  if (count <= 0) return [];

  const parsed = parseReportDateTime(startingDateTime);
  if (!parsed) return [];

  let current = moveIntoWorkingHours(toWorkingTime(parsed), random);
  const times = [formatWorkingTime(current)];

  for (let index = 1; index < count; index += 1) {
    const interval = Math.floor(random.next() * 41) + 50;
    current = addInterval(current, interval);

    if (current.hour >= 24) {
      current = startOfPeriod(nextWorkingDate(current), 9, random);
    } else {
      current = moveIntoWorkingHours(current, random);
    }

    times.push(formatWorkingTime(current));
  }

  return times;
}
