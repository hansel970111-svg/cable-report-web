import { expect, test } from 'vitest';
import {
  buildCableLabel,
  buildLimit,
  cableNumberFromCableLabel,
  defaultLimitForCableType,
  isYellowCat5eType,
  suggestedPdfName,
  templateAssetFor,
} from './cable-rules';
import type { CableImportRow, ReportDraft } from './model';
import {
  defaultRecordIdFactory,
  mapImportedRows,
} from './record-mapper';
import type { RandomSource } from './random-source';

function importRow(overrides: Partial<CableImportRow> = {}): CableImportRow {
  return {
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
    ...overrides,
  };
}

function sequence(values: readonly number[]): RandomSource & { calls(): number } {
  let index = 0;
  return {
    next() {
      const value = values[index++];
      if (value === undefined) throw new Error('unexpected random call');
      return value;
    },
    calls: () => index,
  };
}

test('preserves Cat5e formulas and random call order', () => {
  const random = sequence([0.5, 0.79, 0.25]);
  const row = importRow();

  expect(mapImportedRows([row], {
    cableType: 'Cat 5e',
    startingDateTime: '10-07-2026 09:00:00 AM',
    random,
    idFactory: () => 'record-42',
  })).toEqual([{
    id: 'record-42',
    cableLabel: '#42',
    cableNumber: '42',
    limit: 'TIA - Cat 5e Channel',
    result: 'PASS',
    length: 100,
    nextMargin: 11.5,
    dateTime: '10-07-2026 09:00:00 AM',
  }]);
  expect(random.calls()).toBe(3);
});

test.each([
  ['Cat5e(Yellow)', true],
  ['CAT5E(YELLOW)', true],
  [' cat 5e ( yellow ) ', true],
  ['黄网', true],
  ['Yellow', false],
  ['黄色', false],
  ['黄', false],
  ['Cat5e(Yellow) console', false],
] as const)('classifies the confirmed yellow Cat5e spelling %s', (value, expected) => {
  expect(isYellowCat5eType(value)).toBe(expected);
});

test('maps yellow Cat5e rows to FAIL console labels without changing red rows', () => {
  const rows = [
    importRow({ cableNumber: '1', cableTypeText: '红' }),
    importRow({
      cableNumber: '123',
      cableTypeText: 'Cat 5e (Yellow)',
      source: {
        sheetName: 'OOB', rowNumber: 3, expansionIndex: 0, rule: 'cat5e-oob',
      },
    }),
    importRow({
      cableNumber: '2',
      cableTypeText: '黄网',
      source: {
        sheetName: 'OOB', rowNumber: 4, expansionIndex: 0, rule: 'cat5e-oob',
      },
    }),
  ];
  const random: RandomSource = { next: () => 0.5 };

  const records = mapImportedRows(rows, {
    cableType: 'Cat 5e',
    startingDateTime: '10-07-2026 09:00:00 AM',
    random,
    idFactory: defaultRecordIdFactory,
  });

  expect(records.map(record => ({
    cableLabel: record.cableLabel,
    cableNumber: record.cableNumber,
    result: record.result,
  }))).toEqual([
    { cableLabel: '#1', cableNumber: '1', result: 'PASS' },
    { cableLabel: '#123(console)', cableNumber: '123', result: 'FAIL' },
    { cableLabel: '#2(console)', cableNumber: '2', result: 'FAIL' },
  ]);
  expect(records[1].cableLabel).toHaveLength(13);
  expect(cableNumberFromCableLabel(records[1].cableLabel, 'Cat 5e')).toBe('123');
});

test('does not apply the yellow OOB result rule to Vertical Cabling', () => {
  const random = sequence([0.5, 0.79, 0.25]);
  const [record] = mapImportedRows([importRow({
    cableNumber: '#123',
    cableTypeText: 'Cat5e(Yellow)',
    source: {
      sheetName: 'Vertical Cabling',
      rowNumber: 2,
      expansionIndex: 0,
      rule: 'vertical-cabling',
    },
  })], {
    cableType: 'Cat 5e (Vertical Cabling)',
    startingDateTime: '10-07-2026 09:00:00 AM',
    random,
    idFactory: defaultRecordIdFactory,
  });

  expect(record).toMatchObject({
    cableLabel: '123', cableNumber: '123', result: 'PASS',
  });
  expect(random.calls()).toBe(3);
});

test('normalizes a pre-suffixed yellow Cat5e source without duplicating console', () => {
  const random = sequence([0.5, 0.79, 0.25]);
  const [record] = mapImportedRows([importRow({
    cableNumber: '#123(console)',
    cableTypeText: '黄网',
  })], {
    cableType: 'Cat 5e',
    startingDateTime: '10-07-2026 09:00:00 AM',
    random,
    idFactory: defaultRecordIdFactory,
  });

  expect(record).toMatchObject({
    cableLabel: '#123(console)', cableNumber: '123', result: 'FAIL',
  });
  expect(random.calls()).toBe(3);
});

