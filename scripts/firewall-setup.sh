#!/usr/bin/env bash
# =============================================================================
#  BAIT Prepago — Vercel Firewall (WAF) — capa de borde anti-DDoS / anti-scraping
# =============================================================================
#
#  Contexto:
#    - La mitigación AUTOMÁTICA de DDoS (L3/L4/L7) de Vercel ya está activa en
#      todos los planes sin configuración. Esto NO se toca.
#    - El tráfico bloqueado por WAF / DDoS NO se factura.
#    - Este script AÑADE reglas personalizadas. Las reglas se crean STAGED
#      (borrador) y en modo `log` (no bloquean). TÚ revisas y publicas.
#
#  Requisitos:
#    npm i -g vercel
#    vercel login
#    vercel link            # dentro de este repo
#
#  Uso:
#    bash scripts/firewall-setup.sh          # crea las reglas en modo log
#    vercel firewall diff                    # revisa el borrador
#    vercel firewall publish --yes           # publícalas (modo log, no bloquean)
#
#  Rollout recomendado por regla (ver skill vercel:vercel-firewall):
#    1. log en producción  → revisar /firewall/traffic?filter=<ruleId> 24-48h
#    2. deny/challenge SÓLO en preview  (+ condición environment=preview)
#    3. deny/challenge en producción
#
#  Para endurecer una regla ya publicada:
#    vercel firewall rules edit "<nombre>" --action deny --yes   (+ re-especificar condiciones)
#    vercel firewall publish --yes
# =============================================================================
set -euo pipefail

if ! command -v vercel >/dev/null 2>&1; then
  echo "ERROR: Vercel CLI no instalado.  npm i -g vercel && vercel login && vercel link" >&2
  exit 1
fi

echo "==> Creando reglas WAF (STAGED, modo log). Nada se bloquea todavía."

# ── 1. Sondas de exploit / rutas de secretos ────────────────────────────────
vercel firewall rules add "Block exploit probes" \
  --condition '{"type":"path","op":"re","value":"(?i)(\\.env|\\.git|wp-admin|wp-login\\.php|xmlrpc\\.php|phpmyadmin|adminer|vendor/phpunit|eval-stdin\\.php|/\\.aws/|/\\.ssh/)"}' \
  --action log --yes

# ── 2. Rate limit general de la API (por IP) ────────────────────────────────
#     Límite generoso (~10x tráfico legítimo esperado). Ajustar tras revisar.
vercel firewall rules add "Rate limit /api" \
  --condition '{"type":"path","op":"pre","value":"/api/"}' \
  --condition '{"type":"path","op":"pre","neg":true,"value":"/api/auth"}' \
  --action rate_limit \
  --rate-limit-window 60 \
  --rate-limit-requests 120 \
  --rate-limit-keys ip \
  --rate-limit-action log \
  --yes

# ── 3. Rate limit DURO del export de leads (PII) ────────────────────────────
vercel firewall rules add "Rate limit leads export" \
  --condition '{"type":"path","op":"pre","value":"/api/admin/leads/export"}' \
  --action rate_limit \
  --rate-limit-window 300 \
  --rate-limit-requests 10 \
  --rate-limit-keys ip \
  --rate-limit-action log \
  --yes

# ── 4. Crawlers de IA / entrenamiento de modelos → challenge ────────────────
#     Política del equipo: no se permiten. En producción pasar a `deny`.
vercel firewall rules add "Block AI crawlers" \
  --condition '{"type":"user_agent","op":"re","value":"(?i)(GPTBot|OAI-SearchBot|ChatGPT-User|CCBot|ClaudeBot|Claude-Web|anthropic-ai|Google-Extended|PerplexityBot|Amazonbot|Bytespider|Diffbot|ImagesiftBot|meta-externalagent|Applebot-Extended|PetalBot|AI2Bot|DataForSeoBot|SemrushBot|AhrefsBot|MJ12bot)"}' \
  --action log --yes

# ── 5. Herramientas de scripting / scanners ofensivos → challenge ───────────
vercel firewall rules add "Challenge scripting tools" \
  --condition '{"type":"user_agent","op":"re","value":"(?i)(sqlmap|nikto|nmap|masscan|nuclei|dirbuster|gobuster|wpscan|acunetix|curl/|wget/|python-requests|python-urllib|go-http-client|scrapy|httrack|phantomjs|headless)"}' \
  --action log --yes

# ── 6. Métodos peligrosos contra la API ────────────────────────────────────
vercel firewall rules add "Deny odd methods on api" \
  --condition '{"type":"path","op":"pre","value":"/api/"}' \
  --condition '{"type":"method","op":"inc","value":["PUT","DELETE","TRACE","CONNECT","PATCH"]}' \
  --action log --yes

echo
echo "==> Listo. Reglas creadas en modo LOG (no bloquean)."
echo "    Revisar:   vercel firewall diff"
echo "    Publicar:  vercel firewall publish --yes"
echo "    Tráfico:   https://vercel.com/<team>/<project>/firewall/traffic"
echo
echo "    En emergencia (ataque activo, requiere TTY):"
echo "      vercel firewall attack-mode enable --duration 1h"
