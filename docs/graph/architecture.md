# BAIT Prepago 2 — Arquitectura

```mermaid
flowchart TD
    Client[Cliente / Navegador] -->|Visita index.html| Static[Vercel Edge Network]
    
    subgraph Vercel
        Static -->|Static Assets| index[index.html / CSS]
        Client -->|POST /api/captcha/challenge| CaptchaAPI[Vercel Serverless Function]
        Client -->|POST /api/leads| API[Vercel Serverless Function]
        
        subgraph Modulos API
            API --> Validation[lib/validation.js<br>Filtro de payload, email y vigencia condicional de NIP]
            API --> Captcha[lib/captcha.js<br>Consumo single-use del challenge]
            API --> Security[lib/security.js<br>Idempotencia y Rate Limit]
            API --> Attribution[lib/attribution.js<br>Captura UTM y GCLID]
            CaptchaAPI --> Captcha
        end
    end
    
    subgraph Neon
        Security --> DB[(Neon PostgreSQL)]
        API -->|Insert phone+email| DB
        Captcha -->|Insert/Update hash| CaptchaTable[(captcha_challenges)]
    end
    
    Validation -- Descartado --> PII(NIP y fecha de vigencia - NO PERSISTIDOS)
    Client -->|GET /aviso-de-privacidad/| PrivacyPage[Página estática, sin JS]
```

Notas Stage 1H:
- `leads.email` se captura para el envío futuro del cupón BAIT (Stage 1I, aún no implementado).
- El NIP sigue sin persistirse; si coincide con los últimos 4 dígitos del teléfono, se exige y valida (no se persiste) una fecha de vigencia dentro de la ventana `hoy..hoy+5` en `America/Mexico_City`.
- El CAPTCHA se resuelve completamente en el servidor: el frontend nunca conoce la respuesta, solo un `challengeId` y una imagen SVG.
