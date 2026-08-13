export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'Falta el link del video.' });
    }

    // Extraer video ID
    const match = url.match(/(?:v=|\/|youtu\.be\/)([0-9A-Za-z_-]{11})/);
    if (!match) {
      return res.status(400).json({ error: 'Link de YouTube inválido.' });
    }
    const videoId = match[1];

    const API_KEY = process.env.YOUTUBE_API_KEY;
    if (!API_KEY) {
      return res.status(500).json({ error: 'Falta YOUTUBE_API_KEY en el servidor.' });
    }

    // Pedir datos del video
    const ytUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${API_KEY}`;
    const ytRes = await fetch(ytUrl);
    const ytData = await ytRes.json();

    if (ytData.error) {
      return res.status(500).json({ error: ytData.error.message });
    }

    if (!ytData.items || ytData.items.length === 0) {
      return res.status(404).json({ error: 'Video no encontrado.' });
    }

    const video = ytData.items[0];
    const snippet = video.snippet;
    const stats = video.statistics;

    const views = parseInt(stats.viewCount || '0', 10);
    const likes = parseInt(stats.likeCount || '0', 10);
    const comments = parseInt(stats.commentCount || '0', 10);
    const tags = snippet.tags || [];

    // Cálculos simples
    const likeRatio = views > 0 ? ((likes / views) * 100).toFixed(2) : 0;
    const commentRatio = views > 0 ? ((comments / views) * 100).toFixed(3) : 0;

    // Diagnóstico básico
    let engagement = 'Bajo';
    if (likeRatio > 4) engagement = 'Excelente';
    else if (likeRatio > 2.5) engagement = 'Bueno';
    else if (likeRatio > 1.5) engagement = 'Aceptable';

    let tagStatus = tags.length === 0 ? 'Sin tags (malo)' : 
                    tags.length < 5 ? 'Pocos tags' : 
                    tags.length > 15 ? 'Muchos tags' : 'Cantidad razonable de tags';

    return res.status(200).json({
      title: snippet.title,
      channel: snippet.channelTitle,
      publishedAt: snippet.publishedAt,
      description: snippet.description || '',
      thumb: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url,
      views,
      likes,
      comments,
      likeRatio,
      commentRatio,
      engagement,
      tags,
      tagStatus,
      tagCount: tags.length
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
