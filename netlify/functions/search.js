// Netlify Function: hace las llamadas a YouTube con la clave guardada en el servidor.
// El navegador del usuario nunca ve esta clave.

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const q = (event.queryStringParameters && event.queryStringParameters.q || '').trim();
    if (!q) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Falta el parámetro de búsqueda.' }) };
    }

    const API_KEY = process.env.YOUTUBE_API_KEY;
    if (!API_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'El servidor no tiene configurada la clave de YouTube.' }) };
    }

    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=relevance&maxResults=25&relevanceLanguage=es&q=${encodeURIComponent(q)}&key=${API_KEY}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (searchData.error) {
      const reason = searchData.error.errors?.[0]?.reason;
      if (reason === 'quotaExceeded') {
        return { statusCode: 429, headers, body: JSON.stringify({ error: 'Se alcanzó el límite diario de búsquedas gratis. Probá de nuevo mañana.' }) };
      }
      return { statusCode: 500, headers, body: JSON.stringify({ error: searchData.error.message }) };
    }

    const items = searchData.items || [];
    if (items.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ totalResults: 0, videos: [] }) };
    }

    const ids = items.map(it => it.id.videoId).join(',');
    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids}&key=${API_KEY}`;
    const statsRes = await fetch(statsUrl);
    const statsData = await statsRes.json();

    if (statsData.error) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: statsData.error.message }) };
    }

    const videos = statsData.items.map(v => ({
      id: v.id,
      title: v.snippet.title,
      channel: v.snippet.channelTitle,
      thumb: v.snippet.thumbnails.medium?.url || v.snippet.thumbnails.default.url,
      publishedAt: v.snippet.publishedAt,
      views: parseInt(v.statistics.viewCount || '0', 10),
      tags: v.snippet.tags || []
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        totalResults: searchData.pageInfo?.totalResults || items.length,
        videos
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
