import {
  isBeforeWorkloadSheet,
  isWorkloadSheet,
  isYYBXWorkbook,
  normalizeCell,
  normalizeLower,
} from '../column-detection';
import { collectMatchingRows, defineStrategy } from './strategy';

function isNetworkColorCableType(value: unknown): boolean {
  const text = normalizeCell(value);
  const lower = text.toLowerCase();
  return text.includes('红网')
    || text.includes('黄网')
    || text.includes('蓝网')
    || text.includes('网线')
    || lower.includes('red')
    || lower.includes('yellow')
    || lower.includes('blue')
    || lower.includes('cat5e')
    || lower.includes('cat 5e')
    || lower.includes('cat6');
}

function matchesLcCableType(value: unknown): boolean {
  const lower = normalizeLower(value);
  if (!lower || lower.includes('mpo') || isNetworkColorCableType(value)) return false;
  return /(^|[^a-z0-9])lc([^a-z0-9]|$)/i.test(lower);
}

export const lcStrategy = defineStrategy('LC', (context, limits) => {
  const yybxWorkbook = isYYBXWorkbook(context);

  return collectMatchingRows(context, limits, {
    rule: 'lc',
    sheetFilter: sheetName => {
      if (yybxWorkbook) return isBeforeWorkloadSheet(context, sheetName);

      return !sheetName.toLowerCase().includes('vertical cabling')
        && !isWorkloadSheet(sheetName);
    },
    typeMatcher: matchesLcCableType,
    generatedCableNo: sequence => String(sequence),
    replaceConstantExplicitCableNo: true,
    requirePositiveLength: true,
  });
});
