export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ error: 'Falta el parámetro de búsqueda.' });
    }

    const API_KEY = process.env.YOUTUBE_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'El servidor no tiene configurada la clave de YouTube.' });
    }

    // Buscamos videos ordenados por vistas
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=viewCount&maxResults=50&relevanceLanguage=es&q=${encodeURIComponent(q)}&key=${API_KEY}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (searchData.error) {
      const reason = searchData.error.errors?.[0]?.reason;
      if (reason === 'quotaExceeded') {
        return res.status(429).json({ error: 'Se alcanzó el límite diario de búsquedas gratis. Probá de nuevo mañana.' });
      }
      return res.status(500).json({ error: searchData.error.message });
    }

    const items = searchData.items || [];
    if (items.length === 0) {
      return res.status(200).json({ channels: [] });
    }

    const videoIds = items.map(it => it.id.videoId).join(',');
    const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${API_KEY}`;
    const videosRes = await fetch(videosUrl);
    const videosData = await videosRes.json();

    if (videosData.error) {
      return res.status(500).json({ error: videosData.error.message });
    }

    // Mejor video por canal
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
      return res.status(200).json({ channels: [] });
    }

    const channelsUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelIds.join(',')}&key=${API_KEY}`;
    const channelsRes = await fetch(channelsUrl);
    const channelsData = await channelsRes.json();

    if (channelsData.error) {
      return res.status(500).json({ error: channelsData.error.message });
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

    return res.status(200).json({ channels });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
