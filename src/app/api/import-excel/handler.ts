import { CableTypeSchema } from '@/domain/report/schema';
import {
  importExcel,
  ImportExcelError,
  IMPORT_LIMITS,
  type ImportExcelResult,
} from '@/features/import-excel/import-excel';
import {
  toImportExcelApiFailure,
  type ImportExcelApiFailure,
} from '@/features/import-excel/errors';
import { apiError } from '@/server/api-error';
import type { requireDesktopApi } from '@/server/desktop-auth';

export type ImportExcelHandlerDependencies = {
  importExcel: typeof importExcel;
  authenticate: typeof requireDesktopApi;
};

export type ImportExcelHandlerFailure = ImportExcelApiFailure | {
  status: 400 | 411 | 500;
  code:
    | 'CONTENT_LENGTH_REQUIRED'
    | 'INVALID_CONTENT_LENGTH'
    | 'INVALID_MULTIPART_FORM'
    | 'EXCEL_FILE_REQUIRED'
    | 'UNSUPPORTED_CABLE_TYPE'
    | 'EXCEL_PARSE_FAILED';
  message: string;
  retryable: false;
  field?: 'file' | 'cableType';
};

export type ImportExcelPresenter = {
  success(result: ImportExcelResult): Response;
  failure(failure: ImportExcelHandlerFailure): Response;
};

const STABLE_PRESENTER: ImportExcelPresenter = {
  success: result => Response.json({ data: result }),
  failure: failure => apiError(
    failure.status,
    failure.code,
    failure.message,
    failure.retryable,
    failure.field,
  ),
};

const FILE_REQUIRED: ImportExcelHandlerFailure = {
  status: 400,
  code: 'EXCEL_FILE_REQUIRED',
  message: '请选择 Excel 文件。',
  retryable: false,
  field: 'file',
};

const CONTENT_LENGTH_REQUIRED: ImportExcelHandlerFailure = {
  status: 411,
  code: 'CONTENT_LENGTH_REQUIRED',
  message: '请求必须包含 Content-Length。',
  retryable: false,
  field: 'file',
};

const INVALID_CONTENT_LENGTH: ImportExcelHandlerFailure = {
  status: 400,
  code: 'INVALID_CONTENT_LENGTH',
  message: 'Content-Length 格式无效。',
  retryable: false,
  field: 'file',
};

const INVALID_MULTIPART_FORM: ImportExcelHandlerFailure = {
  status: 400,
  code: 'INVALID_MULTIPART_FORM',
  message: '上传表单格式无效。',
  retryable: false,
};

const UNSUPPORTED_CABLE_TYPE: ImportExcelHandlerFailure = {
  status: 400,
  code: 'UNSUPPORTED_CABLE_TYPE',
  message: '不支持的线缆类型。',
  retryable: false,
  field: 'cableType',
};

const FILE_TOO_LARGE: ImportExcelHandlerFailure = {
  status: 413,
  code: 'EXCEL_FILE_TOO_LARGE',
  message: 'Excel 文件不能超过 25 MiB。',
  retryable: false,
  field: 'file',
};

const UNKNOWN_PARSE_FAILURE: ImportExcelHandlerFailure = {
  status: 500,
  code: 'EXCEL_PARSE_FAILED',
  message: 'Excel 文件解析失败。',
  retryable: false,
  field: 'file',
};

const MAX_DECLARED_LENGTH = BigInt(IMPORT_LIMITS.maxBytes + 64 * 1024);

export function createImportExcelPresenterHandler(
  deps: ImportExcelHandlerDependencies,
  presenter: ImportExcelPresenter,
): (request: Request) => Promise<Response> {
  return async request => {
    try {
      const denied = deps.authenticate(request);
      if (denied) return denied;

      const declaredLength = request.headers.get('content-length');
      if (declaredLength === null) {
        return presenter.failure(CONTENT_LENGTH_REQUIRED);
      }
      if (!/^\d+$/.test(declaredLength)) {
        return presenter.failure(INVALID_CONTENT_LENGTH);
      }
      if (BigInt(declaredLength) > MAX_DECLARED_LENGTH) {
        return presenter.failure(FILE_TOO_LARGE);
      }

      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return presenter.failure(INVALID_MULTIPART_FORM);
      }

      const files = formData.getAll('file');
      const cableTypes = formData.getAll('cableType');
      const hasUnexpectedField = Array.from(formData.keys()).some(
        field => field !== 'file' && field !== 'cableType',
      );
      if (files.length > 1 || cableTypes.length > 1 || hasUnexpectedField) {
        return presenter.failure(INVALID_MULTIPART_FORM);
      }

      const file = files[0];
      if (!(file instanceof File)) {
        return presenter.failure(FILE_REQUIRED);
      }

      const parsedCableType = CableTypeSchema.safeParse(cableTypes[0]);
      if (!parsedCableType.success) {
        return presenter.failure(UNSUPPORTED_CABLE_TYPE);
      }

      if (file.size > IMPORT_LIMITS.maxBytes) {
        return presenter.failure(FILE_TOO_LARGE);
      }

      const result = deps.importExcel({
        fileName: file.name,
        mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }, parsedCableType.data);
      return presenter.success(result);
    } catch (error) {
      if (error instanceof ImportExcelError) {
        return presenter.failure(toImportExcelApiFailure(error));
      }
      return presenter.failure(UNKNOWN_PARSE_FAILURE);
    }
  };
}

export function createImportExcelHandler(
  deps: ImportExcelHandlerDependencies,
): (request: Request) => Promise<Response> {
  return createImportExcelPresenterHandler(deps, STABLE_PRESENTER);
}
