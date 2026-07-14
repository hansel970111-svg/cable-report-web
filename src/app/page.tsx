'use client';

import { ReportEditor } from '@/features/report-editor/report-editor';
import { browserReportServices } from '@/features/report-workflow/browser-services';

export default function Home() {
  return (
    <main>
      <ReportEditor services={browserReportServices} />
    </main>
  );
}
