export type ReportDateTimeParts = {
  day: number; month: number; year: number;
  hour: number; minute: number; second: number; ampm: 'AM' | 'PM';
};

const PATTERN = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) (AM|PM)$/;

export function parseReportDateTime(input: string): ReportDateTimeParts | null {
  const match = PATTERN.exec(input);
  if (!match) return null;
  const parts: ReportDateTimeParts = {
    day: Number(match[1]), month: Number(match[2]), year: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6]),
    ampm: match[7] as 'AM' | 'PM',
  };
  if (parts.year < 2000 || parts.hour < 1 || parts.hour > 12 ||
      parts.minute < 0 || parts.minute > 59 || parts.second < 0 || parts.second > 59) return null;
  const candidate = new Date(parts.year, parts.month - 1, parts.day);
  if (candidate.getFullYear() !== parts.year || candidate.getMonth() !== parts.month - 1 ||
      candidate.getDate() !== parts.day) return null;
  return parts;
}

export function formatReportDateTime(parts: ReportDateTimeParts): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(parts.day)}-${two(parts.month)}-${parts.year} ${two(parts.hour)}:${two(parts.minute)}:${two(parts.second)} ${parts.ampm}`;
}

export const isValidReportDateTime = (input: string): boolean =>
  parseReportDateTime(input) !== null;
