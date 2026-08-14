import { isYellowCat5eType } from '@/domain/report/cable-rules';

import {
  isBeforeWorkloadSheet,
  isYYBXWorkbook,
  matchesRedCableType,
} from '../column-detection';
import { collectMatchingRows, defineStrategy } from './strategy';

function matchesCat5eOobCableType(value: unknown, sheetName: string): boolean {
  if (matchesRedCableType(value)) return true;
  return !sheetName.toLowerCase().includes('vertical cabling')
    && isYellowCat5eType(value);
}

export const cat5eOobStrategy = defineStrategy(
  'Cat 5e',
  (context, limits) => {
    const yybxWorkbook = isYYBXWorkbook(context);

    return collectMatchingRows(context, limits, {
      rule: 'cat5e-oob',
      sheetFilter: sheetName => {
        if (yybxWorkbook) return isBeforeWorkloadSheet(context, sheetName);

        const lower = sheetName.toLowerCase();
        return lower.includes('oob')
          && !lower.includes('crosse')
          && !lower.includes('cross');
      },
      typeMatcher: matchesCat5eOobCableType,
      generatedCableNo: sequence => String(sequence),
      replaceConstantExplicitCableNo: true,
    });
  },
);
