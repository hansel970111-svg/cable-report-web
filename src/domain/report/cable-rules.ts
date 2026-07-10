import type { CableImportRow, CableType, ReportDraft } from './model';

const TEMPLATE_ASSETS: Readonly<Record<CableType, string>> = Object.freeze({
  'Cat 5e': 'assets/M138-DE46-OOB-Cat5e.pdf',
  'Cat 5e (Vertical Cabling)': 'assets/M138-DE46-OOB-Cat5e.pdf',
  LC: 'assets/M138-DE46-D-P-cross-LC.pdf',
  MPO: 'assets/M138-DE46-P-A-MPO.pdf',
});

function extractBandwidth(value: string | null): string {
  const text = value ?? '';
  const match = text.match(/(\d+)\s*G/i);
  if (match) return `${match[1]}G`.toUpperCase();
  if (text.includes('蓝') || text.toLowerCase().includes('blue')) return '100G';
  return '';
}

export function defaultLimitForCableType(cableType: CableType): string {
  if (cableType === 'MPO') return '200GBASE-SR10';
  if (cableType === 'LC') return 'Link Validation';
  return 'TIA - Cat 5e Channel';
}

export function buildCableLabel(row: CableImportRow, cableType: CableType): string {
  const cableNumber = row.cableNumber.trim();

  if (cableType === 'Cat 5e (Vertical Cabling)') {
    return cableNumber.replace(/^#/, '');
  }

  if (cableType === 'MPO') {
    const numberPart = cableNumber.replace(/^MPO\s*/i, '').replace(/^#/, '');
    return `#${numberPart}`;
  }

  return cableNumber.startsWith('#') ? cableNumber : `#${cableNumber}`;
}

export function buildLimit(row: CableImportRow, cableType: CableType): string {
  if (cableType !== 'MPO') return defaultLimitForCableType(cableType);

  const bandwidth =
    extractBandwidth(row.bandwidth) ||
    extractBandwidth(row.cableTypeText) ||
    extractBandwidth(row.sourceLabel) ||
    '200G';
  return `${bandwidth}BASE-SR10`;
}

export const templateAssetFor = (cableType: CableType): string =>
  TEMPLATE_ASSETS[cableType];

export function suggestedPdfName(draft: ReportDraft, now: Date): string {
  const safeSite = draft.site.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Unknown';
  const safeType = draft.cableType.replace(/[^a-zA-Z0-9]/g, '_');
  const two = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}_${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `${safeSite}_${safeType}_${stamp}.pdf`;
}
