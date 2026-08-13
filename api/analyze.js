export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Falta el link del video.' });

    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
    if (!match) return res.status(400).json({ error: 'Link de YouTube inválido.' });
    const videoId = match[1];

    const YT_KEY = process.env.YOUTUBE_API_KEY;
    const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;

    if (!YT_KEY) return res.status(500).json({ error: 'Falta YOUTUBE_API_KEY' });
    if (!CLAUDE_KEY) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY' });

    // Datos del video
    const ytRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${YT_KEY}`);
    const ytData = await ytRes.json();
    
    if (!ytData.items || ytData.items.length === 0) {
      return res.status(404).json({ error: 'Video no encontrado.' });
    }

    const video = ytData.items[0];
    const snippet = video.snippet;
    const stats = video.statistics;

    const prompt = `Sos un experto en YouTube SEO y crecimiento de canales. Analizá este video y dame un reporte claro, útil y accionable en español:

Título: ${snippet.title}
Canal: ${snippet.channelTitle}
Descripción: ${(snippet.description || 'Sin descripción').substring(0, 1200)}
Tags: ${(snippet.tags || []).join(', ') || 'Sin tags'}
Vistas: ${stats.viewCount || 0}
Likes: ${stats.likeCount || 0}
Comentarios: ${stats.commentCount || 0}
Fecha de publicación: ${snippet.publishedAt}

Respondé usando exactamente este formato en markdown:

### Resumen rápido
(2-3 oraciones sobre el performance general)

### Fortalezas
- punto 1
- punto 2

### Debilidades / Oportunidades de mejora
- punto 1
- punto 2

### Título sugerido mejorado
(un título más atractivo y con mejor potencial de CTR)

### Tags recomendados
tag1, tag2, tag3, tag4, tag5, tag6, tag7, tag8

### Próximos pasos recomendados
1. ...
2. ...
3. ...`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const claudeData = await claudeRes.json();
    
    if (claudeData.error) {
      return res.status(500).json({ error: claudeData.error.message || 'Error de Claude' });
    }

    const analysis = claudeData.content?.[0]?.text || 'No se pudo generar el análisis.';

    return res.status(200).json({
      title: snippet.title,
      channel: snippet.channelTitle,
      views: stats.viewCount || 0,
      analysis
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
