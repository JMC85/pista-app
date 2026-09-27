// api/_rateLimit.js
// Límite real por IP (no por navegador) usando Vercel KV, con desbloqueo premium por código.

const DAILY_LIMIT = 8;

async function checkAndIncrement(req) {
  // Desbloqueo premium: si viene el código correcto, no contamos ni limitamos.
  const providedCode = req.headers['x-pista-code'];
  const realCode = process.env.PREMIUM_CODE;
  if (realCode && providedCode && providedCode === realCode) {
    return { allowed: true, remaining: null, premium: true };
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  // Si todavía no conectaste la base de datos KV, no bloqueamos nada
  // (mejor dejar pasar que romper la app entera).
  if (!url || !token) {
    return { allowed: true, remaining: null, premium: false };
  }

  const ip = (req.headers['x-forwarded-for'] || 'desconocido').split(',')[0].trim();
  const today = new Date().toISOString().slice(0, 10);
  const key = `pista:${today}:${ip}`;

  const incrRes = await fetch(`${url}/incr/${key}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const incrData = await incrRes.json();
  const count = incrData.result;

  if (count === 1) {
    await fetch(`${url}/expire/${key}/93600`, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  return {
    allowed: count <= DAILY_LIMIT,
    remaining: Math.max(DAILY_LIMIT - count, 0),
    premium: false
  };
}

module.exports = { checkAndIncrement, DAILY_LIMIT };
