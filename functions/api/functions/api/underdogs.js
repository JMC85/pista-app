// Cloudflare Pages Function: busca canales "underdog" — pocos suscriptores, vistas altas.
// Es una foto del momento actual, no un histórico.

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

    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=viewCount&maxResults=50&relevanceLanguage=es&q=${encodeURIComponent(q)}&key=${API_KEY}`;
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
      return new Response(JSON.stringify({ channels: [] }), { status: 200, headers });
    }

    const videoIds = items.map(it => it.id.videoId).join(',');
    const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${API_KEY}`;
    const videosRes = await fetch(videosUrl);
    const videosData = await videosRes.json();
    if (videosData.error) {
      return new Response(JSON.stringify({ error: videosData.error.message }), { status: 500, headers });
    }

    const bestVideoByChannel = {};
    videosData.items.forEach(v => {
      const channelId = v.snippet.channelId;
      const views = parseInt(v.statistics.viewCount || '0', 10);
      if (!bestVideoByChannel[channelId] || views > bestVideoByChannel[channelId].views) {
        bestVideoByChannel[channelId] = {
          videoId: v.id,
          title: v.snippet.title,
          views,
          thumb: v.snippet.thumbnails.medium?.url || v.snippet.thumbnails.default.url,
          publishedAt: v.snippet.publishedAt
        };
      }
    });

    const channelIds = Object.keys(bestVideoByChannel);
    if (channelIds.length === 0) {
      return new Response(JSON.stringify({ channels: [] }), { status: 200, headers });
    }

    const channelsUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelIds.join(',')}&key=${API_KEY}`;
    const channelsRes = await fetch(channelsUrl);
    const channelsData = await channelsRes.json();
    if (channelsData.error) {
      return new Response(JSON.stringify({ error: channelsData.error.message }), { status: 500, headers });
    }

    const channels = channelsData.items.map(ch => {
      const subs = ch.statistics.hiddenSubscriberCount ? null : parseInt(ch.statistics.subscriberCount || '0', 10);
      const bestVideo = bestVideoByChannel[ch.id];
      const ratio = subs && subs > 0 ? bestVideo.views / subs : null;
      return {
        channelId: ch.id,
        channelTitle: ch.snippet.title,
        channelThumb: ch.snippet.thumbnails.default?.url,
        subscribers: subs,
        video: bestVideo,
        ratio
      };
    })
    .filter(ch => ch.subscribers !== null && ch.subscribers < 50000 && ch.ratio !== null)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 12);

    return new Response(JSON.stringify({ channels }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
