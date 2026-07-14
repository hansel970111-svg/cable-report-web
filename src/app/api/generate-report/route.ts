import { randomUUID } from 'node:crypto';

import { requireDesktopApi } from '@/server/desktop-auth';
import {
  createGenerateReportHandler,
  pdfJobController,
} from '@/server/pdf';

export const POST = createGenerateReportHandler({
  authenticate: requireDesktopApi,
  controller: pdfJobController,
  createJobId: randomUUID,
});
