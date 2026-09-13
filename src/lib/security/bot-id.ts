import 'server-only';
import { classifyUserAgent } from './bot-signatures';

// ── Bot Detection (Vercel BotID + Application-Layer Fallback) ─────────────────
// Si Vercel BotID está disponible (plan Pro+), usa su header.
// Si no, aplica heurísticas application-layer.
// La seguridad NO depende de un único control.

export interface BotCheckResult {
  isBot: boolean;
  score: number; // 0 = humano, 1 = bot
  reason?: string;
  source: 'vercel-botid' | 'application-layer' | 'unknown';
}

/**
 * Verifica si la request proviene de un bot.
 * Primero intenta Vercel BotID, luego heurísticas propias.
 */
export function checkBot(headers: Headers): BotCheckResult {
  // ── Vercel BotID ─────────────────────────────────────────────────────────
  // Header disponible en Vercel Pro+ con Firewall habilitado
  const botScore = headers.get('x-vercel-bot-score');

  if (botScore !== null) {
    const score = parseFloat(botScore);
    const isBot = score > 0.7; // umbral configurable
    return {
      isBot,
      score,
      reason: isBot ? 'vercel_botid_high_score' : undefined,
      source: 'vercel-botid',
    };
  }

  // ── Application-Layer Heuristics ──────────────────────────────────────────
  // Cuando BotID no está disponible. No son controles definitivos — son capas.
  const ua = headers.get('user-agent') ?? '';
  const accept = headers.get('accept') ?? '';
  const acceptLang = headers.get('accept-language');

  let suspicionScore = 0;
  const reasons: string[] = [];

  // Sin User-Agent → muy sospechoso
  if (!ua) {
    suspicionScore += 0.5;
    reasons.push('no_user_agent');
  }

  // Clasificación de User-Agent (listas centralizadas en bot-signatures.ts).
  const uaClass = classifyUserAgent(ua);
  if (uaClass === 'ai-crawler' || uaClass === 'malicious-tool') {
    suspicionScore += 1;
    reasons.push(uaClass.replace('-', '_'));
  } else if (uaClass === 'automation') {
    suspicionScore += 0.5;
    reasons.push('automation_user_agent');
  }

  // Sin Accept-Language → herramienta automatizada típica
  if (!acceptLang) {
    suspicionScore += 0.2;
    reasons.push('no_accept_language');
  }

  // Accept no parece un browser real
  if (!accept.includes('text/html') && !accept.includes('*/*') && !accept.includes('application/json')) {
    suspicionScore += 0.2;
    reasons.push('unusual_accept');
  }

  const isBot = suspicionScore >= 0.7;
  return {
    isBot,
    score: Math.min(1, suspicionScore),
    reason: reasons.length > 0 ? reasons.join(',') : undefined,
    source: 'application-layer',
  };
}
