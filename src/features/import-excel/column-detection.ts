import * as XLSX from 'xlsx';

import type { WorkbookContext } from './contracts';

export type ExcelRow = unknown[];

export type DetectedColumns = Readonly<Record<string, string | null>>;

export type LengthMode = 'firstNumeric' | 'sumFirstTwoPlus50';

export type SheetColumnProfile = {
  headerRowCount: number;
  cableTypeCol: number;
  cableNoCol: number;
  cableNoCols: number[];
  lengthCols: number[];
  lengthMode: LengthMode;
  dateTimeCol: number;
  sourceLabelCols: number[];
  detectedColumns: DetectedColumns;
};

export type VerticalColumnProfile = {
  headerRowIndex: number;
  headers: ExcelRow;
  cableTypeCol: number;
  qtyCol: number;
  lengthCols: number[];
  dateTimeCol: number;
  rackRoomCol: number;
  ruCol: number;
};

export function normalizeCell(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeLower(value: unknown): string {
  return normalizeCell(value).toLowerCase();
}

export function readSheetRows(worksheet: XLSX.WorkSheet): ExcelRow[] {
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
  }) as ExcelRow[];
}

function findColumn(
  headers: ExcelRow,
  matcher: (headerLower: string, header: string) => boolean,
): number {
  for (let index = 0; index < headers.length; index++) {
    const header = normalizeCell(headers[index]);
    if (header && matcher(header.toLowerCase(), header)) return index;
  }

  return -1;
}

function findColumns(
  headers: ExcelRow,
  matcher: (headerLower: string, header: string) => boolean,
): number[] {
  const columns: number[] = [];

  headers.forEach((rawHeader, index) => {
    const header = normalizeCell(rawHeader);
    if (header && matcher(header.toLowerCase(), header)) columns.push(index);
  });

  return columns;
}

function findCableTypeColumn(headers: ExcelRow): number {
  const primaryColumn = findColumn(headers, headerLower => (
    headerLower.includes('线缆类型')
    || headerLower.includes('cable type')
    || headerLower === 'type'
    || headerLower === '类型'
  ));

  if (primaryColumn >= 0) return primaryColumn;

  return findColumn(headers, headerLower => (
    headerLower.includes('接口类型') || headerLower.includes('interface type')
  ));
}

function findCableNoColumn(headers: ExcelRow): number {
  return findColumn(headers, headerLower => (
    headerLower.includes('线号')
    || headerLower.includes('cable no')
    || headerLower.includes('cable label')
  ));
}

function findCableNoColumns(headers: ExcelRow): number[] {
  return findColumns(headers, headerLower => (
    headerLower.includes('线号')
    || headerLower.includes('cable no')
    || headerLower.includes('cable label')
  ));
}

function getLengthColumnPriority(value: unknown): number {
  const headerLower = normalizeLower(value);

  if (headerLower.includes('线长')) return 0;
  if (headerLower === 'length' || headerLower.includes('length (m)')) return 1;
  if (headerLower.includes('长度') && !headerLower.includes('距离')) return 2;
  if (headerLower.includes('length')) return 3;
  return 4;
}

function findLengthColumns(headers: ExcelRow): number[] {
  const columns = findColumns(headers, headerLower => (
    headerLower.includes('线长')
    || headerLower.includes('长度')
    || headerLower.includes('length')
  ));

  return columns.sort((first, second) => {
    const firstPriority = getLengthColumnPriority(headers[first]);
    const secondPriority = getLengthColumnPriority(headers[second]);
    return firstPriority - secondPriority || first - second;
  });
}

function findDateTimeColumn(headers: ExcelRow): number {
  return findColumn(headers, headerLower => (
    headerLower.includes('date & time')
    || headerLower.includes('datetime')
    || headerLower === 'date'
    || headerLower === 'time'
    || headerLower.includes('日期')
    || headerLower.includes('时间')
    || headerLower === '测试时间'
  ));
}

function findQtyColumn(headers: ExcelRow): number {
  return findColumn(headers, headerLower => (
    headerLower === 'qty'
    || headerLower === 'quantity'
    || headerLower.includes('数量')
  ));
}

