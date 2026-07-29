import { buildCableLabel, buildLimit } from './cable-rules';
import type { CableImportRow, CableRecord, CableType } from './model';
import type { RandomSource } from './random-source';
import { generateWorkingTimes } from './time-sequence';

export type RecordIdFactory = (row: CableImportRow, index: number) => string;

export type MapImportedRowsOptions = {
  cableType: CableType;
  startingDateTime: string;
  random: RandomSource;
  idFactory: RecordIdFactory;
};

export const defaultRecordIdFactory: RecordIdFactory = row =>
  `${row.source.sheetName}:${row.source.rowNumber}:${row.source.expansionIndex}`;

function normalizeCableNumber(cableNumber: string, cableType: CableType): string {
  if (cableType !== 'LC' || !cableNumber.includes('&')) {
    return cableNumber.replace(/^#/, '');
  }

  return cableNumber
    .split(/\s*&\s*/)
    .filter(Boolean)
    .map(segment => segment.replace(/^#/, ''))
    .join(' & ');
}

export function mapImportedRows(
  rows: readonly CableImportRow[],
  options: MapImportedRowsOptions,
): CableRecord[] {
  const generatedTimes = generateWorkingTimes(
    options.startingDateTime,
    rows.length,
    options.random,
  );

  return rows.map((row, index) => {
    const baseLength = row.length ?? 19;
    const length = Number((baseLength * (0.97 + options.random.next() * 0.06)).toFixed(1));
    const highMargin = options.random.next() < 0.8;
    const nextMargin = Number(((highMargin ? 11 : 9) + options.random.next() * 2).toFixed(1));

    return {
      id: options.idFactory(row, index),
      cableLabel: buildCableLabel(row, options.cableType),
      cableNumber: normalizeCableNumber(row.cableNumber, options.cableType),
      limit: buildLimit(row, options.cableType),
      result: 'PASS',
      length,
      nextMargin,
      dateTime: row.dateTime?.trim() || generatedTimes[index],
    };
  });
}
