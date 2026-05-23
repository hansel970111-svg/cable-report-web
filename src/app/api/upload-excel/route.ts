import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

type ExcelRow = unknown[];

type ParsedCableRow = {
  cableNo: string;
  length: number;
  cableType: string;
  rowIndex: number;
  sheetName: string;
  dateTime: string | null;
  sourceLabel?: string;
  bandwidth?: string;
  qtyIndex?: number;
  originalQty?: number;
};

type DetectedColumns = {
  cableType: string;
  cableNo: string;
  length: string | null;
  dateTime: string | null;
};

type LengthMode = 'firstNumeric' | 'sumFirstTwoPlus50';

type SheetColumnProfile = {
  headerRowCount: number;
  cableTypeCol: number;
  cableNoCol: number;
  lengthCols: number[];
  lengthMode: LengthMode;
  dateTimeCol: number;
  sourceLabelCols: number[];
  detectedColumns: DetectedColumns;
};

/**
 * 将 Date 对象转换为 "DD-MM-YYYY HH:MM:SS AM/PM" 格式
 */
function formatDateTime(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const hourStr = String(hours).padStart(2, '0');

  return `${day}-${month}-${year} ${hourStr}:${minutes}:${seconds} ${ampm}`;
}

function normalizeCell(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeLower(value: unknown): string {
  return normalizeCell(value).toLowerCase();
}

function readSheetRows(worksheet: XLSX.WorkSheet): ExcelRow[] {
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: ''
  }) as ExcelRow[];
}

function findColumn(headers: ExcelRow, matcher: (headerLower: string, header: string) => boolean): number {
  for (let i = 0; i < headers.length; i++) {
    const header = normalizeCell(headers[i]);
    if (!header) continue;
    if (matcher(header.toLowerCase(), header)) return i;
  }

  return -1;
}

function findColumns(headers: ExcelRow, matcher: (headerLower: string, header: string) => boolean): number[] {
  const columns: number[] = [];

  headers.forEach((rawHeader, index) => {
    const header = normalizeCell(rawHeader);
    if (!header) return;
    if (matcher(header.toLowerCase(), header)) columns.push(index);
  });

  return columns;
}

function findCableTypeColumn(headers: ExcelRow): number {
  const primaryCol = findColumn(headers, headerLower =>
    headerLower.includes('线缆类型') ||
    headerLower.includes('cable type') ||
    headerLower === 'type' ||
    headerLower === '类型'
  );

  if (primaryCol >= 0) return primaryCol;

  return findColumn(headers, headerLower =>
    headerLower.includes('接口类型') ||
    headerLower.includes('interface type')
  );
}

function findCableNoColumn(headers: ExcelRow): number {
  return findColumn(headers, headerLower =>
    headerLower.includes('线号') ||
    headerLower.includes('cable no') ||
    headerLower.includes('cable label') ||
    headerLower === 'no' ||
    headerLower === 'number'
  );
}

function findLengthColumns(headers: ExcelRow): number[] {
  return findColumns(headers, headerLower =>
    headerLower.includes('线长') ||
    headerLower.includes('长度') ||
    headerLower.includes('length')
  );
}

function findDateTimeColumn(headers: ExcelRow): number {
  return findColumn(headers, headerLower =>
    headerLower.includes('date & time') ||
    headerLower.includes('datetime') ||
    headerLower === 'date' ||
    headerLower === 'time' ||
    headerLower.includes('日期') ||
    headerLower.includes('时间') ||
    headerLower === '测试时间'
  );
}

function findSourceLabelColumns(headers: ExcelRow): number[] {
  return findColumns(headers, headerLower =>
    headerLower.includes('临时标签') ||
    headerLower.includes('source label')
  );
}

