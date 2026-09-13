/**
 * POST /api/v1/leads — Alias versionado de POST /api/leads (mismo handler y contrato).
 * Handler: src/lib/leads/handle-lead-request.ts (36_analytics_data_contract.md §4).
 */
import { NextRequest } from 'next/server';
import { handleLeadRequest, methodNotAllowed } from '@/lib/leads/handle-lead-request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  return handleLeadRequest(req, '/api/v1/leads');
}
export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
