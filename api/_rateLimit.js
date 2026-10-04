```js
// api/_rateLimit.js
// Límite real por IP usando Vercel KV / Upstash Redis.

const DAILY_LIMIT = 8;

async function checkAndIncrement(req) {
  // Desbloqueo premium futuro.
  // Solo funciona si PREMIUM_CODE está configurado en Vercel.
  const providedCode = req.headers['x-pista-code'];
  const realCode = process.env.PREMIUM_CODE;

  if (realCode && providedCode && providedCode === realCode) {
    return {
      allowed: true,
      remaining: null,
      premium: true
    };
  }

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  // Si KV todavía no está configurado, dejamos pasar.
  // Esto evita romper la aplicación durante una instalación inicial.
  if (!url || !token) {
    return {
      allowed: true,
      remaining: null,
      premium: false
    };
  }

  try {
    const ip = (
      req.headers['x-forwarded-for'] ||
      'desconocido'
    ).split(',')[0].trim();

    const today = new Date().toISOString().slice(0, 10);
    const key = `pista:${today}:${ip}`;

    // Incrementamos el contador.
    const incrRes = await fetch(`${url}/incr/${key}`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!incrRes.ok) {
      throw new Error(`KV INCR failed with status ${incrRes.status}`);
    }

    const incrData = await incrRes.json();

    if (
      !incrData ||
      typeof incrData.result !== 'number'
    ) {
      throw new Error('Respuesta inválida de KV.');
    }

    const count = incrData.result;

    // El contador expira después de 26 horas.
    // La fecha UTC forma parte de la clave.
    if (count === 1) {
      const expireRes = await fetch(`${url}/expire/${key}/93600`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!expireRes.ok) {
        throw new Error(
          `KV EXPIRE failed with status ${expireRes.status}`
        );
      }
    }

    return {
      allowed: count <= DAILY_LIMIT,
      remaining: Math.max(DAILY_LIMIT - count, 0),
      premium: false
    };
  } catch (err) {
    console.error('Rate limit / KV error:', err.message);

    // Fail-closed:
    // si KV está configurado pero falla, NO permitimos la búsqueda.
    return {
      allowed: false,
      remaining: 0,
      premium: false,
      error: 'rate_limit_unavailable'
    };
  }
}

module.exports = {
  checkAndIncrement,
  DAILY_LIMIT
};
```
