import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireDesktopApi } from '@/server/desktop-auth';

export function proxy(request: NextRequest): Response {
  const response = requireDesktopApi(request) ?? NextResponse.next();
  if (
    request.nextUrl.pathname === '/api/upload-excel' ||
    request.nextUrl.pathname === '/api/upload-excel/'
  ) {
    response.headers.set('Deprecation', 'true');
  }
  return response;
}

export const config = { matcher: '/api/:path*' };
