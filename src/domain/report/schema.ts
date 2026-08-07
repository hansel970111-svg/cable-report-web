import { z } from 'zod';
import { isValidReportDateTime } from './date-time';
import type { ApiError, CableRecord, CableType, ReportDraft } from './model';
import { isValidSite, normalizeSite } from './site';

// These bounds are the empirically verified safe widths of the fixed PDF
// template fields. Limit is additionally constrained by cable type below.
export const REPORT_FIELD_LIMITS = Object.freeze({
  cableLabel: 13,
  cableNumber: 13,
  site: 18,
  limit: 20,
  length: 99_999.9,
  nextMargin: 99.9,
});

const CABLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9 #_\/&().+:_-]+$/;
const HAS_ALPHANUMERIC_PATTERN = /[A-Za-z0-9]/;
const CABLE_IDENTIFIER_MESSAGE =
  'Cable Label 仅支持英文字母、数字、空格以及 # - _ / & ( ) . + :。';

export const CableLabelSchema = z.string()
  .trim()
  .min(1, 'Cable Label 不能为空。')
  .max(REPORT_FIELD_LIMITS.cableLabel, `Cable Label 不能超过 ${REPORT_FIELD_LIMITS.cableLabel} 个字符。`)
  .regex(CABLE_IDENTIFIER_PATTERN, CABLE_IDENTIFIER_MESSAGE)
  .refine(
    value => HAS_ALPHANUMERIC_PATTERN.test(value),
    'Cable Label 至少要包含一个英文字母或数字。',
  );

export const CableNumberSchema = z.string()
  .trim()
  .min(1, 'Cable Number 不能为空。')
  .max(REPORT_FIELD_LIMITS.cableNumber, `Cable Number 不能超过 ${REPORT_FIELD_LIMITS.cableNumber} 个字符。`)
  .regex(
    CABLE_IDENTIFIER_PATTERN,
    'Cable Number 仅支持英文字母、数字、空格以及 # - _ / & ( ) . + :。',
  )
  .refine(
    value => HAS_ALPHANUMERIC_PATTERN.test(value),
    'Cable Number 至少要包含一个英文字母或数字。',
  );

export const ReportSiteSchema = z.string()
  .transform(normalizeSite)
  .pipe(z.string()
    .min(1, '项目号 (Site) 不能为空。')
    .max(REPORT_FIELD_LIMITS.site, `项目号 (Site) 不能超过 ${REPORT_FIELD_LIMITS.site} 个字符。`)
    .refine(isValidSite, '项目号 (Site) 仅支持英文字母、数字、空格、冒号和连字符。'));

const ReportLimitSchema = z.string()
  .trim()
  .min(1, '测试标准 (Limit) 不能为空。')
  .max(REPORT_FIELD_LIMITS.limit, `测试标准 (Limit) 不能超过 ${REPORT_FIELD_LIMITS.limit} 个字符。`)
  .regex(
    CABLE_IDENTIFIER_PATTERN,
    '测试标准 (Limit) 仅支持英文字母、数字、空格以及 # - _ / & ( ) . + :。',
  )
  .refine(
    value => HAS_ALPHANUMERIC_PATTERN.test(value),
    '测试标准 (Limit) 至少要包含一个英文字母或数字。',
  );

const MPO_LIMIT_PATTERN = /^\d{1,4}GBASE-SR10$/;

export const CableTypeSchema: z.ZodType<CableType> = z.enum([
  'Cat 5e', 'Cat 5e (Vertical Cabling)', 'LC', 'MPO',
]);

export const CableRecordSchema: z.ZodType<CableRecord> = z.object({
  id: z.string().min(1).max(200),
  cableLabel: CableLabelSchema,
  cableNumber: CableNumberSchema,
  limit: ReportLimitSchema,
  result: z.enum(['PASS', 'FAIL']),
  length: z.number().finite()
    .min(0, '线缆长度不能小于 0 m。')
    .max(REPORT_FIELD_LIMITS.length, `线缆长度不能超过 ${REPORT_FIELD_LIMITS.length} m。`),
  nextMargin: z.number().finite()
    .min(-REPORT_FIELD_LIMITS.nextMargin, `测试余量不能小于 -${REPORT_FIELD_LIMITS.nextMargin} dB。`)
    .max(REPORT_FIELD_LIMITS.nextMargin, `测试余量不能超过 ${REPORT_FIELD_LIMITS.nextMargin} dB。`),
  dateTime: z.string().refine(isValidReportDateTime, '测试时间格式无效。'),
});

export const ReportDraftSchema: z.ZodType<ReportDraft> = z.object({
  revision: z.number().int().nonnegative(), cableType: CableTypeSchema,
  site: ReportSiteSchema,
  records: z.array(CableRecordSchema).max(10_000, '报告记录不能超过 10000 条。'),
}).superRefine((draft, context) => {
  draft.records.forEach((record, index) => {
    let message: string | null = null;
    if (draft.cableType === 'Cat 5e'
        || draft.cableType === 'Cat 5e (Vertical Cabling)') {
      if (record.limit !== 'TIA - Cat 5e Channel') {
        message = 'Cat 5e 测试标准必须为 TIA - Cat 5e Channel。';
      }
    } else if (draft.cableType === 'LC') {
      if (record.limit !== 'Link Validation') {
        message = 'LC 测试标准必须为 Link Validation。';
      }
    } else if (!MPO_LIMIT_PATTERN.test(record.limit)) {
      message = 'MPO 测试标准必须为 1–4 位数字加 GBASE-SR10。';
    }

    if (message !== null) {
      context.addIssue({
        code: 'custom',
        path: ['records', index, 'limit'],
        message,
      });
    }
  });
});

function firstIssueMessage(result: z.ZodSafeParseResult<unknown>): string | null {
  if (result.success) return null;
  return result.error.issues[0]?.message ?? '报告数据无效，请检查后重试。';
}

export function cableLabelValidationMessage(value: string): string | null {
  return firstIssueMessage(CableLabelSchema.safeParse(value));
}

export function siteValidationMessage(value: string): string | null {
  return firstIssueMessage(ReportSiteSchema.safeParse(value));
}

export function reportDraftValidationMessage(draft: ReportDraft): string | null {
  const result = ReportDraftSchema.safeParse(draft);
  if (result.success) return null;

  const issue = result.error.issues[0];
  const recordIndex = issue?.path[0] === 'records' && typeof issue.path[1] === 'number'
    ? issue.path[1]
    : null;
  const message = issue?.message ?? '报告数据无效，请检查后重试。';
  return recordIndex === null ? message : `第 ${recordIndex + 1} 条记录：${message}`;
}

export const ApiErrorSchema: z.ZodType<ApiError> = z.object({
  error: z.object({
    code: z.string().min(1), message: z.string().min(1),
    field: z.string().optional(), retryable: z.boolean(),
  }),
});
