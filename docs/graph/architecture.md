# BAIT Prepago 2 — Arquitectura

```mermaid
flowchart TD
    Client[Cliente / Navegador] -->|GET /| Landing[public/legacy/index.html<br>+ public/assets/site.js]
    Client -->|GET /gracias/ · /duplicado/ · /aviso-de-privacidad/| Static[Páginas estáticas<br>public/legacy/*]

    subgraph Vercel [Vercel · Next.js 16]
        Proxy[src/proxy.ts<br>CSP · rate limit edge · redirects]
        Landing -->|POST /api/captcha/challenge| CaptchaAPI[api/captcha/challenge]
        Landing -->|POST /api/leads| LeadAPI[api/leads → handle-lead-request.ts]
        Landing -->|POST /api/track| TrackAPI[api/track]
        Analytics[public/assets/js/bait-analytics.js] -->|GET /api/analytics/config| ConfigAPI[api/analytics/config]

        subgraph Pipeline [Alta de lead]
            LeadAPI --> Origin[origen · bot · rate limit distribuido]
            Origin --> AntiBot[honeypot · tiempo mínimo · idempotencia]
            AntiBot --> Schema[lead-schema.ts<br>Zod + regla del NIP]
            Schema --> Captcha[captcha.ts<br>consumo single-use]
            Captcha --> Dedupe[blind index del teléfono]
            Dedupe --> Submit[submit-lead.ts<br>una transacción]
        end

        Admin[/admin/* · Neon Auth + RBAC] --> AdminAPI[api/admin/*]
        Crons[api/cron/{nip-purge,reports,google-ads}]
    end

    subgraph Neon [Neon Postgres · schema app]
        Submit -->|leads · lead_consents · lead_attribution · analytics_events| DB[(app.*)]
        CaptchaAPI -->|hash del reto| DB
        TrackAPI --> DB
        AdminAPI -->|rol runtime de mínimo privilegio| DB
        Crons --> DB
    end

    Schema -- Descartados --> PII(NIP y fecha de vigencia<br>NO PERSISTIDOS)
    Crons -->|reportes| Brevo[Brevo]
```

- Zona protegida (landing, páginas estáticas y assets): `.scale-design-lock.json`.
- Reglas del proyecto (stack estricto, NIP, CDMX): `GEMINI.md`.
- Bitácora de la migración al motor: `docs/migracion-motor-scale.md`.
