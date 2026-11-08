// api/_rateLimit.js
// Límite diario por IP usando Vercel KV / Upstash.

const DAILY_LIMIT = 8;

async function checkAndIncrement(req) {
  // Acceso premium mediante código privado del servidor.
  const providedCode = req.headers['x-pista-code'];
  const realCode = process.env.PREMIUM_CODE;

  if (realCode && providedCode && providedCode === realCode) {
    return {
      allowed: true,
      remaining: null,
      premium: true
    };
  }

  // Preview usa una base Redis independiente para no compartir el contador
  // con Production. Si faltan sus credenciales, se mantiene el modo fail-open.
  const isPreview = process.env.VERCEL_ENV === 'preview';
  const url = isPreview
    ? process.env.PISTA_PREVIEW_REDIS_URL
    : process.env.KV_REST_API_URL;
  const token = isPreview
    ? process.env.PISTA_PREVIEW_REDIS_TOKEN
    : process.env.KV_REST_API_TOKEN;

  // Si KV no está configurado, no bloqueamos la aplicación.
  if (!url || !token) {
    return {
      allowed: true,
      remaining: null,
      premium: false
    };
  }

  const ip = (req.headers['x-forwarded-for'] || 'desconocido')
    .split(',')[0]
    .trim();

  const today = new Date().toISOString().slice(0, 10);
  const key = `pista:${today}:${ip}`;

  const incrRes = await fetch(`${url}/incr/${key}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!incrRes.ok) {
    throw new Error('Error al consultar el límite de búsquedas.');
  }

  const incrData = await incrRes.json();
  const count = incrData.result;

  if (typeof count !== 'number') {
    throw new Error('Respuesta inválida del contador de búsquedas.');
  }

  if (count === 1) {
    const expireRes = await fetch(`${url}/expire/${key}/93600`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!expireRes.ok) {
      throw new Error('Error al configurar el vencimiento del contador.');
    }
  }

  return {
    allowed: count <= DAILY_LIMIT,
    remaining: Math.max(DAILY_LIMIT - count, 0),
    premium: false
  };
}

module.exports = {
  checkAndIncrement,
  DAILY_LIMIT
};