function readNumber(row: ExcelRow, col: number): number | null {
  const raw = normalizeCell(row[col]);
  if (!raw) return null;

  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function readLength(row: ExcelRow, lengthCols: number[], mode: LengthMode = 'firstNumeric'): number {
  if (mode === 'sumFirstTwoPlus50') {
    const values = lengthCols.slice(0, 2).map(col => readNumber(row, col));
    const numericValues = values.filter((value): value is number => value !== null);

    if (numericValues.length > 0) {
      return numericValues.reduce((sum, value) => sum + value, 0) + 50;
    }
  }

  for (const col of lengthCols) {
    const value = readNumber(row, col);
    if (value !== null) return value;
  }

  return 0;
}

function combineColumnNames(headers: ExcelRow, columns: number[]): string | null {
  const names = columns.map(col => normalizeCell(headers[col])).filter(Boolean);
  return names.length > 0 ? names.join(', ') : null;
}

function hasCableDataHeaders(headers: ExcelRow): boolean {
  return (
    findCableNoColumn(headers) >= 0 ||
    findLengthColumns(headers).length > 0 ||
    findDateTimeColumn(headers) >= 0 ||
    findSourceLabelColumns(headers).length > 0
  );
}

function inferCableTypeColumn(
  jsonData: ExcelRow[],
  headers: ExcelRow,
  startRow: number,
  typeMatcher: (value: unknown) => boolean
): number {
  const width = Math.max(...jsonData.slice(0, Math.min(jsonData.length, 20)).map(row => row.length), 0);
  let bestColumn = -1;
  let bestMatches = 0;

  for (let col = 0; col < width; col++) {
    if (normalizeCell(headers[col])) continue;

    let matches = 0;
    for (let rowIndex = startRow; rowIndex < Math.min(jsonData.length, startRow + 80); rowIndex++) {
      if (typeMatcher(jsonData[rowIndex]?.[col])) matches++;
    }

    if (matches > bestMatches) {
      bestColumn = col;
      bestMatches = matches;
    }
  }

  return bestMatches > 0 ? bestColumn : -1;
}

function inferCableNoColumnAfterType(jsonData: ExcelRow[], headers: ExcelRow, cableTypeCol: number, startRow: number): number {
  const candidateCol = cableTypeCol + 1;
  if (normalizeCell(headers[candidateCol])) return -1;

  let numericValues = 0;
  for (let rowIndex = startRow; rowIndex < Math.min(jsonData.length, startRow + 80); rowIndex++) {
    if (readNumber(jsonData[rowIndex] || [], candidateCol) !== null) numericValues++;
  }

  return numericValues > 0 ? candidateCol : -1;
}

function detectSheetColumns(
  jsonData: ExcelRow[],
  sheetName: string,
  typeMatcher: (value: unknown) => boolean
): SheetColumnProfile | null {
  const firstHeaders = jsonData[0] || [];
  const secondHeaders = jsonData[1] || [];

  const firstCableTypeCol = findCableTypeColumn(firstHeaders);
  const secondCableTypeCol = findCableTypeColumn(secondHeaders);
  const secondCableNoCol = findCableNoColumn(secondHeaders);
  const secondLengthCols = findLengthColumns(secondHeaders);
  const hasSecondHeaderColumns = secondCableNoCol >= 0 || secondLengthCols.length > 0;

  const useTwoRowHeader = firstCableTypeCol >= 0 && hasSecondHeaderColumns;
  const headerRowCount = useTwoRowHeader ? 2 : 1;
  const primaryHeaders = useTwoRowHeader ? secondHeaders : firstHeaders;
  const fallbackHeaders = useTwoRowHeader ? firstHeaders : secondHeaders;
  const hasDataHeaders = hasCableDataHeaders(primaryHeaders) || hasCableDataHeaders(fallbackHeaders);

  if (!hasDataHeaders) return null;

  let cableTypeCol = useTwoRowHeader
    ? firstCableTypeCol
    : firstCableTypeCol >= 0 ? firstCableTypeCol : secondCableTypeCol;
  let inferredCableTypeCol = false;

  if (cableTypeCol === -1) {
    cableTypeCol = inferCableTypeColumn(jsonData, primaryHeaders, headerRowCount, typeMatcher);
    inferredCableTypeCol = cableTypeCol >= 0;
  }

  if (cableTypeCol === -1) return null;

  const explicitCableNoCol = useTwoRowHeader
    ? secondCableNoCol
    : findCableNoColumn(primaryHeaders);
  const inferredCableNoCol = inferredCableTypeCol
    ? inferCableNoColumnAfterType(jsonData, primaryHeaders, cableTypeCol, headerRowCount)
    : -1;
  const cableNoCol = explicitCableNoCol >= 0
    ? explicitCableNoCol
    : inferredCableNoCol >= 0
    ? inferredCableNoCol
    : -1;
  const lengthCols = useTwoRowHeader
    ? secondLengthCols
    : findLengthColumns(primaryHeaders);
  const dateTimeCol = findDateTimeColumn(primaryHeaders) >= 0
    ? findDateTimeColumn(primaryHeaders)
    : findDateTimeColumn(fallbackHeaders);
  const sourceLabelCols = [
    ...findSourceLabelColumns(primaryHeaders),
    ...findSourceLabelColumns(fallbackHeaders)
  ];

  const isCrossSheet = sheetName.toLowerCase().includes('cross');
  const lengthMode: LengthMode = (isCrossSheet || useTwoRowHeader) && lengthCols.length >= 2
    ? 'sumFirstTwoPlus50'
    : 'firstNumeric';
  const lengthName = combineColumnNames(primaryHeaders, lengthCols);

  return {
    headerRowCount,
    cableTypeCol,
    cableNoCol,
    lengthCols,
    lengthMode,
    dateTimeCol,
    sourceLabelCols,
    detectedColumns: {
      cableType: normalizeCell(firstHeaders[cableTypeCol]) || normalizeCell(secondHeaders[cableTypeCol]) || `推断列 ${XLSX.utils.encode_col(cableTypeCol)}`,
      cableNo: cableNoCol >= 0 ? normalizeCell(primaryHeaders[cableNoCol]) || `推断列 ${XLSX.utils.encode_col(cableNoCol)}` : '自动序号',
      length: lengthName ? (lengthMode === 'sumFirstTwoPlus50' ? `${lengthName} + 50m` : lengthName) : null,
      dateTime: dateTimeCol >= 0
        ? normalizeCell(primaryHeaders[dateTimeCol]) || normalizeCell(fallbackHeaders[dateTimeCol])
        : null
    }
  };
}

function readDateTime(row: ExcelRow, dateTimeCol: number): string | null {
  if (dateTimeCol < 0) return null;

  const rawDateTime = row[dateTimeCol];
  if (!rawDateTime) return null;

  if (rawDateTime instanceof Date) {
    return formatDateTime(rawDateTime);
  }

  if (typeof rawDateTime === 'number') {
    const parsed = XLSX.SSF.parse_date_code(rawDateTime);
    if (parsed) {
      return formatDateTime(new Date(
        parsed.y,
        parsed.m - 1,
        parsed.d,
        parsed.H,
        parsed.M,
        Math.floor(parsed.S)
      ));
    }
  }

  return normalizeCell(rawDateTime) || null;
}

function readFirstSourceLabel(row: ExcelRow, labelCols: number[]): string {
  for (const col of labelCols) {
    const value = normalizeCell(row[col]);
    if (value) return value;
  }

  return '';
}

function normalizeVerticalRu(value: unknown): string {
  const text = normalizeCell(value);
  if (!text) return '';

  const match = text.match(/\d{1,2}/);
  return match ? match[0] : text;
}

function verticalRackRoomContainsRu(rackRoom: string, ru: string): boolean {
  if (!rackRoom || !ru) return false;

  const escapedRu = ru.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`[-_]${escapedRu}(?:$|[._\\s-])`).test(rackRoom);
}

