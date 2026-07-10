import type { CableRecord as DomainCableRecord } from '@/domain/report/model';

export type UiCableRecord = {
  id: string;
  cable_label: string;
  cable_number: string;
  limit: string;
  result: string;
  length: number;
  next_margin: number;
  date_time: string;
  page: number;
};

export type UiCableRecordInput = Omit<UiCableRecord, 'id'> & { id?: string };

export function toUiCableRecords(records: readonly DomainCableRecord[]): UiCableRecord[] {
  return records.map(record => ({
    id: record.id,
    cable_label: record.cableLabel,
    cable_number: record.cableNumber,
    limit: record.limit,
    result: record.result,
    length: record.length,
    next_margin: record.nextMargin,
    date_time: record.dateTime,
    page: 1,
  }));
}

export function ensureUiRecordIds(
  records: readonly UiCableRecordInput[],
  namespace: string,
): UiCableRecord[] {
  return records.map((record, index) => {
    const existingId = String(record.id ?? '').trim();
    return {
      ...record,
      id: existingId || `${namespace}:${record.page ?? 1}:${index}`,
    };
  });
}
