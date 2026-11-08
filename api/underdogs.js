const { checkAndIncrement } = require('./_rateLimit');

const ALLOWED_ORIGIN = 'https://pista-app-seven.vercel.app';

function setCors(req, res) {
  const origin = req.headers.origin;

  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  }

  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function fetchVideoStats(items, apiKey) {
  const ids = items
    .map(item => item.id?.videoId)
    .filter(Boolean);

  const results = [];

  for (let i = 0; i < ids.length; i += 50) {
    const batchIds = ids.slice(i, i + 50).join(',');
    const url =
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${batchIds}&key=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    results.push(...(data.items || []));
  }

  return results;
}

async function fetchChannelStats(channelIds, apiKey) {
  const results = [];

  for (let i = 0; i < channelIds.length; i += 50) {
    const batchIds = channelIds.slice(i, i + 50).join(',');
    const url =
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${batchIds}&key=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    results.push(...(data.items || []));
  }

  return results;
}

function addVideosToBestByChannel(videoItems, bestVideoByChannel) {
  videoItems.forEach(video => {
    const channelId = video.snippet.channelId;
    const views = parseInt(video.statistics.viewCount || '0', 10);
    const publishedAt = video.snippet.publishedAt;
    const current = bestVideoByChannel[channelId];

    if (!current) {
      bestVideoByChannel[channelId] = {
        videoId: video.id,
        title: video.snippet.title,
        views,
        thumb: video.snippet.thumbnails.medium?.url ||
          video.snippet.thumbnails.default.url,
        publishedAt,
        latestPublishedAt: publishedAt
      };
      return;
    }

    if (new Date(publishedAt) > new Date(current.latestPublishedAt)) {
      current.latestPublishedAt = publishedAt;
    }

    if (views > current.views) {
      current.videoId = video.id;
      current.title = video.snippet.title;
      current.views = views;
      current.thumb = video.snippet.thumbnails.medium?.url ||
        video.snippet.thumbnails.default.url;
      current.publishedAt = publishedAt;
    }
  });
}

function buildChannels(channelItems, bestVideoByChannel) {
  return channelItems
    .map(channel => {
      const subs = channel.statistics.hiddenSubscriberCount
        ? null
        : parseInt(channel.statistics.subscriberCount || '0', 10);

      const video = bestVideoByChannel[channel.id];

      if (!video) return null;

      const ratio =
        subs && subs > 0
          ? video.views / subs
          : null;

      return {
        channelId: channel.id,
        channelTitle: channel.snippet.title,
        channelThumb: channel.snippet.thumbnails.default?.url,
        subscribers: subs,
        video,
        latestPublishedAt: video.latestPublishedAt,
        ratio
      };
    })
    .filter(channel =>
      channel &&
      channel.subscribers !== null &&
      channel.subscribers >= 100 &&
      channel.subscribers < 50000 &&
      channel.ratio !== null &&
      channel.ratio >= 1.0
    )
    .sort((a, b) =>
      new Date(b.latestPublishedAt) - new Date(a.latestPublishedAt)
    )
    .slice(0, 25);
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  try {
    const q = (req.query.q || '').trim();

    if (!q) {
      return res.status(400).json({
        error: 'Falta el parámetro de búsqueda.'
      });
    }

    const limit = await checkAndIncrement(req);

    if (!limit.allowed) {
      return res.status(429).json({
        error: 'Llegaste al límite de 8 búsquedas gratis por hoy. Volvé mañana.'
      });
    }

    const API_KEY = process.env.YOUTUBE_API_KEY;

    if (!API_KEY) {
      return res.status(500).json({
        error: 'El servidor no tiene configurada la clave de YouTube.'
      });
    }

    const publishedAfter = new Date();
    publishedAfter.setUTCFullYear(publishedAfter.getUTCFullYear() - 1);

    const searchUrl =
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=50&publishedAfter=${encodeURIComponent(publishedAfter.toISOString())}&relevanceLanguage=es&q=${encodeURIComponent(q)}&key=${API_KEY}`;

    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (searchData.error) {
      const reason = searchData.error.errors?.[0]?.reason;

      if (reason === 'quotaExceeded') {
        return res.status(429).json({
          error: 'Se alcanzó el límite diario de búsquedas gratis. Probá de nuevo mañana.'
        });
      }

      return res.status(500).json({
        error: searchData.error.message
      });
    }

    const firstPageItems = searchData.items || [];
    const nextPageToken = searchData.nextPageToken || null;

    const bestVideoByChannel = {};
    const firstVideoItems = await fetchVideoStats(firstPageItems, API_KEY);
    addVideosToBestByChannel(firstVideoItems, bestVideoByChannel);

    let channelItems = await fetchChannelStats(
      Object.keys(bestVideoByChannel),
      API_KEY
    );

    let channels = buildChannels(channelItems, bestVideoByChannel);

    // Solo paginamos si la primera página no alcanza los 25 resultados.
    // Así evitamos una llamada search.list adicional cuando ya tenemos
    // suficientes canales válidos.
    if (channels.length < 25 && nextPageToken) {
      const secondSearchUrl =
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=50&publishedAfter=${encodeURIComponent(publishedAfter.toISOString())}&relevanceLanguage=es&q=${encodeURIComponent(q)}&pageToken=${encodeURIComponent(nextPageToken)}&key=${API_KEY}`;

      const secondSearchRes = await fetch(secondSearchUrl);
      const secondSearchData = await secondSearchRes.json();

      // Si falla la segunda página, conservamos los resultados de la primera.
      if (!secondSearchData.error) {
        const secondPageItems = secondSearchData.items || [];
        const secondVideoItems = await fetchVideoStats(secondPageItems, API_KEY);

        const knownChannelIds = new Set(Object.keys(bestVideoByChannel));
        addVideosToBestByChannel(secondVideoItems, bestVideoByChannel);

        const newChannelIds = Object.keys(bestVideoByChannel)
          .filter(id => !knownChannelIds.has(id));

        if (newChannelIds.length > 0) {
          const newChannelItems = await fetchChannelStats(newChannelIds, API_KEY);
          channelItems.push(...newChannelItems);
        }

        channels = buildChannels(channelItems, bestVideoByChannel);
      }
    }

    return res.status(200).json({
      channels,
      remaining: limit.remaining,
      premium: limit.premium
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message
    });
  }
};
