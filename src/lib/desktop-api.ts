export class ApiResponseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

export async function desktopFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.delete('X-Cable-Desktop-Token');

  let requestUrl: URL | null = null;
  try {
    const value = input instanceof Request ? input.url : input.toString();
    requestUrl = new URL(value, window.location.href);
  } catch {
    // Let fetch report malformed input without exposing the desktop token.
  }

  const isSameOriginApi =
    requestUrl?.origin === window.location.origin &&
    (requestUrl.pathname === '/api' || requestUrl.pathname.startsWith('/api/'));
  if (window.cableReport && isSameOriginApi) {
    headers.set(
      'X-Cable-Desktop-Token',
      await window.cableReport.getDesktopSessionToken(),
    );
  }

  return fetch(input, {
    ...init,
    headers,
    ...(window.cableReport && isSameOriginApi ? { redirect: 'error' as const } : {}),
  });
}

export async function readApiError(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();

  if (contentType.includes('application/json')) {
    try {
      const body = JSON.parse(text);
      if (typeof body?.error === 'string' && body.error.trim()) {
        return body.error;
      }
      if (typeof body?.error?.message === 'string' && body.error.message.trim()) {
        return body.error.message;
      }
    } catch {
      // Fall through to HTML and plain-text handling.
    }
  }

  const isHtmlError = /^\s*<!doctype html/i.test(text) || /<html[\s>]/i.test(text);
  if (isHtmlError) {
    if (response.status === 502 || /<title>\s*502\s*<\/title>/i.test(text)) {
      return '服务器生成 PDF 超时或临时不可用，请稍后重试。';
    }
    return `服务器返回了异常页面（HTTP ${response.status}）。`;
  }

  return text.trim() || `请求失败（HTTP ${response.status}）`;
}

export async function requireApiSuccess(response: Response): Promise<void> {
  if (response.ok) return;
  throw new ApiResponseError(await readApiError(response), response.status);
}
