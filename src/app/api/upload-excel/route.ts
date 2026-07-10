import { NextRequest, NextResponse } from 'next/server';

import type { ImportRule } from '@/domain/report/model';
import { CableTypeSchema } from '@/domain/report/schema';
import { importExcel, ImportExcelError } from '@/features/import-excel/import-excel';

const LEGACY_DATA_SOURCE: Readonly<Record<ImportRule, string>> = {
  'cat5e-oob': 'OOB',
  'vertical-cabling': 'Vertical Cabling',
  lc: 'LC',
  mpo: 'MPO',
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const parsedCableType = CableTypeSchema.safeParse(formData.get('cableType'));
    if (!parsedCableType.success) {
      return NextResponse.json({ error: 'Unsupported cable type' }, { status: 400 });
    }

    const cableType = parsedCableType.data;
    const result = importExcel({
      fileName: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }, cableType);

    return NextResponse.json({
      success: true,
      filteredRows: result.rows.map(row => ({
        cableNo: row.cableNumber,
        cableType: row.cableTypeText,
        length: row.length,
        dateTime: row.dateTime,
        sourceLabel: row.sourceLabel,
        bandwidth: row.bandwidth,
        rowIndex: row.source.rowNumber,
        sheetName: row.source.sheetName,
        ...(row.source.rule === 'vertical-cabling'
          ? { qtyIndex: row.source.expansionIndex + 1 }
          : {}),
      })),
      totalCount: result.rows.length,
      sheetName: result.metadata.sheetNames.join(', '),
      detectedColumns: result.metadata.detectedColumns,
      dataSource: LEGACY_DATA_SOURCE[result.metadata.rule],
      cableType,
    });
  } catch (error) {
    if (error instanceof ImportExcelError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === 'EXCEL_FILE_TOO_LARGE' ? 413 : 400 },
      );
    }

    console.error('Excel import failed:', error);
    return NextResponse.json(
      { error: 'Excel文件解析失败' },
      { status: 500 },
    );
  }
}