function findRackRoomColumn(headers: ExcelRow): number {
  return findColumn(headers, headerLower => (
    headerLower.includes('rack&room')
    || headerLower.includes('rack room')
    || headerLower.includes('rack')
    || headerLower.includes('机柜')
    || headerLower.includes('机房')
    || headerLower.includes('包间')
  ));
}

function findRuColumn(headers: ExcelRow): number {
  return findColumn(headers, headerLower => (
    headerLower === 'ru' || headerLower.includes('u位')
  ));
}

function isSourceLabelHeader(headerLower: string): boolean {
  return headerLower.includes('临时标签') || headerLower.includes('source label');
}

function findSourceLabelColumns(headers: ExcelRow): number[] {
  return findColumns(headers, headerLower => isSourceLabelHeader(headerLower));
}

export function matchesRedCableType(value: unknown): boolean {
  const text = normalizeCell(value);
  return text.includes('红') || text.toLowerCase().includes('red');
}

export function detectVerticalColumns(rows: ExcelRow[]): VerticalColumnProfile | null {
  let bestProfile: VerticalColumnProfile | null = null;
  let bestScore = -1;

  for (let headerRowIndex = 0; headerRowIndex < Math.min(rows.length, 12); headerRowIndex++) {
    const headers = rows[headerRowIndex] || [];
    const cableTypeCol = findCableTypeColumn(headers);
    if (cableTypeCol < 0) continue;

    const qtyCol = findQtyColumn(headers);
    const lengthCols = findLengthColumns(headers);
    const dateTimeCol = findDateTimeColumn(headers);
    const rackRoomCol = findRackRoomColumn(headers);
    const ruCol = findRuColumn(headers);

    let redMatches = 0;
    for (
      let rowIndex = headerRowIndex + 1;
      rowIndex < Math.min(rows.length, headerRowIndex + 120);
      rowIndex++
    ) {
      if (matchesRedCableType(rows[rowIndex]?.[cableTypeCol])) redMatches++;
    }

    const score = redMatches * 10
      + (qtyCol >= 0 ? 3 : 0)
      + lengthCols.length * 2
      + (rackRoomCol >= 0 ? 2 : 0)
      + (ruCol >= 0 ? 2 : 0)
      + (dateTimeCol >= 0 ? 1 : 0);

    if (score > bestScore) {
      bestScore = score;
      bestProfile = {
        headerRowIndex,
        headers,
        cableTypeCol,
        qtyCol,
        lengthCols,
        dateTimeCol,
        rackRoomCol,
        ruCol,
      };
    }
  }

  return bestProfile;
}

