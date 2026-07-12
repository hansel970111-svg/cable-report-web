import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { requireDesktopApi } from '@/server/desktop-auth';

export function proxy(request: NextRequest): Response {
  return requireDesktopApi(request) ?? NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