function buildVerticalCableBase(row: ExcelRow, rackRoomCol: number, ruCol: number): string {
  const rackRoom = normalizeCell(row[rackRoomCol]);
  if (!rackRoom) return '';

  const ru = normalizeVerticalRu(row[ruCol]);
  if (ru && !verticalRackRoomContainsRu(rackRoom, ru)) {
    return `${rackRoom}-${ru}`;
  }

  return rackRoom;
}

function matchesRedCableType(value: unknown): boolean {
  const text = normalizeCell(value);
  const lower = text.toLowerCase();
  return text.includes('红') || lower.includes('red');
}

function isNetworkColorCableType(value: unknown): boolean {
  const text = normalizeCell(value);
  const lower = text.toLowerCase();
  return (
    text.includes('红网') ||
    text.includes('黄网') ||
    text.includes('蓝网') ||
    text.includes('网线') ||
    lower.includes('red') ||
    lower.includes('yellow') ||
    lower.includes('blue') ||
    lower.includes('cat5e') ||
    lower.includes('cat 5e') ||
    lower.includes('cat6')
  );
}

function matchesLcCableType(value: unknown): boolean {
  const lower = normalizeLower(value);
  if (!lower || lower.includes('mpo') || isNetworkColorCableType(value)) return false;
  return /(^|[^a-z0-9])lc([^a-z0-9]|$)/i.test(lower);
}

