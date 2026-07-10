import { expect, test } from 'vitest';
import type { CableImportRow } from '@/domain/report/model';
import { defaultRecordIdFactory, mapImportedRows } from '@/domain/report/record-mapper';
import type { RandomSource } from '@/domain/report/random-source';
import { ensureUiRecordIds, toUiCableRecords } from './reportRecordAdapter';

function mappedRecord() {
  const row: CableImportRow = {
    cableNumber: '42',
    cableTypeText: '红',
    length: 100,
    dateTime: '10-07-2026 09:00:00 AM',
    sourceLabel: null,
    bandwidth: null,
    source: {
      sheetName: 'OOB',
      rowNumber: 2,
      expansionIndex: 0,
      rule: 'cat5e-oob',
    },
  };
  const values = [0.5, 0.79, 0.25];
  let index = 0;
  const random: RandomSource = { next: () => values[index++] };

  return mapImportedRows([row], {
    cableType: 'Cat 5e',
    startingDateTime: '10-07-2026 09:00:00 AM',
    random,
    idFactory: defaultRecordIdFactory,
  })[0];
}

test('adapts a mapped domain record to the existing UI record fields', () => {
  expect(toUiCableRecords([mappedRecord()])[0]).toMatchObject({
    cable_label: '#42',
    cable_number: '42',
    limit: 'TIA - Cat 5e Channel',
    result: 'PASS',
    length: 100,
    next_margin: 11.5,
    date_time: '10-07-2026 09:00:00 AM',
    page: 1,
  });
});

test('preserves the mapped record id as the stable UI list identity', () => {
  const domainRecord = mappedRecord();

  expect(toUiCableRecords([domainRecord])[0]).toMatchObject({
    id: domainRecord.id,
  });
});

test('assigns unique stable identities to legacy template records at ingestion', () => {
  const records = [
    {
      cable_label: '#42', cable_number: '42', limit: 'TIA - Cat 5e Channel',
      result: 'PASS', length: 100, next_margin: 11.5,
      date_time: '10-07-2026 09:00:00 AM', page: 1,
    },
    {
      cable_label: '#43', cable_number: '43', limit: 'TIA - Cat 5e Channel',
      result: 'PASS', length: 101, next_margin: 11.6,
      date_time: '10-07-2026 09:01:00 AM', page: 1,
    },
  ];

  const normalized = ensureUiRecordIds(records, 'template:Cat 5e');

  expect(normalized.map(record => record.id)).toEqual([
    'template:Cat 5e:1:0',
    'template:Cat 5e:1:1',
  ]);
  expect(ensureUiRecordIds(normalized, 'template:Cat 5e').map(record => record.id))
    .toEqual(normalized.map(record => record.id));
});
