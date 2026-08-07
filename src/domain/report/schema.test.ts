import { describe, expect, it } from 'vitest';
import type { ReportDraft } from './model';
import {
  cableLabelValidationMessage,
  REPORT_FIELD_LIMITS,
  reportDraftValidationMessage,
  ReportDraftSchema,
  siteValidationMessage,
} from './schema';
import { normalizeSite } from './site';

function validDraft(): ReportDraft {
  return {
    revision: 1,
    cableType: 'LC',
    site: 'YYBX-OE38-00027',
    records: [{
      id: 'record-1',
      cableLabel: '#LC(A)+B_1/2',
      cableNumber: 'LC(A)+B_1/2',
      limit: 'Link Validation',
      result: 'PASS',
      length: 55,
      nextMargin: 12,
      dateTime: '10-07-2026 09:00:00 AM',
    }],
  };
}

describe('report contracts', () => {
  it('accepts operational Site identifiers that use the full uppercase alphabet', () => {
    const result = ReportDraftSchema.safeParse({
      revision: 1,
      cableType: 'Cat 5e',
      site: 'YYBX-OE38-00027',
      records: [],
    });

    expect(result.success).toBe(true);
  });

  it('normalizes Site and rejects characters the template cannot express', () => {
    expect(normalizeSite(' de46-1 ')).toBe('DE46-1');
    const result = ReportDraftSchema.safeParse({
      revision: 1, cableType: 'Cat 5e', site: 'DE46_1', records: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['site']);
  });

  it('trims bounded PDF fields and accepts the documented ASCII label characters', () => {
    const source = validDraft();
    source.site = ' yybx-oe38-00027 ';
    source.records[0].cableLabel = '  #LC(A)+B_1/2  ';
    source.records[0].cableNumber = '  LC(A)+B_1/2  ';
    source.records[0].limit = '  Link Validation  ';
    source.records[0].length = REPORT_FIELD_LIMITS.length;
    source.records[0].nextMargin = -REPORT_FIELD_LIMITS.nextMargin;

    const result = ReportDraftSchema.safeParse(source);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.site).toBe('YYBX-OE38-00027');
    expect(result.data.records[0]).toMatchObject({
      cableLabel: '#LC(A)+B_1/2',
      cableNumber: 'LC(A)+B_1/2',
      limit: 'Link Validation',
    });
  });

  it('accepts values exactly at the verified fixed-field limits', () => {
    const source = validDraft();
    source.site = 'S'.repeat(REPORT_FIELD_LIMITS.site);
    source.records[0].cableLabel = 'L'.repeat(REPORT_FIELD_LIMITS.cableLabel);
    source.records[0].cableNumber = 'N'.repeat(REPORT_FIELD_LIMITS.cableNumber);

    expect(ReportDraftSchema.safeParse(source).success).toBe(true);
  });

  it.each([
    '#ABC-1',
    'A_B/2',
    'A&B',
    'LC(A)+1',
    'A.B:1',
  ])('accepts PDF-safe Cable Label %s', value => {
    expect(cableLabelValidationMessage(value)).toBeNull();
  });

  it.each([
    ['Cat 5e', 'TIA - Cat 5e Channel'],
    ['Cat 5e (Vertical Cabling)', 'TIA - Cat 5e Channel'],
    ['LC', 'Link Validation'],
    ['MPO', '1GBASE-SR10'],
    ['MPO', '100GBASE-SR10'],
    ['MPO', '9999GBASE-SR10'],
  ] as const)('accepts the %s template Limit %s', (cableType, limit) => {
    const source = validDraft();
    source.cableType = cableType;
    source.records[0].limit = limit;

    expect(ReportDraftSchema.safeParse(source).success).toBe(true);
  });

  it.each([
    ['Cat 5e', 'Link Validation'],
    ['Cat 5e (Vertical Cabling)', '100GBASE-SR10'],
    ['LC', 'TIA - Cat 5e Channel'],
    ['MPO', '10000GBASE-SR10'],
    ['MPO', 'GBASE-SR10'],
  ] as const)('rejects an invalid %s template Limit %s', (cableType, limit) => {
    const source = validDraft();
    source.cableType = cableType;
    source.records[0].limit = limit;

    const result = ReportDraftSchema.safeParse(source);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.at(-1)?.path).toEqual(['records', 0, 'limit']);
    }
  });

  it.each([
    ['blank Cable Label', (value: ReportDraft) => { value.records[0].cableLabel = '   '; }, ['records', 0, 'cableLabel']],
    ['long Cable Label', (value: ReportDraft) => { value.records[0].cableLabel = 'A'.repeat(REPORT_FIELD_LIMITS.cableLabel + 1); }, ['records', 0, 'cableLabel']],
    ['unsupported Cable Label characters', (value: ReportDraft) => { value.records[0].cableLabel = '#线缆😀'; }, ['records', 0, 'cableLabel']],
    ['punctuation-only Cable Label', (value: ReportDraft) => { value.records[0].cableLabel = '##'; }, ['records', 0, 'cableLabel']],
    ['blank Cable Number', (value: ReportDraft) => { value.records[0].cableNumber = ' '; }, ['records', 0, 'cableNumber']],
    ['long Cable Number', (value: ReportDraft) => { value.records[0].cableNumber = 'A'.repeat(REPORT_FIELD_LIMITS.cableNumber + 1); }, ['records', 0, 'cableNumber']],
    ['unsupported Cable Number characters', (value: ReportDraft) => { value.records[0].cableNumber = '线缆'; }, ['records', 0, 'cableNumber']],
    ['punctuation-only Cable Number', (value: ReportDraft) => { value.records[0].cableNumber = '#-&'; }, ['records', 0, 'cableNumber']],
    ['empty Site', (value: ReportDraft) => { value.site = ' '; }, ['site']],
    ['long Site', (value: ReportDraft) => { value.site = 'A'.repeat(REPORT_FIELD_LIMITS.site + 1); }, ['site']],
    ['long Limit', (value: ReportDraft) => { value.records[0].limit = 'L'.repeat(REPORT_FIELD_LIMITS.limit + 1); }, ['records', 0, 'limit']],
    ['blank Limit', (value: ReportDraft) => { value.records[0].limit = ' '; }, ['records', 0, 'limit']],
    ['unsupported Limit characters', (value: ReportDraft) => { value.records[0].limit = '链路验证'; }, ['records', 0, 'limit']],
    ['negative length', (value: ReportDraft) => { value.records[0].length = -0.1; }, ['records', 0, 'length']],
    ['excessive length', (value: ReportDraft) => { value.records[0].length = REPORT_FIELD_LIMITS.length + 0.1; }, ['records', 0, 'length']],
    ['low margin', (value: ReportDraft) => { value.records[0].nextMargin = -REPORT_FIELD_LIMITS.nextMargin - 0.1; }, ['records', 0, 'nextMargin']],
    ['high margin', (value: ReportDraft) => { value.records[0].nextMargin = REPORT_FIELD_LIMITS.nextMargin + 0.1; }, ['records', 0, 'nextMargin']],
  ] as const)('rejects %s before PDF generation', (_name, mutate, expectedPath) => {
    const source = validDraft();
    mutate(source);

    const result = ReportDraftSchema.safeParse(source);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(expectedPath);
  });

  it('returns actionable validation messages for UI fields and record positions', () => {
    expect(siteValidationMessage('')).toBe('项目号 (Site) 不能为空。');
    expect(cableLabelValidationMessage('#线缆')).toContain('仅支持英文字母');
    expect(cableLabelValidationMessage('##')).toContain('至少要包含一个英文字母或数字');

    const source = validDraft();
    source.records[0].cableLabel = '';
    expect(reportDraftValidationMessage(source))
      .toBe('第 1 条记录：Cable Label 不能为空。');
  });
});
