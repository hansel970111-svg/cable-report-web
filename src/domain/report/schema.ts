import { z } from 'zod';
import { isValidReportDateTime } from './date-time';
import type { ApiError, CableRecord, CableType, ReportDraft } from './model';
import { isValidSite, normalizeSite } from './site';

export const CableTypeSchema: z.ZodType<CableType> = z.enum([
  'Cat 5e', 'Cat 5e (Vertical Cabling)', 'LC', 'MPO',
]);

export const CableRecordSchema: z.ZodType<CableRecord> = z.object({
  id: z.string().min(1).max(200), cableLabel: z.string().max(200),
  cableNumber: z.string().max(200), limit: z.string().min(1).max(200),
  result: z.enum(['PASS', 'FAIL']), length: z.number().finite().nonnegative(),
  nextMargin: z.number().finite(),
  dateTime: z.string().refine(isValidReportDateTime, 'Invalid Date & Time'),
});

export const ReportDraftSchema: z.ZodType<ReportDraft> = z.object({
  revision: z.number().int().nonnegative(), cableType: CableTypeSchema,
  site: z.string().max(100).transform(normalizeSite).refine(isValidSite, 'Unsupported Site characters'),
  records: z.array(CableRecordSchema).max(10_000),
});

export const ApiErrorSchema: z.ZodType<ApiError> = z.object({
  error: z.object({
    code: z.string().min(1), message: z.string().min(1),
    field: z.string().optional(), retryable: z.boolean(),
  }),
});
