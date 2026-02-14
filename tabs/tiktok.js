
function isTikTokDomain(host) {
  if (!host) return false;
  return host === 'tiktok.com' || host === 'www.tiktok.com' ||
    host.endsWith('.tiktok.com');
}

function parseTikTokItemList(responseBody) {
  const items = [];
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const list = data?.itemList || data?.items || [];
    if (!Array.isArray(list)) return items;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      items.push(item);
    }
  } catch (_) {}
  return items;
}
function parseTikTokUserList(responseBody) {
  const list = [];
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const arr = data?.userList;
    if (!Array.isArray(arr)) return list;
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object' || !entry.user) continue;
      list.push(entry);
    }
  } catch (_) {}
  return list;
}

function normalizeTikTokAuthor(author, authorStats, authorStatsV2) {
  if (!author || typeof author !== 'object') return null;
  const stats = authorStats || authorStatsV2 || {};
  return {
    id: author.id || '',
    secUid: author.secUid || '',
    uniqueId: author.uniqueId || '',
    nickname: author.nickname || '',
    signature: (author.signature || '').trim(),
    avatarThumb: author.avatarThumb || '',
    avatarMedium: author.avatarMedium || '',
    avatarLarger: author.avatarLarger || '',
    verified: author.verified === true,
    privateAccount: author.privateAccount === true,
    followerCount: stats.followerCount != null ? Number(stats.followerCount) : 0,
    followingCount: stats.followingCount != null ? Number(stats.followingCount) : 0,
    heartCount: stats.heartCount != null ? Number(stats.heartCount) : (stats.heart != null ? Number(stats.heart) : 0),
    videoCount: stats.videoCount != null ? Number(stats.videoCount) : 0,
    diggCount: stats.diggCount != null ? Number(stats.diggCount) : 0,
  };
}

function normalizeTikTokVideo(item) {
  if (!item || typeof item !== 'object') return null;
  const author = normalizeTikTokAuthor(item.author, item.authorStats, item.authorStatsV2);
  const stats = item.stats || item.statsV2 || {};
  const video = item.video || {};
  const music = item.music || {};
  const challenges = Array.isArray(item.challenges) ? item.challenges : [];
  const hashtags = (item.textExtra || [])
    .filter(t => t.hashtagName)
    .map(t => '#' + t.hashtagName);
  const desc = (item.desc || '').trim();
  const createTime = item.createTime != null ? item.createTime : 0;
  const videoId = item.id || item.aweme_id || '';
  const playAddr = video.playAddr || video.PlayAddrStruct?.UrlList?.[0] || '';
  const cover = video.cover || video.originCover || '';
  const claInfo = video.claInfo || {};
  const captionInfos = claInfo.captionInfos || [];
  const subtitleInfos = video.subtitleInfos || [];
  let captionUrl = '';
  let captionLanguage = '';
  if (Array.isArray(subtitleInfos) && subtitleInfos.length > 0 && subtitleInfos[0].Url) {
    captionUrl = subtitleInfos[0].Url;
    captionLanguage = subtitleInfos[0].LanguageCodeName || '';
  } else if (Array.isArray(captionInfos) && captionInfos.length > 0) {
    const first = captionInfos[0];
    captionUrl = first.url || (Array.isArray(first.urlList) && first.urlList[0]) || '';
    captionLanguage = first.language || first.languageCodeName || '';
  }
  return {
    id: videoId,
    desc,
    createTime,
    author,
    playCount: stats.playCount != null ? Number(stats.playCount) : 0,
    diggCount: stats.diggCount != null ? Number(stats.diggCount) : 0,
    commentCount: stats.commentCount != null ? Number(stats.commentCount) : 0,
    shareCount: stats.shareCount != null ? Number(stats.shareCount) : 0,
    collectCount: stats.collectCount != null ? Number(stats.collectCount) : 0,
    repostCount: stats.repostCount != null ? Number(stats.repostCount) : 0,
    playAddr,
    cover,
    duration: video.duration != null ? video.duration : 0,
    width: video.width,
    height: video.height,
    musicId: music.id || '',
    musicTitle: music.title || '',
    musicAuthor: music.authorName || '',
    musicDuration: music.duration,
    musicPlayUrl: music.playUrl || '',
    captionUrl,
    captionLanguage,
    challenges,
    hashtags,
    _raw: item,
  };
}

