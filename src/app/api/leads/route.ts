/**
 * POST /api/leads — Alta de lead desde la landing BAIT Prepago (contrato original de site.js).
 * Handler compartido con /api/v1/leads: src/lib/leads/handle-lead-request.ts
 * (10 capas de seguridad + CAPTCHA propio + transacción única). GET/PUT/PATCH/DELETE → 405.
 */
import { NextRequest } from 'next/server';
import { handleLeadRequest, methodNotAllowed } from '@/lib/leads/handle-lead-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return handleLeadRequest(req, '/api/leads');
}
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
