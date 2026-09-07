## Summary
- NIP condicional: si el NIP == últimos 4 dígitos del teléfono, exige fecha de vigencia (hoy..hoy+5, CDMX civil days). Ni el NIP ni la fecha se persisten.
- Captura de correo electrónico (leads.email) para el envío futuro del cupón BAIT (Stage 1I, no implementado aquí). Nullable para no romper leads históricos.
- CAPTCHA 100% server-side (api/captcha/challenge.js, lib/captcha.js): imagen SVG generada en backend, respuesta nunca expuesta al cliente, solo se persiste HMAC-SHA256(CAPTCHA_PEPPER, ...), single-use, fail-closed si falta el secreto.
- Corrección del Aviso de Privacidad: enlace real a /aviso-de-privacidad/ (antes href="#") + página estática nueva. Contenido legal (razón social, domicilio, contacto ARCO) queda pendiente — ver docs/legal/privacy-required-inputs.md. PRIVACY LEGAL CONTENT: BLOCKED hasta recibir esos datos.
- Migration 005 (db/migrations/005_form_security_captcha.sql): leads.email + tabla captcha_challenges. Aplicada y verificada en el branch QA de Neon (br-wandering-wildflower-avydy51w), no en Producción.
- WhatsApp/SMS: sin cambios funcionales (mismo número, mismo mensaje, mismo flujo de redirección; solo se reordenó para esperar la respuesta de /api/leads antes de redirigir, ya que el CAPTCHA ahora bloquea envíos inválidos).
- **Preview Safety Hardening**: Refactored `scripts/preview-safety.js` and `lib/db.js` to ensure strict database isolation (Fail-closed on storage fallback) before Production promotion.
- **Admin Login UI**: Implemented the new admin login UI design parity (HTML, CSS, assets, logic) matching the approved mocks, without modifying the underlying authentication logic.

## Test plan
- [x] npm test (regresión completa + nuevas suites unitarias) — 0 failures.
- [x] tests/captcha-lead-integration.js contra QA Neon — challenge/consume/replay/expired/email persistence, verificado en vivo.
- [x] Verificación directa de esquema QA (email column, captcha_challenges, 0 columnas nip, timezone CDMX).
- [x] happy-path E2E PASS
- [x] same-origin PASS
- [x] CAPTCHA rate limit PASS
- [x] migration fail-closed PASS
- [x] preview-safety PASS (15 unit test scenarios)
- [x] Admin Auth Integration / E2E test suites PASS

**PRODUCTION MUTATIONS: ZERO** — Migration 005 solo se aplicó al branch QA de Neon.
**PRODUCTION DEPLOYMENT: ZERO**
**PRIVACY LEGAL: BLOCKED**

🤖 Generated with Google Antigravity
