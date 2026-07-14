import { describe, expect, it } from 'vitest';
import { ReportDraftSchema } from './schema';
import { normalizeSite } from './site';

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
});
