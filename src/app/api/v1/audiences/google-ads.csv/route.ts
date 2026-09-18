import { NextRequest, NextResponse } from 'next/server';
import { getDb, schema } from '@/db';
import { decryptPII } from '@/lib/crypto';
import { toCSVRow } from '@/lib/security/csv';
import { and, desc, eq } from 'drizzle-orm';
import { logError } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBasicAuthCredentials(req: NextRequest): { user: string; pass: string } | null {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return null;

  try {
    const base64 = authHeader.split(' ')[1];
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const [user, pass] = decoded.split(':');
    return { user, pass };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  // (El checkBot se remueve porque Google Ads hará la petición con su propio user-agent automatizado)

  // 2. Verificar Autenticación Básica
  const expectedUser = process.env.GOOGLE_ADS_AUDIENCE_USER;
  const expectedPass = process.env.GOOGLE_ADS_AUDIENCE_PASS;

  if (!expectedUser || !expectedPass) {
    logError('/api/v1/audiences/google-ads', 'config', new Error('Variables de entorno de Google Ads no configuradas.'));
    return NextResponse.json({ error: 'Servicio no configurado.' }, { status: 503 });
  }

  const creds = getBasicAuthCredentials(req);
  if (!creds || creds.user !== expectedUser || creds.pass !== expectedPass) {
    return new NextResponse('Unauthorized', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Secure Area"',
      },
    });
  }

  try {
    const db = getDb();

    // 3. Obtener Leads Entregados a Intelix (estatus 200/delivered)
    const rows = await db
      .select({
        firstNameEnc: schema.leads.firstNameEnc,
        lastNameEnc: schema.leads.lastNameEnc,
        phoneEnc: schema.leads.phoneEnc,
        emailEnc: schema.leads.emailEnc,
        deliveredAt: schema.deliveryOutbox.deliveredAt,
      })
      .from(schema.deliveryOutbox)
      .innerJoin(schema.leads, eq(schema.deliveryOutbox.leadId, schema.leads.id))
      .where(
        and(
          eq(schema.deliveryOutbox.destination, 'intelix'),
          eq(schema.deliveryOutbox.status, 'delivered')
        )
      )
      // Limitamos a 250,000 para no explotar la memoria en el edge, Google Ads soporta cargas parciales o totales.
      .orderBy(desc(schema.deliveryOutbox.deliveredAt))
      .limit(250000);

    // 4. Formatear como CSV (Google Ads Offline Conversions / Customer Match Template)
    const headers = ['Email', 'Phone', 'First_Name', 'Last_Name', 'Country', 'Conversion_Name', 'Conversion_Time'];
    const out = [toCSVRow(headers)];

    // Formateador de fecha para America/Mexico_City según formato Google Ads (yyyy-MM-dd HH:mm:ss -0600)
    const formatter = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    for (const r of rows) {
      try {
        const email = decryptPII(r.emailEnc);
        // Google Ads recomienda incluir el código de país. Asumimos +52 (MX) para BAIT.
        // Si el teléfono ya trae +52, lo dejamos. Si no, se lo agregamos.
        let rawPhone = decryptPII(r.phoneEnc).replace(/\D/g, '');
        if (rawPhone.length === 10) {
          rawPhone = `+52${rawPhone}`;
        } else if (!rawPhone.startsWith('+')) {
          rawPhone = `+${rawPhone}`;
        }

        const firstName = decryptPII(r.firstNameEnc);
        const lastName = decryptPII(r.lastNameEnc);

        // Formatear deliveredAt
        let conversionTime = '';
        if (r.deliveredAt) {
          // Intl.DateTimeFormat 'es-MX' da algo como "dd/mm/yyyy, HH:mm:ss"
          // Google Ads acepta "yyyy-MM-dd HH:mm:ss -0600". Lo construiremos manualmente.
          const parts = formatter.formatToParts(r.deliveredAt);
          const p: Record<string, string> = {};
          for (const part of parts) {
            p[part.type] = part.value;
          }
          // Offset de CDMX puede ser -0600 (no hay horario de verano ya)
          conversionTime = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} -0600`;
        }

        out.push(toCSVRow([email, rawPhone, firstName, lastName, 'MX', 'conversiones offline pospago bait', conversionTime]));
      } catch (err) {
        // Ignorar fila si hay error de descifrado
        continue;
      }
    }

    const csv = out.join('\n'); // Google Ads CSVs require newlines

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="audience.csv"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    logError('/api/v1/audiences/google-ads', 'GET', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
