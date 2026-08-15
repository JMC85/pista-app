// Vercel Serverless Function: analiza un video individual de YouTube.

function extractVideoId(url) {
  const patterns = [
    /(?:v=|\/videos\/|embed\/|youtu\.be\/|\/v\/|\/shorts\/)([a-zA-Z0-9_-]{11})/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const url = (req.query.url || '').trim();
    if (!url) {
      return res.status(400).json({ error: 'Falta el link del video.' });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'No se pudo reconocer un link de YouTube válido.' });
    }

    const API_KEY = process.env.YOUTUBE_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'El servidor no tiene configurada la clave de YouTube.' });
    }

    const videoUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${API_KEY}`;
    const videoRes = await fetch(videoUrl);
    const videoData = await videoRes.json();

    if (videoData.error) {
      const reason = videoData.error.errors?.[0]?.reason;
      if (reason === 'quotaExceeded') {
        return res.status(429).json({ error: 'Se alcanzó el límite diario de búsquedas gratis. Probá de nuevo mañana.' });
      }
      return res.status(500).json({ error: videoData.error.message });
    }

    const item = videoData.items?.[0];
    if (!item) {
      return res.status(404).json({ error: 'No se encontró ese video (puede ser privado o no existir).' });
    }

    const views = parseInt(item.statistics.viewCount || '0', 10);
    const likes = parseInt(item.statistics.likeCount || '0', 10);
    const comments = parseInt(item.statistics.commentCount || '0', 10);
    const engagementRate = views > 0 ? (((likes + comments) / views) * 100).toFixed(2) : '0.00';

    return res.status(200).json({
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      views,
      likes,
      comments,
      engagementRate,
      tags: item.snippet.tags || []
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
