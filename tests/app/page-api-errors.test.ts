import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

test('template and Excel requests preserve stable non-2xx API errors', async () => {
  const source = await readFile('src/app/page.tsx', 'utf8');

  expect(source).toContain('await requireApiSuccess(templateResponse);');
  expect(source).toContain('await requireApiSuccess(excelResponse);');
  expect(source.match(/error instanceof ApiResponseError/g)).toHaveLength(2);
});
