/ Cloudflare Pages Function: hace las llamadas a YouTube con la clave guardada en el servidor.
// El navegador del usuario nunca ve esta clave.

export async function onRequestGet(context) {
  const { request, env } = context;
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') || '').trim();
    if (!q) {
      return new Response(JSON.stringify({ error: 'Falta el parámetro de búsqueda.' }), { status: 400, headers });
    }

    const API_KEY = env.YOUTUBE_API_KEY;
    if (!API_KEY) {
      return new Response(JSON.stringify({ error: 'El servidor no tiene configurada la clave de YouTube.' }), { status: 500, headers });
    }

    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=relevance&maxResults=25&relevanceLanguage=es&q=${encodeURIComponent(q)}&key=${API_KEY}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (searchData.error) {
      const reason = searchData.error.errors?.[0]?.reason;
      if (reason === 'quotaExceeded') {
        return new Response(JSON.stringify({ error: 'Se alcanzó el límite diario de búsquedas gratis. Probá de nuevo mañana.' }), { status: 429, headers });
      }
      return new Response(JSON.stringify({ error: searchData.error.message }), { status: 500, headers });
    }

    const items = searchData.items || [];
    if (items.length === 0) {
      return new Response(JSON.stringify({ totalResults: 0, videos: [] }), { status: 200, headers });
    }

    const ids = items.map(it => it.id.videoId).join(',');
    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids}&key=${API_KEY}`;
    const statsRes = await fetch(statsUrl);
    const statsData = await statsRes.json();

    if (statsData.error) {
      return new Response(JSON.stringify({ error: statsData.error.message }), { status: 500, headers });
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

    return new Response(JSON.stringify({
      totalResults: searchData.pageInfo?.totalResults || items.length,
      videos
    }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
