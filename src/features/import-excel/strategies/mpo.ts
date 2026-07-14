import {
  isBeforeWorkloadSheet,
  isWorkloadSheet,
  isYYBXWorkbook,
  normalizeLower,
} from '../column-detection';
import { collectMatchingRows, defineStrategy } from './strategy';

function matchesMpoCableType(value: unknown): boolean {
  const lower = normalizeLower(value);
  const isMixedType = lower.includes('cat5e')
    || lower.includes('cat 5e')
    || lower.includes('cat6')
    || lower.includes('网线')
    || lower.includes('跳线')
    || lower.includes('lc')
    || lower.includes('sc');

  return lower.includes('mpo') && !isMixedType;
}

function extractBandwidth(cableTypeText: string, sourceLabel: string): string {
  const combined = `${cableTypeText} ${sourceLabel}`;
  const match = combined.match(/(\d+\s*G)/i);
  if (match) return match[1].replace(/\s+/g, '').toUpperCase();
  if (combined.includes('蓝') || combined.toLowerCase().includes('blue')) return '100G';
  return '';
}

export const mpoStrategy = defineStrategy('MPO', (context, limits) => {
  const yybxWorkbook = isYYBXWorkbook(context);

  return collectMatchingRows(context, limits, {
    rule: 'mpo',
    sheetFilter: sheetName => yybxWorkbook
      ? isBeforeWorkloadSheet(context, sheetName)
      : !isWorkloadSheet(sheetName),
    typeMatcher: matchesMpoCableType,
    generatedCableNo: sequence => `MPO ${sequence}`,
    bandwidth: extractBandwidth,
    requirePositiveLength: true,
  });
});
