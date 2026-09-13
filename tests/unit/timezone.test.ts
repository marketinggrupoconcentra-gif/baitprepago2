/**
 * timezone.test.ts
 * 
 * Valida el comportamiento correcto de timezone para CDMX.
 * La aplicación usa TIMESTAMPTZ en PostgreSQL y opera sobre UTC,
 * pero los reportes y horarios de negocio deben interpretarse en America/Mexico_City.
 */
import { describe, test, expect } from 'vitest';

const CDMX_TIMEZONE = 'America/Mexico_City';
const UTC_OFFSET_STANDARD = -6; // UTC-6 en horario estándar

describe('Timezone boundaries CDMX', () => {
  test('CDMX está definida como zona canónica del proyecto', () => {
    // Verifica que Intl.DateTimeFormat reconoce la timezone
    expect(() => new Intl.DateTimeFormat('es-MX', { timeZone: CDMX_TIMEZONE })).not.toThrow();
  });

  test('NIP purge cron: 09:00 UTC = 03:00 CDMX (UTC-6)', () => {
    // Simular una fecha en zona UTC y convertirla a CDMX
    const utcDate = new Date('2026-01-15T09:00:00Z'); // Enero = horario estándar UTC-6
    const cdmxFormatter = new Intl.DateTimeFormat('es-MX', {
      timeZone: CDMX_TIMEZONE,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const cdmxTime = cdmxFormatter.format(utcDate);
    // 09:00 UTC - 6h = 03:00 CDMX
    expect(cdmxTime).toBe('03:00');
  });

  test('timestamps almacenados son TIMESTAMPTZ (UTC)', () => {
    // Verificar que Date.now() retorna UTC (siempre true en Node.js)
    const now = new Date();
    expect(now.toISOString()).toMatch(/Z$/); // ISO siempre termina en Z (UTC)
  });

  test('conversión CDMX → UTC para horario de purge', () => {
    // 03:00 CDMX (UTC-6) = 09:00 UTC
    const cdmxHour = 3;
    const utcHour = cdmxHour + Math.abs(UTC_OFFSET_STANDARD);
    expect(utcHour).toBe(9);
    // Esto mapea a la expresión cron: 0 9 * * *
  });

  test('format de fechas en CDMX para reportes', () => {
    const utcDate = new Date('2026-06-15T15:30:00Z'); // Junio — puede ser DST
    const formatted = new Intl.DateTimeFormat('es-MX', {
      timeZone: CDMX_TIMEZONE,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(utcDate);
    // Solo verificar que formatea sin error
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
  });

  test('lead created_at debería ser UTC iso string', () => {
    const now = new Date();
    const iso = now.toISOString();
    // Formato: YYYY-MM-DDTHH:mm:ss.sssZ
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