export function readNumber(row: ExcelRow, column: number): number | null {
  const raw = normalizeCell(row[column]);
  if (!raw) return null;

  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

export function readLength(
  row: ExcelRow,
  lengthColumns: number[],
  mode: LengthMode = 'firstNumeric',
): number {
  if (mode === 'sumFirstTwoPlus50') {
    const values = lengthColumns.slice(0, 2).map(column => readNumber(row, column));
    const numericValues = values.filter((value): value is number => value !== null);

    if (numericValues.length > 0) {
      return numericValues.reduce((sum, value) => sum + value, 0) + 50;
    }
  }

  for (const column of lengthColumns) {
    const value = readNumber(row, column);
    if (value !== null) return value;
  }

  return 0;
}

function combineColumnNames(headers: ExcelRow, columns: number[]): string | null {
  const names = columns.map(column => normalizeCell(headers[column])).filter(Boolean);
  return names.length > 0 ? names.join(', ') : null;
}

function hasCableDataHeaders(headers: ExcelRow): boolean {
  return findCableNoColumn(headers) >= 0
    || findLengthColumns(headers).length > 0
    || findDateTimeColumn(headers) >= 0
    || findSourceLabelColumns(headers).length > 0;
}

export function isYYBXWorkbook(context: WorkbookContext): boolean {
  if (/yybx/i.test(context.fileName)) return true;

  for (const sheetName of context.workbook.SheetNames.slice(0, 5)) {
    const rows = readSheetRows(context.workbook.Sheets[sheetName]).slice(0, 30);
    for (const row of rows) {
      if (row.some(cell => /yybx/i.test(normalizeCell(cell)))) return true;
    }
  }

  return false;
}

export function isWorkloadSheet(sheetName: string): boolean {
  return sheetName.toLowerCase().includes('workload');
}

export function isBeforeWorkloadSheet(
  context: WorkbookContext,
  sheetName: string,
): boolean {
  if (isWorkloadSheet(sheetName)) return false;

  const sheetIndex = context.workbook.SheetNames.indexOf(sheetName);
  const workloadIndex = context.workbook.SheetNames.findIndex(isWorkloadSheet);
  return workloadIndex < 0 || sheetIndex < workloadIndex;
}

function inferCableTypeColumn(
  rows: ExcelRow[],
  headers: ExcelRow,
  startRow: number,
  typeMatcher: (value: unknown) => boolean,
): number {
  const width = Math.max(
    ...rows.slice(0, Math.min(rows.length, 20)).map(row => row.length),
    0,
  );
  let bestColumn = -1;
  let bestMatches = 0;

  for (let column = 0; column < width; column++) {
    const headerLower = normalizeLower(headers[column]);
    if (headerLower && !isSourceLabelHeader(headerLower)) continue;

    let matches = 0;
    for (
      let rowIndex = startRow;
      rowIndex < Math.min(rows.length, startRow + 80);
      rowIndex++
    ) {
      if (typeMatcher(rows[rowIndex]?.[column])) matches++;
    }

    if (matches > bestMatches) {
      bestColumn = column;
      bestMatches = matches;
    }
  }

  return bestMatches > 0 ? bestColumn : -1;
}

function inferCableNoColumnAfterType(
  rows: ExcelRow[],
  headers: ExcelRow,
  cableTypeColumn: number,
  startRow: number,
): number {
  const candidateColumn = cableTypeColumn + 1;
  if (normalizeCell(headers[candidateColumn])) return -1;

  let numericValues = 0;
  for (
    let rowIndex = startRow;
    rowIndex < Math.min(rows.length, startRow + 80);
    rowIndex++
  ) {
    if (readNumber(rows[rowIndex] || [], candidateColumn) !== null) numericValues++;
  }

  return numericValues > 0 ? candidateColumn : -1;
}

export function detectSheetColumns(
  rows: ExcelRow[],
  sheetName: string,
  typeMatcher: (value: unknown) => boolean,
): SheetColumnProfile | null {
  const firstHeaders = rows[0] || [];
  const secondHeaders = rows[1] || [];

  const firstCableTypeColumn = findCableTypeColumn(firstHeaders);
  const secondCableTypeColumn = findCableTypeColumn(secondHeaders);
  const secondCableNoColumn = findCableNoColumn(secondHeaders);
  const secondLengthColumns = findLengthColumns(secondHeaders);
  const hasSecondHeaderColumns = secondCableNoColumn >= 0 || secondLengthColumns.length > 0;

  const useTwoRowHeader = firstCableTypeColumn >= 0 && hasSecondHeaderColumns;
  const headerRowCount = useTwoRowHeader ? 2 : 1;
  const primaryHeaders = useTwoRowHeader ? secondHeaders : firstHeaders;
  const fallbackHeaders = useTwoRowHeader ? firstHeaders : secondHeaders;
  const hasDataHeaders = hasCableDataHeaders(primaryHeaders)
    || hasCableDataHeaders(fallbackHeaders);

  if (!hasDataHeaders) return null;

  let cableTypeCol = useTwoRowHeader
    ? firstCableTypeColumn
    : firstCableTypeColumn >= 0
      ? firstCableTypeColumn
      : secondCableTypeColumn;
  let inferredCableTypeColumn = false;

  if (cableTypeCol === -1) {
    cableTypeCol = inferCableTypeColumn(rows, primaryHeaders, headerRowCount, typeMatcher);
    inferredCableTypeColumn = cableTypeCol >= 0;
  }

  if (cableTypeCol === -1) return null;

  const explicitCableNoColumn = useTwoRowHeader
    ? secondCableNoColumn
    : findCableNoColumn(primaryHeaders);
  const explicitCableNoColumns = findCableNoColumns(primaryHeaders);
  const inferredCableNoColumn = inferredCableTypeColumn
    ? inferCableNoColumnAfterType(rows, primaryHeaders, cableTypeCol, headerRowCount)
    : -1;
  const cableNoCol = explicitCableNoColumn >= 0
    ? explicitCableNoColumn
    : inferredCableNoColumn >= 0
      ? inferredCableNoColumn
      : -1;
  const cableNoCols = explicitCableNoColumns.length > 0
    ? explicitCableNoColumns
    : inferredCableNoColumn >= 0
      ? [inferredCableNoColumn]
      : [];
  const lengthCols = useTwoRowHeader
    ? secondLengthColumns
    : findLengthColumns(primaryHeaders);
  const primaryDateTimeColumn = findDateTimeColumn(primaryHeaders);
  const dateTimeCol = primaryDateTimeColumn >= 0
    ? primaryDateTimeColumn
    : findDateTimeColumn(fallbackHeaders);
  const sourceLabelCols = [
    ...findSourceLabelColumns(primaryHeaders),
    ...findSourceLabelColumns(fallbackHeaders),
  ];

  const isCrossSheet = sheetName.toLowerCase().includes('cross');
  const lengthMode: LengthMode = (isCrossSheet || useTwoRowHeader) && lengthCols.length >= 2
    ? 'sumFirstTwoPlus50'
    : 'firstNumeric';
  const lengthName = combineColumnNames(primaryHeaders, lengthCols);
  const cableNoName = combineColumnNames(primaryHeaders, cableNoCols);

  return {
    headerRowCount,
    cableTypeCol,
    cableNoCol,
    cableNoCols,
    lengthCols,
    lengthMode,
    dateTimeCol,
    sourceLabelCols,
    detectedColumns: {
      cableType: normalizeCell(firstHeaders[cableTypeCol])
        || normalizeCell(secondHeaders[cableTypeCol])
        || `推断列 ${XLSX.utils.encode_col(cableTypeCol)}`,
      cableNo: cableNoName
        || (cableNoCol >= 0 ? `推断列 ${XLSX.utils.encode_col(cableNoCol)}` : '自动序号'),
      length: lengthName
        ? (lengthMode === 'sumFirstTwoPlus50' ? `${lengthName} + 50m` : lengthName)
        : null,
      dateTime: dateTimeCol >= 0
        ? normalizeCell(primaryHeaders[dateTimeCol])
          || normalizeCell(fallbackHeaders[dateTimeCol])
        : null,
    },
  };
}

export function readFirstCableNo(row: ExcelRow, columns: number[]): string {
  for (const column of columns) {
    const value = normalizeCell(row[column]);
    if (value) return value;
  }

  return '';
}

function formatDateTime(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours %= 12;
  hours = hours || 12;

  return `${day}-${month}-${year} ${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
}

export function readDateTime(row: ExcelRow, dateTimeColumn: number): string | null {
  if (dateTimeColumn < 0) return null;

  const rawDateTime = row[dateTimeColumn];
  if (!rawDateTime) return null;

  if (rawDateTime instanceof Date) return formatDateTime(rawDateTime);

  if (typeof rawDateTime === 'number') {
    const parsed = XLSX.SSF.parse_date_code(rawDateTime);
    if (parsed) {
      return formatDateTime(new Date(
        parsed.y,
        parsed.m - 1,
        parsed.d,
        parsed.H,
        parsed.M,
        Math.floor(parsed.S),
      ));
    }
  }

  return normalizeCell(rawDateTime) || null;
}

export function readFirstSourceLabel(row: ExcelRow, columns: number[]): string {
  for (const column of columns) {
    const value = normalizeCell(row[column]);
    if (value) return value;
  }

  return '';
}