function normalizeTikTokChallenge(challenge) {
  if (!challenge || typeof challenge !== 'object') return null;
  return {
    id: challenge.id || '',
    title: challenge.title || '',
    desc: (challenge.desc || '').trim(),
    coverThumb: challenge.coverThumb || '',
    profileThumb: challenge.profileThumb || '',
  };
}

function normalizeTikTokMusic(music) {
  if (!music || typeof music !== 'object' || !music.id) return null;
  return {
    id: music.id,
    title: music.title || '',
    authorName: music.authorName || '',
    duration: music.duration,
    playUrl: music.playUrl || '',
    coverThumb: music.coverThumb || '',
    coverMedium: music.coverMedium || '',
    coverLarge: music.coverLarge || '',
    original: music.original === true,
    isCopyrighted: music.isCopyrighted === true,
  };
}

function aggregateTikTokVideosFromRequests(requests) {
  const seen = new Set();
  const out = [];
  for (const req of requests) {
    if (!req.responseBody) continue;
    const items = parseTikTokItemList(req.responseBody);
    for (const item of items) {
      const v = normalizeTikTokVideo(item);
      if (!v || !v.id) continue;
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push(v);
    }
  }
  return out;
}

function aggregateTikTokAuthorsFromRequests(requests) {
  const seen = new Set();
  const out = [];
  for (const req of requests) {
    if (!req.responseBody) continue;
    const items = parseTikTokItemList(req.responseBody);
    for (const item of items) {
      const a = normalizeTikTokAuthor(item.author, item.authorStats, item.authorStatsV2);
      if (!a || !a.id) continue;
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
    const userList = parseTikTokUserList(req.responseBody);
    for (const entry of userList) {
      const a = normalizeTikTokAuthor(entry.user, entry.stats, entry.statsV2);
      if (!a || !a.id) continue;
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}

function aggregateTikTokChallengesFromRequests(requests) {
  const seen = new Set();
  const out = [];
  for (const req of requests) {
    if (!req.responseBody) continue;
    const items = parseTikTokItemList(req.responseBody);
    for (const item of items) {
      const challenges = Array.isArray(item.challenges) ? item.challenges : [];
      for (const c of challenges) {
        const ch = normalizeTikTokChallenge(c);
        if (!ch || !ch.id) continue;
        if (seen.has(ch.id)) continue;
        seen.add(ch.id);
        out.push(ch);
      }
    }
  }
  return out;
}

function aggregateTikTokMusicFromRequests(requests) {
  const seen = new Set();
  const out = [];
  for (const req of requests) {
    if (!req.responseBody) continue;
    const items = parseTikTokItemList(req.responseBody);
    for (const item of items) {
      const m = normalizeTikTokMusic(item.music);
      if (!m) continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

function parseTikTokExtraMeta(responseBody) {
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const extra = data?.extra || {};
    return {
      logid: extra.logid || '',
      now: extra.now,
      hasMore: data?.hasMore === true,
      statusCode: data?.statusCode ?? data?.status_code,
      statusMsg: data?.status_msg || data?.statusMsg || '',
    };
  } catch (_) { return {}; }
}

function buildTikTokDropdownSection(title, contentHtml, defaultOpen = true) {
  const openClass = defaultOpen ? ' open' : '';
  return `<div class="tiktok-panel-dropdown${openClass}">
    <div class="tiktok-panel-dropdown-header">${escapeHtml(title)}<span class="tiktok-panel-dropdown-chevron">▼</span></div>
    <div class="tiktok-panel-dropdown-content">${contentHtml}</div>
  </div>`;
}

async function downloadFile(url, filename) {
  if (url.includes('.m3u8')) {
    return downloadHlsStream(url, filename);
  }
  try {
    const res = await fetch(url, { method: 'GET', credentials: 'omit' });
    if (!res.ok) throw new Error('Failed to fetch file');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'download';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('Download failed:', err);
    window.open(url, '_blank', 'noopener');
  }
}

async function downloadHlsStream(m3u8Url, filename) {
  try {
    console.log('Starting HLS download:', m3u8Url);
    const response = await fetch(m3u8Url);
    if (!response.ok) throw new Error('Failed to fetch manifest');
    const manifest = await response.text();
    
    const lines = manifest.split('\n');
    const segments = [];
    let initSegmentUrl = null;
    const baseUrl = m3u8Url.substring(0, m3u8Url.lastIndexOf('/') + 1);
    if (manifest.includes('#EXT-X-STREAM-INF')) {
      console.log('Master playlist detected, finding first quality...');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('#')) {
          const subUrl = line.startsWith('http') ? line : baseUrl + line;
          return downloadHlsStream(subUrl, filename);
        }
      }
    }

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      if (line.startsWith('#EXT-X-MAP:URI=')) {
        let uri = line.match(/URI="([^"]+)"/)?.[1];
        if (uri) {
          initSegmentUrl = uri.startsWith('http') ? uri : baseUrl + uri;
        }
      } else if (!line.startsWith('#')) {
        segments.push(line.startsWith('http') ? line : baseUrl + line);
      }
    }

    if (segments.length === 0) throw new Error('No segments found in manifest');

    const chunks = [];
    if (initSegmentUrl) {
      console.log('Downloading initialization segment...');
      const initRes = await fetch(initSegmentUrl);
      if (initRes.ok) {
        chunks.push(await initRes.arrayBuffer());
      }
    }

    console.log(`Downloading ${segments.length} segments...`);
    for (let i = 0; i < segments.length; i++) {
      const segRes = await fetch(segments[i]);
      if (!segRes.ok) {
        console.warn(`Failed to fetch segment ${i}, skipping...`);
        continue;
      }
      chunks.push(await segRes.arrayBuffer());
      
      if (i % 20 === 0 || i === segments.length - 1) {
        console.log(`Progress: ${Math.round((i + 1) / segments.length * 100)}%`);
      }
    }

    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    let type = 'audio/mpeg';
    let ext = 'mp3';
    const firstChunk = new Uint8Array(chunks[0].slice(0, 20));
    const header = Array.from(firstChunk).map(b => String.fromCharCode(b)).join('');
    if (header.includes('ftyp') || initSegmentUrl) {
      type = 'audio/mp4';
      ext = 'm4a';
    } else if (header.includes('ID3')) {
      type = 'audio/mpeg';
      ext = 'mp3';
    } else {
      type = 'video/mp2t';
      ext = 'ts';
    }

    const finalFilename = filename ? (filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) + '.' + ext : filename + '.' + ext) : 'download.' + ext;
    const blob = new Blob([combined], { type: type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log('HLS download complete:', finalFilename);
  } catch (err) {
    console.error('HLS download failed:', err);
    alert('Failed to download stream: ' + err.message);
  }
}

async function downloadTikTokCaptionsAsTxt(captionUrl, videoId) {
  try {
    const res = await fetch(captionUrl, {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: '*/*', Referer: 'https://www.tiktok.com/' },
    });
    if (!res.ok) throw new Error('Failed to fetch captions');
    const text = await res.text();
    const filename = `captions-${videoId || 'video'}.txt`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Download captions failed:', err);
    alert('Could not download captions. The link may have expired or be blocked.');
  }
}

function buildTikTokVideoListHtml(videos) {
  const linkStyle = 'font-size:11px;color:var(--blue);margin-right:8px;';
  const listHtml = videos.map(v => {
    const authorName = v.author ? escapeHtml(v.author.nickname || v.author.uniqueId || '') : '';
    const descSnippet = v.desc ? escapeHtml(v.desc.length > 120 ? v.desc.slice(0, 120) + '…' : v.desc) : '';
    const metrics = [];
    if (v.playCount > 0) metrics.push(`${formatTikTokNum(v.playCount)} plays`);
    if (v.diggCount > 0) metrics.push(`${formatTikTokNum(v.diggCount)} likes`);
    if (v.commentCount > 0) metrics.push(`${formatTikTokNum(v.commentCount)} comments`);
    if (v.shareCount > 0) metrics.push(`${formatTikTokNum(v.shareCount)} shares`);
    const metricsHtml = metrics.length ? `<div class="tiktok-video-metrics">${metrics.join(' · ')}</div>` : '';
    const links = [];
    if (v.playAddr) {
      links.push(`<a href="${escapeHtml(v.playAddr)}" target="_blank" rel="noopener" style="${linkStyle}">Download video</a>`);
    }
    if (v.musicPlayUrl) {
      links.push(`<a href="${escapeHtml(v.musicPlayUrl)}" target="_blank" rel="noopener" style="${linkStyle}">Download audio</a>`);
    }
    if (v.captionUrl) links.push(`<a href="#" class="tiktok-download-captions" data-caption-url="${escapeHtml(v.captionUrl)}" data-video-id="${escapeHtml(v.id)}" style="${linkStyle}">Download captions</a>`);
    const linksHtml = links.length ? `<div class="tiktok-video-links">${links.join('')}</div>` : '';
    const thumbHtml = v.cover
      ? `<img class="tiktok-video-thumb" src="${escapeHtml(v.cover)}" alt="" loading="lazy">`
      : `<div class="tiktok-video-thumb-placeholder">no preview</div>`;
    return `<li class="tiktok-video-item">
      <div class="tiktok-video-thumb-wrap">${thumbHtml}</div>
      <div class="tiktok-video-body">
        <div class="tiktok-video-author">${authorName}</div>
        ${descSnippet ? `<div class="tiktok-video-desc">${descSnippet}</div>` : ''}
        ${metricsHtml}
        ${linksHtml}
      </div>
    </li>`;
  }).join('');
  return `<ul class="tiktok-video-list">${listHtml}</ul>`;
}

function formatTikTokNum(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function buildTikTokAuthorListHtml(authors) {
  const listHtml = authors.map(a => {
    const avatarHtml = a.avatarThumb
      ? `<img class="tiktok-author-avatar" src="${escapeHtml(a.avatarThumb)}" alt="">`
      : `<div class="tiktok-author-avatar-placeholder">@</div>`;
    const verifiedBadge = a.verified ? ' ✓' : '';
    const stats = [];
    if (a.followerCount > 0) stats.push(`${formatTikTokNum(a.followerCount)} followers`);
    if (a.followingCount > 0) stats.push(`${formatTikTokNum(a.followingCount)} following`);
    if (a.heartCount > 0) stats.push(`${formatTikTokNum(a.heartCount)} likes`);
    if (a.videoCount > 0) stats.push(`${formatTikTokNum(a.videoCount)} videos`);
    if (a.diggCount > 0) stats.push(`${formatTikTokNum(a.diggCount)} liked`);
    const statsHtml = stats.length ? `<div class="tiktok-author-stats">${stats.join(' · ')}</div>` : '';
    const profileUrl = a.uniqueId ? `https://www.tiktok.com/@${escapeHtml(a.uniqueId)}` : '';
    const linkHtml = profileUrl ? `<a href="${profileUrl}" target="_blank" rel="noopener" style="font-size:11px;color:var(--blue);">Profile</a>` : '';
    return `<li class="tiktok-author-item">
      ${avatarHtml}
      <div style="flex:1;min-width:0;">
        <div class="tiktok-author-name">${escapeHtml(a.nickname || a.uniqueId || '')}${verifiedBadge}</div>
        <div class="tiktok-author-handle">@${escapeHtml(a.uniqueId || '')}</div>
        ${a.signature ? `<div class="tiktok-video-desc">${escapeHtml(a.signature.length > 80 ? a.signature.slice(0, 80) + '…' : a.signature)}</div>` : ''}
        ${statsHtml}
        ${linkHtml}
      </div>
    </li>`;
  }).join('');
  return `<ul class="tiktok-author-list">${listHtml}</ul>`;
}

function buildTikTokChallengeListHtml(challenges) {
  const listHtml = challenges.map(c => {
    const title = escapeHtml(c.title || '');
    const descHtml = c.desc ? `<div class="tiktok-challenge-desc">${escapeHtml(c.desc.length > 100 ? c.desc.slice(0, 100) + '…' : c.desc)}</div>` : '';
    const link = c.id ? `https://www.tiktok.com/tag/${encodeURIComponent(c.title || c.id)}` : '';
    const linkHtml = link ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" style="font-size:11px;color:var(--blue);">#${title}</a>` : `#${title}`;
    return `<li class="tiktok-challenge-item">
      <div class="tiktok-challenge-title">${linkHtml}</div>
      ${descHtml}
    </li>`;
  }).join('');
  return `<ul class="tiktok-challenge-list">${listHtml}</ul>`;
}

function buildTikTokMusicListHtml(musicList) {
  const linkStyle = 'font-size:11px;color:var(--blue);margin-right:8px;';
  const listHtml = musicList.map(m => {
    const title = escapeHtml(m.title || '');
    const author = escapeHtml(m.authorName || '');
    const meta = [];
    if (m.duration) meta.push(`${m.duration}s`);
    if (m.original) meta.push('Original');
    const metaHtml = meta.length ? `<div class="tiktok-music-meta">${meta.join(' · ')}</div>` : '';
    const links = [];
    if (m.playUrl) links.push(`<a href="${escapeHtml(m.playUrl)}" target="_blank" rel="noopener" style="${linkStyle}">Download audio</a>`);
    const linkHtml = links.length ? `<div class="tiktok-video-links">${links.join('')}</div>` : '';
    return `<li class="tiktok-music-item">
      <div class="tiktok-music-title">${title}</div>
      <div class="tiktok-music-meta">${author}</div>
      ${metaHtml}
      ${linkHtml}
    </li>`;
  }).join('');
  return `<ul class="tiktok-music-list">${listHtml}</ul>`;
}

function renderTikTokTab(requests) {
  const container = document.getElementById('requestsContainer');

  const tiktokRequests = requests.filter(req => {
    if (!activeTabDomain || !isTikTokDomain(activeTabDomain)) return false;
    if (req.initiator) {
      try { if (isTikTokDomain(new URL(req.initiator).hostname)) return true; } catch {}
    }
    try { if (isTikTokDomain(new URL(req.url).hostname)) return true; } catch {}
    return false;
  });

  const videos = aggregateTikTokVideosFromRequests(tiktokRequests);
  const authors = aggregateTikTokAuthorsFromRequests(tiktokRequests);
  const challenges = aggregateTikTokChallengesFromRequests(tiktokRequests);
  const musicList = aggregateTikTokMusicFromRequests(tiktokRequests);
  const extraList = [];
  tiktokRequests.forEach(req => {
    if (!req.responseBody) return;
    const meta = parseTikTokExtraMeta(req.responseBody);
    if (meta.logid || meta.now) extraList.push(meta);
  });

  const signature = [
    videos.map(v => v.id).join(','),
    authors.map(a => a.id).join(','),
    challenges.map(c => c.id).join(','),
    musicList.map(m => m.id).join(','),
  ].join(';');
  if (signature === lastTikTokDataSignature) return;
  lastTikTokDataSignature = signature;

  const onTikTok = isTikTokDomain(activeTabDomain);
  if (videos.length === 0 && authors.length === 0 && challenges.length === 0 && musicList.length === 0) {
    container.innerHTML = `
      <div class="tiktok-panel">
        <div class="tiktok-empty">
          ${onTikTok
            ? 'No TikTok data captured yet.<br>Scroll the For You feed or open a profile to capture item_list API data.'
            : 'Open a TikTok page (tiktok.com) in this tab, then scroll or refresh to capture data.'}
        </div>
      </div>`;
    return;
  }

  const emptySection = (msg) => `<div class="tiktok-empty-section">${escapeHtml(msg)}</div>`;
  let sectionsHtml =
    buildTikTokDropdownSection('Videos', videos.length ? buildTikTokVideoListHtml(videos) : emptySection('No videos captured.')) +
    buildTikTokDropdownSection('Creators', authors.length ? buildTikTokAuthorListHtml(authors) : emptySection('No creators captured.')) +
    buildTikTokDropdownSection('Hashtags / Challenges', challenges.length ? buildTikTokChallengeListHtml(challenges) : emptySection('No hashtags captured.')) +
    buildTikTokDropdownSection('Sounds / Music', musicList.length ? buildTikTokMusicListHtml(musicList) : emptySection('No sounds captured.'));
  if (extraList.length > 0) {
    const metaHtml = extraList.slice(0, 3).map(m => {
      const parts = [];
      if (m.logid) parts.push(`logid: ${escapeHtml(m.logid)}`);
      if (m.now) parts.push(`now: ${m.now}`);
      if (m.hasMore != null) parts.push(`hasMore: ${m.hasMore}`);
      if (m.statusCode != null) parts.push(`statusCode: ${m.statusCode}`);
      return parts.length ? `<div class="tiktok-meta-row">${parts.join(' · ')}</div>` : '';
    }).filter(Boolean).join('');
    if (metaHtml) {
      sectionsHtml += buildTikTokDropdownSection('Session / Meta', `<div class="tiktok-empty-section">${metaHtml}</div>`, false);
    }
  }

  container.innerHTML = `<div class="tiktok-panel">${sectionsHtml}</div>`;

  container.querySelectorAll('.tiktok-panel-dropdown').forEach(el => {
    const header = el.querySelector('.tiktok-panel-dropdown-header');
    if (header) {
      header.addEventListener('click', () => {
        el.classList.toggle('open');
      });
    }
  });

  container.querySelectorAll('.tiktok-force-download').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const url = el.getAttribute('data-url');
      const filename = el.getAttribute('data-filename');
      if (url) downloadFile(url, filename);
    });
  });
}

