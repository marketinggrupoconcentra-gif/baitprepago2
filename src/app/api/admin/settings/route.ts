/**
 * POST /api/admin/settings — Actualiza un ajuste de app.settings (key/value)
 *
 * Requiere: settings.edit (solo Administrador). Audita SETTINGS_CHANGED.
 * El valor enmascarado ('••••••••••••••••') que envía la UI para secretos se ignora.
 */
import { NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import { logError } from '@/lib/log';
import { z } from 'zod';
import { EDITABLE_SETTING_KEYS, MASKED_VALUE, setSetting } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const settingsSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(2000).nullable(),
});

export async function POST(req: Request) {
  let session;
  try {
    session = await requireAdminSession('settings.edit');
  } catch (res) {
    return res as NextResponse;
  }

  try {
    const body = await req.json();
    const parsed = settingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.format() }, { status: 400 });
    }

    const { key, value } = parsed.data;

    if (!(EDITABLE_SETTING_KEYS as readonly string[]).includes(key)) {
      return NextResponse.json({ error: 'Clave no editable' }, { status: 400 });
    }

    // La UI reenvía el valor enmascarado cuando el secreto no cambió
    if (value === MASKED_VALUE) {
      return NextResponse.json({ success: true, ignored: true });
    }

    await setSetting(key, value?.trim() ?? null);

    // Auditoría: solo la clave, nunca el valor (puede ser un secreto)
    await writeAuditLog({
      session,
      action: 'SETTINGS_CHANGED',
      targetType: 'setting',
      safeMetadata: { key, cleared: value === null || value === '' },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logError('/api/admin/settings', 'handler', err);
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
  }
}
