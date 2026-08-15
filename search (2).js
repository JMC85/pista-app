// Vercel Serverless Function: hace las llamadas a YouTube con la clave guardada en el servidor.

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const q = (req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({ error: 'Falta el parámetro de búsqueda.' });
    }

    const API_KEY = process.env.YOUTUBE_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'El servidor no tiene configurada la clave de YouTube.' });
    }

    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=relevance&maxResults=25&relevanceLanguage=es&q=${encodeURIComponent(q)}&key=${API_KEY}`;
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
      return res.status(200).json({ totalResults: 0, videos: [] });
    }

    const ids = items.map(it => it.id.videoId).join(',');
    const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${ids}&key=${API_KEY}`;
    const statsRes = await fetch(statsUrl);
    const statsData = await statsRes.json();

    if (statsData.error) {
      return res.status(500).json({ error: statsData.error.message });
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

    return res.status(200).json({
      totalResults: searchData.pageInfo?.totalResults || items.length,
      videos
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