function matchesMpoCableType(value: unknown): boolean {
  const lower = normalizeLower(value);
  const isMixedType =
    lower.includes('cat5e') ||
    lower.includes('cat 5e') ||
    lower.includes('cat6') ||
    lower.includes('网线') ||
    lower.includes('跳线') ||
    lower.includes('lc') ||
    lower.includes('sc');

  return lower.includes('mpo') && !isMixedType;
}

function extractBandwidth(cableType: string): string {
  const lower = cableType.toLowerCase();
  const match = cableType.match(/(\d+\s*G)/i);
  if (match) return match[1].replace(/\s+/g, '').toUpperCase();
  if (cableType.includes('蓝') || lower.includes('blue')) return '100G';
  return '';
}

function collectMatchingRows(
  workbook: XLSX.WorkBook,
  options: {
    cableType: string;
    dataSource: string;
    sheetFilter: (sheetName: string) => boolean;
    typeMatcher: (value: unknown) => boolean;
    emptyMessage: string;
    generatedCableNo?: (sequence: number) => string;
    replaceConstantExplicitCableNo?: boolean;
    includeBandwidth?: boolean;
    requirePositiveLength?: boolean;
  }
) {
  const filteredRows: ParsedCableRow[] = [];
  const explicitCableNos: string[] = [];
  const sheetStats: Record<string, number> = {};
  let detectedColumns: DetectedColumns | null = null;
  let replacedConstantCableNo = false;

  for (const sheetName of workbook.SheetNames) {
    if (!options.sheetFilter(sheetName)) continue;

    const worksheet = workbook.Sheets[sheetName];
    const jsonData = readSheetRows(worksheet);
    if (jsonData.length === 0) continue;

    const columns = detectSheetColumns(jsonData, sheetName, options.typeMatcher);
    if (!columns) continue;

    for (let i = columns.headerRowCount; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowCableType = normalizeCell(row[columns.cableTypeCol]);
      if (!rowCableType || !options.typeMatcher(rowCableType)) continue;

      const hasCableNoColumn = columns.cableNoCol >= 0;
      const explicitCableNo = hasCableNoColumn ? normalizeCell(row[columns.cableNoCol]) : '';
      if (hasCableNoColumn && !explicitCableNo) continue;

      const generatedCableNo = hasCableNoColumn ? '' : options.generatedCableNo?.(filteredRows.length + 1) || '';
      const cableNo = explicitCableNo || generatedCableNo;

      if (!cableNo) continue;

      if (!detectedColumns) {
        detectedColumns = columns.detectedColumns;
      }

      const length = readLength(row, columns.lengthCols, columns.lengthMode);
      if (options.requirePositiveLength && (!columns.lengthCols.length || length <= 0)) {
        continue;
      }

      const parsedRow: ParsedCableRow = {
        cableNo,
        length,
        cableType: rowCableType,
        rowIndex: i + 1,
        sheetName,
        dateTime: readDateTime(row, columns.dateTimeCol)
      };

      const sourceLabel = readFirstSourceLabel(row, columns.sourceLabelCols);
      if (sourceLabel) parsedRow.sourceLabel = sourceLabel;

      if (options.includeBandwidth) {
        parsedRow.bandwidth = extractBandwidth(rowCableType);
      }

      explicitCableNos.push(explicitCableNo);
      filteredRows.push(parsedRow);
      sheetStats[sheetName] = (sheetStats[sheetName] || 0) + 1;
    }
  }

  if (filteredRows.length === 0) {
    return NextResponse.json({ error: options.emptyMessage }, { status: 400 });
  }

  if (options.replaceConstantExplicitCableNo && options.generatedCableNo) {
    const rowIndexesBySheet = new Map<string, number[]>();
    filteredRows.forEach((row, index) => {
      const indexes = rowIndexesBySheet.get(row.sheetName) || [];
      indexes.push(index);
      rowIndexesBySheet.set(row.sheetName, indexes);
    });

    rowIndexesBySheet.forEach(indexes => {
      const values = indexes.map(index => explicitCableNos[index]).filter(Boolean);
      const uniqueValues = new Set(values);

      if (indexes.length > 1 && values.length === indexes.length && uniqueValues.size === 1) {
        indexes.forEach(index => {
          filteredRows[index].cableNo = options.generatedCableNo!(index + 1);
        });
        replacedConstantCableNo = true;
      }
    });
  }

  if (replacedConstantCableNo && detectedColumns) {
    detectedColumns = {
      ...detectedColumns,
      cableNo: `${detectedColumns.cableNo} / 自动序号`
    };
  }

  const responseData = {
    success: true,
    sheetName: Object.keys(sheetStats).join(', '),
    detectedColumns: detectedColumns || {
      cableType: '未知',
      cableNo: options.generatedCableNo ? '自动序号' : '未知',
      length: null,
      dateTime: null
    },
    filteredRows,
    totalCount: filteredRows.length,
    batchCount: Math.ceil(filteredRows.length / 500),
    sheetStats,
    cableType: options.cableType,
    dataSource: options.dataSource
  };

  console.log(`${options.dataSource}: Found ${filteredRows.length} rows`, {
    sheetStats,
    first: filteredRows[0]?.cableNo,
    last: filteredRows[filteredRows.length - 1]?.cableNo
  });

  return NextResponse.json(responseData);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const cableType = formData.get('cableType') as string || 'Cat 5e';

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    if (cableType === 'MPO') {
      return handleMPO(workbook, cableType);
    }

    if (cableType === 'LC') {
      return handleLC(workbook, cableType);
    }

    if (cableType.includes('Vertical Cabling')) {
      return handleVerticalCabling(workbook, cableType);
    }

    return handleOOB(workbook, cableType);
  } catch (error) {
    console.error('Excel parse error:', error);
    return NextResponse.json(
      { error: 'Excel文件解析失败: ' + (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * Cat 5e: 只导入 OOB 工作表中线缆类型包含“红”或“red/RED”的线号。
 */
function handleOOB(workbook: XLSX.WorkBook, cableType: string) {
  return collectMatchingRows(workbook, {
    cableType,
    dataSource: 'OOB',
    sheetFilter: sheetName => {
      const lower = sheetName.toLowerCase();
      return lower.includes('oob') && !lower.includes('crosse') && !lower.includes('cross');
    },
    typeMatcher: matchesRedCableType,
    generatedCableNo: sequence => String(sequence),
    replaceConstantExplicitCableNo: true,
    emptyMessage: '未找到Cat 5e红网数据：Cat 5e会匹配“线缆类型/接口类型”中包含“红”或“red/RED”的行'
  });
}

/**
 * LC: 导入线缆类型中 LC 作为独立标记的数据，例如 SM,LC-LC；排除黄网/红网/Cat 等网线类型。
 */
function handleLC(workbook: XLSX.WorkBook, cableType: string) {
  return collectMatchingRows(workbook, {
    cableType,
    dataSource: 'LC',
    sheetFilter: sheetName => !sheetName.toLowerCase().includes('vertical cabling'),
    typeMatcher: matchesLcCableType,
    generatedCableNo: sequence => String(sequence),
    replaceConstantExplicitCableNo: true,
    requirePositiveLength: true,
    emptyMessage: '未找到LC数据：LC会匹配“线缆类型/接口类型/Cable Type”列中 LC 作为独立标记的光纤行，例如“SM,LC-LC”，并排除黄网/红网等网线行'
  });
}

/**
 * Cat 5e (Vertical Cabling): 使用 Vertical Cabling 工作表，匹配“红”或“red/RED”，按 QTY 展开。
 */
function handleVerticalCabling(workbook: XLSX.WorkBook, cableType: string) {
  let sheetName = '';
  for (const name of workbook.SheetNames) {
    if (name.toLowerCase().includes('vertical cabling')) {
      sheetName = name;
      break;
    }
  }

  if (!sheetName) {
    return NextResponse.json({
      error: '未找到Vertical Cabling工作表，请确保Excel中包含名为"Vertical Cabling"的工作表'
    }, { status: 400 });
  }

  const worksheet = workbook.Sheets[sheetName];
  const jsonData = readSheetRows(worksheet);

  if (jsonData.length === 0) {
    return NextResponse.json({ error: 'Vertical Cabling工作表为空' }, { status: 400 });
  }

  const headers = jsonData[0];
  const cableTypeCol = findCableTypeColumn(headers);
  const qtyCol = findColumn(headers, headerLower =>
    headerLower === 'qty' ||
    headerLower === 'quantity' ||
    headerLower.includes('数量')
  );
  const lengthCols = findLengthColumns(headers);
  const dateTimeCol = findDateTimeColumn(headers);
  const bColIndex = 1;
  const ruColIndex = 2;

  if (cableTypeCol === -1) {
    return NextResponse.json({ error: '未找到"线缆类型/接口类型/Cable Type"列' }, { status: 400 });
  }

  const filteredRows: ParsedCableRow[] = [];

  for (let i = 1; i < jsonData.length; i++) {
    const row = jsonData[i];
    const rowCableType = normalizeCell(row[cableTypeCol]);

    if (!matchesRedCableType(rowCableType)) continue;

    const cableBase = buildVerticalCableBase(row, bColIndex, ruColIndex);
    if (!cableBase) continue;

    const qty = Math.max(Number.parseInt(normalizeCell(row[qtyCol]), 10) || 1, 1);

    for (let j = 1; j <= qty; j++) {
      filteredRows.push({
        cableNo: `${cableBase}-${j}`,
        length: readLength(row, lengthCols),
        cableType: rowCableType,
        rowIndex: i + 1,
        sheetName,
        dateTime: readDateTime(row, dateTimeCol),
        qtyIndex: j,
        originalQty: qty
      });
    }
  }

  if (filteredRows.length === 0) {
    return NextResponse.json({
      error: '未找到Vertical Cat 5e红网数据：该类型会匹配“线缆类型/接口类型/Cable Type”中包含“红”或“red/RED”的行'
    }, { status: 400 });
  }

  console.log(`Vertical Cabling: Found ${filteredRows.length} records (after QTY expansion)`);

  return NextResponse.json({
    success: true,
    sheetName,
    detectedColumns: {
      cableType: normalizeCell(headers[cableTypeCol]),
      cableNo: normalizeCell(headers[bColIndex]) || 'B列',
      ru: normalizeCell(headers[ruColIndex]) || 'C列',
      qty: qtyCol >= 0 ? normalizeCell(headers[qtyCol]) : null,
      length: lengthCols.length > 0 ? lengthCols.map(col => normalizeCell(headers[col])).join(', ') : null,
      dateTime: dateTimeCol >= 0 ? normalizeCell(headers[dateTimeCol]) : null
    },
    filteredRows,
    totalCount: filteredRows.length,
    batchCount: Math.ceil(filteredRows.length / 500),
    sheetStats: { [sheetName]: filteredRows.length },
    cableType,
    dataSource: 'Vertical Cabling'
  });
}

/**
 * MPO: 导入线缆类型包含 MPO 的数据；没有显式“线号”的工作表使用 MPO 顺序号。
 */
function handleMPO(workbook: XLSX.WorkBook, cableType: string) {
  const response = collectMatchingRows(workbook, {
    cableType,
    dataSource: 'MPO',
    sheetFilter: () => true,
    typeMatcher: matchesMpoCableType,
    generatedCableNo: sequence => `MPO ${sequence}`,
    includeBandwidth: true,
    requirePositiveLength: true,
    emptyMessage: '未找到MPO数据：MPO会匹配“线缆类型/接口类型”中包含“MPO”且不包含LC/Cat5e等混合类型的行'
  });

  return response;
}
