import { describe, expect, test } from 'vitest';

import { parsePdfWorkerStdout } from '@/server/pdf/protocol';

describe('parsePdfWorkerStdout', () => {
  test('accepts an exact newline-terminated success object', () => {
    expect(
      parsePdfWorkerStdout(
        '{"ok":true,"output":"report.PDF","pages":6,"records":120}\n',
      ),
    ).toEqual({
      ok: true,
      output: 'report.PDF',
      pages: 6,
      records: 120,
    });
  });

  test('accepts an exact newline-terminated failure object', () => {
    expect(
      parsePdfWorkerStdout(
        '{"ok":false,"code":"PDF_RENDER_FAILED","message":"报告生成失败"}\n',
      ),
    ).toEqual({
      ok: false,
      code: 'PDF_RENDER_FAILED',
      message: '报告生成失败',
    });
  });

  test('accepts zero counts and a Unicode PDF basename', () => {
    expect(
      parsePdfWorkerStdout(
        '{"ok":true,"output":"线缆报告.PDF","pages":0,"records":0}\n',
      ),
    ).toEqual({
      ok: true,
      output: '线缆报告.PDF',
      pages: 0,
      records: 0,
    });
  });

  test.each([
    '{"ok":true,"output":"report.pdf","pages":1,"records":1}',
    '{"ok":true,"output":"report.pdf","pages":1,"records":1}\r\n',
    ' {"ok":true,"output":"report.pdf","pages":1,"records":1}\n',
    'debug: starting\n{"ok":true,"output":"report.pdf","pages":1,"records":1}\n',
    '{"ok":true,"output":"report.pdf","pages":1,"records":1}\nextra\n',
    '{"ok":false,"code":"ONE","message":"first"}\n{"ok":false,"code":"TWO","message":"second"}\n',
  ])('rejects stdout that is not exactly one JSON line: %j', stdout => {
    expect(() => parsePdfWorkerStdout(stdout)).toThrow(
      'PDF 工作进程输出协议无效',
    );
  });

  test('does not echo rejected worker output in its error', () => {
    const secret = 'SECRET-WORKER-OUTPUT';
    let caught: unknown;

    try {
      parsePdfWorkerStdout(`${secret}\n`);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain(secret);
  });

  test.each([
    '{not-json}\n',
    '[]\n',
    'null\n',
    '{"ok":true,"output":"report.pdf","pages":1,"records":1,"extra":true}\n',
    '{"ok":false,"code":"PDF_RENDER_FAILED","message":"failed","extra":true}\n',
    '{"ok":true,"output":"report.pdf","pages":-1,"records":1}\n',
    '{"ok":true,"output":"report.pdf","pages":1.5,"records":1}\n',
    '{"ok":true,"output":"report.pdf","pages":1,"records":-1}\n',
    '{"ok":true,"output":"report.pdf","pages":1,"records":2.5}\n',
  ])('rejects a JSON value outside the strict result schema: %j', stdout => {
    expect(() => parsePdfWorkerStdout(stdout)).toThrow(
      'PDF 工作进程输出协议无效',
    );
  });

  test.each([
    '../report.pdf',
    'folder/report.pdf',
    '/tmp/report.pdf',
    'C:\\temp\\report.pdf',
    'report.txt',
  ])('rejects an unsafe output name: %s', output => {
    const stdout = `${JSON.stringify({
      ok: true,
      output,
      pages: 1,
      records: 1,
    })}\n`;

    expect(() => parsePdfWorkerStdout(stdout)).toThrow(
      'PDF 工作进程输出协议无效',
    );
  });
});
