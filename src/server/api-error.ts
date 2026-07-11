export function apiError(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  field?: string,
): Response {
  return Response.json(
    {
      error: {
        code,
        message,
        retryable,
        ...(field ? { field } : {}),
      },
    },
    { status },
  );
}
