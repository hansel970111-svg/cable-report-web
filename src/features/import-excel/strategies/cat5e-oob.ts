import {
  isBeforeWorkloadSheet,
  isYYBXWorkbook,
  matchesRedCableType,
} from '../column-detection';
import { collectMatchingRows, defineStrategy } from './strategy';

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
      typeMatcher: matchesRedCableType,
      generatedCableNo: sequence => String(sequence),
      replaceConstantExplicitCableNo: true,
    });
  },
);