test('uses 19 as the missing base length and preserves the low Margin branch', () => {
  const random = sequence([0.5, 0.8, 0.5]);

  const [record] = mapImportedRows([importRow({ length: null })], {
    cableType: 'Cat 5e',
    startingDateTime: '10-07-2026 09:00:00 AM',
    random,
    idFactory: () => 'record-42',
  });

  expect(record.length).toBe(19);
  expect(record.nextMargin).toBe(10);
  expect(random.calls()).toBe(3);
});

test('applies the original random coefficient to an individual ODF LC segment', () => {
  const random = sequence([0.75, 0.79, 0.25]);

  const [record] = mapImportedRows([importRow({
    cableNumber: '#1',
    cableTypeText: 'SM,LC-LC,200G',
    length: 30,
    source: {
      sheetName: 'DSW-PSW',
      rowNumber: 2,
      expansionIndex: 0,
      rule: 'lc',
    },
  })], {
    cableType: 'LC',
    startingDateTime: '10-07-2026 09:00:00 AM',
    random,
    idFactory: defaultRecordIdFactory,
  });

  expect(record.length).toBe(30.4);
  expect(record.cableLabel).toBe('#1');
  expect(record.cableNumber).toBe('1');
  expect(record.limit).toBe('Link Validation');
  expect(random.calls()).toBe(3);
});

test('generates all automatic times before row randomness even when Excel times win', () => {
  const random = sequence([
    0, 0, 0,
    0.5, 0.79, 0.25,
    0.5, 0.8, 0.5,
  ]);
  const rows = [
    importRow({ dateTime: '09-07-2026 03:00:00 PM' }),
    importRow({
      cableNumber: '43',
      dateTime: '09-07-2026 03:01:00 PM',
      source: {
        sheetName: 'OOB',
        rowNumber: 3,
        expansionIndex: 0,
        rule: 'cat5e-oob',
      },
    }),
  ];

  const records = mapImportedRows(rows, {
    cableType: 'Cat 5e',
    startingDateTime: '10-07-2026 11:59:50 AM',
    random,
    idFactory: defaultRecordIdFactory,
  });

  expect(records.map(record => ({
    id: record.id,
    length: record.length,
    nextMargin: record.nextMargin,
    dateTime: record.dateTime,
  }))).toEqual([
    {
      id: 'OOB:2:0',
      length: 100,
      nextMargin: 11.5,
      dateTime: '09-07-2026 03:00:00 PM',
    },
    {
      id: 'OOB:3:0',
      length: 100,
      nextMargin: 10,
      dateTime: '09-07-2026 03:01:00 PM',
    },
  ]);
  expect(random.calls()).toBe(9);
});

test('preserves Vertical, LC, and MPO Label and Limit rules', () => {
  const vertical = importRow({ cableNumber: '#R01-42-1' });
  const lc = importRow({ cableNumber: 'LC-42' });
  const odfFirst = importRow({ cableNumber: '#1' });
  const odfSecond = importRow({ cableNumber: '#2' });
  const mpo = importRow({
    cableNumber: 'MPO #42',
    cableTypeText: 'MPO 蓝',
    bandwidth: '100G',
  });

  expect(buildCableLabel(vertical, 'Cat 5e (Vertical Cabling)')).toBe('R01-42-1');
  expect(buildLimit(vertical, 'Cat 5e (Vertical Cabling)')).toBe('TIA - Cat 5e Channel');
  expect(buildCableLabel(lc, 'LC')).toBe('#LC-42');
  expect(buildCableLabel(odfFirst, 'LC')).toBe('#1');
  expect(buildCableLabel(odfSecond, 'LC')).toBe('#2');
  expect(buildLimit(lc, 'LC')).toBe('Link Validation');
  expect(buildCableLabel(mpo, 'MPO')).toBe('#42');
  expect(buildLimit(mpo, 'MPO')).toBe('100GBASE-SR10');
});

test('provides stable default limits and immutable template mappings', () => {
  expect(defaultLimitForCableType('Cat 5e')).toBe('TIA - Cat 5e Channel');
  expect(defaultLimitForCableType('Cat 5e (Vertical Cabling)')).toBe('TIA - Cat 5e Channel');
  expect(defaultLimitForCableType('LC')).toBe('Link Validation');
  expect(defaultLimitForCableType('MPO')).toBe('200GBASE-SR10');
  expect(templateAssetFor('Cat 5e')).toBe('assets/M138-DE46-OOB-Cat5e.pdf');
  expect(templateAssetFor('Cat 5e (Vertical Cabling)')).toBe('assets/M138-DE46-OOB-Cat5e.pdf');
  expect(templateAssetFor('LC')).toBe('assets/M138-DE46-D-P-cross-LC.pdf');
  expect(templateAssetFor('MPO')).toBe('assets/M138-DE46-P-A-MPO.pdf');
});

test('builds a filesystem-safe timestamped PDF name', () => {
  const draft: ReportDraft = {
    revision: 1,
    cableType: 'Cat 5e',
    site: 'DE 46/West',
    records: [],
  };

  expect(suggestedPdfName(draft, new Date(2026, 6, 10, 9, 5, 7)))
    .toBe('DE_46_West_Cat_5e_20260710_090507.pdf');
});
