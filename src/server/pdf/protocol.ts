import { z } from 'zod';

const successSchema = z
  .object({
    ok: z.literal(true),
    output: z.string().regex(/^[^/\\]+\.pdf$/i),
    pages: z.number().int().nonnegative(),
    records: z.number().int().nonnegative(),
  })
  .strict();

const failureSchema = z
  .object({
    ok: z.literal(false),
    code: z.string(),
    message: z.string(),
  })
  .strict();

const resultSchema = z.discriminatedUnion('ok', [successSchema, failureSchema]);
const singleJsonLine = /^\{[^\r\n]*\}\n$/;
const PROTOCOL_ERROR_MESSAGE = 'PDF 工作进程输出协议无效';

export type PdfWorkerResult = z.infer<typeof resultSchema>;

export function parsePdfWorkerStdout(stdout: string): PdfWorkerResult {
  if (!singleJsonLine.test(stdout)) {
    throw new Error(PROTOCOL_ERROR_MESSAGE);
  }

  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error(PROTOCOL_ERROR_MESSAGE);
  }

  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(PROTOCOL_ERROR_MESSAGE);
  }

  return parsed.data;
}
