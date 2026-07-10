export type CableType = 'Cat 5e' | 'Cat 5e (Vertical Cabling)' | 'LC' | 'MPO';
export type ImportRule = 'cat5e-oob' | 'vertical-cabling' | 'lc' | 'mpo';

export type CableImportRow = {
  cableNumber: string;
  cableTypeText: string;
  length: number | null;
  dateTime: string | null;
  sourceLabel: string | null;
  bandwidth: string | null;
  source: {
    sheetName: string;
    rowNumber: number;
    expansionIndex: number;
    rule: ImportRule;
  };
};

export type CableRecord = {
  id: string;
  cableLabel: string;
  cableNumber: string;
  limit: string;
  result: 'PASS' | 'FAIL';
  length: number;
  nextMargin: number;
  dateTime: string;
};

export type ReportDraft = {
  revision: number;
  cableType: CableType;
  site: string;
  records: CableRecord[];
};

export type ApiError = {
  error: { code: string; message: string; field?: string; retryable: boolean };
};
