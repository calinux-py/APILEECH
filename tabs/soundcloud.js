
function isSoundCloudDomain(host) {
  if (!host) return false;
  return host === 'soundcloud.com' || host === 'www.soundcloud.com' ||
    host.endsWith('.soundcloud.com');
}
const SOUNDCLOUD_MEDIA_TRACK_RE = /api-v2\.soundcloud\.com\/media\/soundcloud:tracks:(\d+)/;
const SOUNDCLOUD_TRACKS_ID_RE = /api-v2\.soundcloud\.com\/tracks\/(\d+)/;
const SOUNDCLOUD_PLAYBACK_DOMAIN = 'playback.media-streaming.soundcloud.cloud';

function parseSoundCloudStreamResponse(responseBody) {
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const url = data && typeof data.url === 'string' ? data.url.trim() : '';
    if (url && (url.includes('playlist.m3u8') || url.includes('.m3u8') || url.includes('.mp3') || url.includes('.ogg') || url.includes(SOUNDCLOUD_PLAYBACK_DOMAIN) || url.includes('sndcdn.com'))) return url;
    return '';
  } catch (_) { return ''; }
}

function isPlaybackDownloadUrl(url) {
  if (typeof url !== 'string') return false;
  return url.includes(SOUNDCLOUD_PLAYBACK_DOMAIN) || 
         url.includes('cf-media.sndcdn.com') || 
         url.includes('ec-media.sndcdn.com') || 
         url.includes('.m3u8') || 
         url.includes('.mp3');
}
function normalizeSoundCloudTrackObj(obj) {
  if (!obj || (obj.id == null && !obj.title)) return null;
  const id = obj.id != null ? String(obj.id) : '';
  const user = obj.user || {};
  const username = user.username || user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || '';
  let artwork_url = obj.artwork_url || obj.artwork_url_template || '';
  if (artwork_url && artwork_url.includes('{size}')) artwork_url = artwork_url.replace(/\{size\}/g, 't500x500');
  return {
    id,
    title: typeof obj.title === 'string' ? obj.title.trim() : '',
    artist: username,
    avatar_url: user.avatar_url || '',
    artwork_url,
    duration: obj.duration != null ? Number(obj.duration) : 0,
    description: typeof obj.description === 'string' ? obj.description.trim() : '',
    permalink_url: obj.permalink_url || (obj.permalink ? `https://soundcloud.com/${obj.permalink}` : ''),
  };
}
function parseSoundCloudTrackInfo(responseBody) {
  const out = { id: '', title: '', artist: '', avatar_url: '', artwork_url: '', duration: 0, description: '', permalink_url: '' };
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    if (!data) return out;
    const single = normalizeSoundCloudTrackObj(data);
    if (single && single.id) return single;
    const coll = Array.isArray(data.collection) ? data.collection : [];
    for (const item of coll) {
      const t = normalizeSoundCloudTrackObj(item);
      if (t && t.id) return t;
    }
  } catch (_) {}
  return out;
}
function parseSoundCloudTracksFromResponse(responseBody) {
  const byId = new Map();
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    if (!data) return byId;
    const single = normalizeSoundCloudTrackObj(data);
    if (single && single.id) byId.set(single.id, single);
    const coll = Array.isArray(data.collection) ? data.collection : [];
    for (const item of coll) {
      const t = normalizeSoundCloudTrackObj(item);
      if (t && t.id) byId.set(t.id, t);
    }
  } catch (_) {}
  return byId;
}
function parseSoundCloudComments(responseBody) {
  const commentsByTrackId = new Map();
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const coll = data && Array.isArray(data.collection) ? data.collection : [];
    for (const item of coll) {
      if (!item || item.kind !== 'comment' || item.track_id == null) continue;
      const trackId = String(item.track_id);
      const user = item.user || {};
      const comment = {
        body: typeof item.body === 'string' ? item.body : '',
        created_at: item.created_at || '',
        user: {
          avatar_url: user.avatar_url || '',
          username: user.username || user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'User',
        },
      };
      if (!commentsByTrackId.has(trackId)) commentsByTrackId.set(trackId, []);
      commentsByTrackId.get(trackId).push(comment);
    }
  } catch (_) {}
  return commentsByTrackId;
}

function aggregateSoundCloudTracksFromRequests(requests) {
  const byTrackId = new Map();
  for (const req of requests) {
    let trackId = '';
    try {
      let m = req.url.match(SOUNDCLOUD_MEDIA_TRACK_RE);
      if (m) trackId = m[1];
      if (!trackId) {
        m = req.url.match(SOUNDCLOUD_TRACKS_ID_RE);
        if (m) trackId = m[1];
      }
    } catch (_) {}
    if (req.responseBody) {
      const trackMap = parseSoundCloudTracksFromResponse(req.responseBody);
      for (const [tid, info] of trackMap.entries()) {
        if (!byTrackId.has(tid)) byTrackId.set(tid, { trackId: tid, title: '', artist: '', artwork_url: '', avatar_url: '', duration: 0, description: '', permalink_url: '', streamUrl: '', comments: [] });
        const cur = byTrackId.get(tid);
        if (info.title) cur.title = info.title;
        if (info.artist) cur.artist = info.artist;
        if (info.artwork_url) cur.artwork_url = info.artwork_url;
        if (info.avatar_url) cur.avatar_url = info.avatar_url;
        if (info.duration) cur.duration = info.duration;
        if (info.description) cur.description = info.description;
        if (info.permalink_url) cur.permalink_url = info.permalink_url;
        byTrackId.set(tid, cur);
      }
      const commentMap = parseSoundCloudComments(req.responseBody);
      for (const [tid, comments] of commentMap.entries()) {
        if (!byTrackId.has(tid)) byTrackId.set(tid, { trackId: tid, title: '', artist: '', artwork_url: '', avatar_url: '', duration: 0, description: '', permalink_url: '', streamUrl: '', comments: [] });
        const cur = byTrackId.get(tid);
        cur.comments = cur.comments || [];
        for (const c of comments) cur.comments.push(c);
        byTrackId.set(tid, cur);
      }
    }
    if (!trackId && req.responseBody) {
      const info = parseSoundCloudTrackInfo(req.responseBody);
      if (info.id) trackId = info.id;
    }
    if (!trackId) continue;
    const streamUrl = req.responseBody ? parseSoundCloudStreamResponse(req.responseBody) : '';
    const info = req.responseBody ? parseSoundCloudTrackInfo(req.responseBody) : { id: '', title: '' };
    if (!byTrackId.has(trackId)) byTrackId.set(trackId, { trackId, title: '', artist: '', artwork_url: '', avatar_url: '', duration: 0, description: '', permalink_url: '', streamUrl: '', comments: [] });
    const cur = byTrackId.get(trackId);
    cur.comments = cur.comments || [];
    if (info.title) cur.title = info.title;
    if (info.artist) cur.artist = info.artist;
    if (info.artwork_url) cur.artwork_url = info.artwork_url;
    if (info.avatar_url) cur.avatar_url = info.avatar_url;
    if (info.duration) cur.duration = info.duration;
    if (info.description) cur.description = info.description;
    if (info.permalink_url) cur.permalink_url = info.permalink_url;
    if (streamUrl) cur.streamUrl = streamUrl;
    byTrackId.set(trackId, cur);
  }
  return Array.from(byTrackId.values()).filter(t =>
    isPlaybackDownloadUrl(t.streamUrl) || (t.comments && t.comments.length > 0) || t.title || t.artist
  );
}

function formatSoundCloudDuration(ms) {
  if (!ms || ms <= 0) return '';
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function buildSoundCloudTrackListHtml(tracks) {
  const listHtml = tracks.map(t => {
    const displayTitle = t.title || `Track ${t.trackId}`;
    const artworkUrl = t.artwork_url || '';
    const artworkHtml = artworkUrl
      ? `<img class="soundcloud-track-artwork" src="${escapeHtml(artworkUrl)}" alt="" loading="lazy">`
      : `<div class="soundcloud-track-artwork-placeholder">♪</div>`;
    const artistHtml = t.artist ? `<div class="soundcloud-track-artist">${escapeHtml(t.artist)}</div>` : '';
    const durationHtml = t.duration ? `<div class="soundcloud-track-meta">${escapeHtml(formatSoundCloudDuration(t.duration))}</div>` : (t.trackId ? `<div class="soundcloud-track-meta">ID: ${escapeHtml(t.trackId)}</div>` : '');
    const descSnippet = t.description ? (t.description.length > 200 ? t.description.slice(0, 200) + '…' : t.description) : '';
    const descHtml = descSnippet ? `<div class="soundcloud-track-description">${escapeHtml(descSnippet)}</div>` : '';
    const links = [];
    if (t.streamUrl && isPlaybackDownloadUrl(t.streamUrl)) {
      const isHls = t.streamUrl.includes('.m3u8');
      if (isHls) {
        links.push(`<a href="${escapeHtml(t.streamUrl)}" target="_blank" rel="noopener">Open Stream</a>`);
        links.push(`<a href="#" class="soundcloud-force-download" data-url="${escapeHtml(t.streamUrl)}" data-filename="${escapeHtml(displayTitle)}.mp3" style="margin-left:8px;opacity:0.9;font-size:11px;">Download</a>`);
      } else {
        links.push(`<a href="${escapeHtml(t.streamUrl)}" download="${escapeHtml(displayTitle)}.mp3" target="_blank" rel="noopener">Download Audio</a>`);
      }
    }
    if (t.permalink_url) {
      links.push(`<a href="${escapeHtml(t.permalink_url)}" target="_blank" rel="noopener">Play on SoundCloud</a>`);
    }
    const linksHtml = links.length ? `<div class="soundcloud-track-links">${links.join('')}</div>` : '';
    const comments = t.comments || [];
    const commentsHtml = comments.length
      ? `<div class="soundcloud-track-api">
          <div class="soundcloud-comment-list">${comments.map(c => {
            const avatarUrl = (c.user && c.user.avatar_url) ? c.user.avatar_url : '';
            const username = (c.user && c.user.username) ? c.user.username : 'User';
            const avatarHtml = avatarUrl
              ? `<img class="soundcloud-comment-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy">`
              : `<div class="soundcloud-comment-avatar-placeholder">?</div>`;
            return `<li class="soundcloud-comment-item">
              ${avatarHtml}
              <div class="soundcloud-comment-body">
                <div class="soundcloud-comment-user">${escapeHtml(username)}</div>
                <div class="soundcloud-comment-text">${escapeHtml(c.body || '')}</div>
                ${c.created_at ? `<div class="soundcloud-comment-date">${escapeHtml(c.created_at)}</div>` : ''}
              </div>
            </li>`;
          }).join('')}</div>
        </div>`
      : '';
    return `<li class="soundcloud-track-item">
      <div class="soundcloud-track-main">
        <div class="soundcloud-track-artwork-wrap">${artworkHtml}</div>
        <div class="soundcloud-track-info">
          <div class="soundcloud-track-title">${escapeHtml(displayTitle)}</div>
          ${artistHtml}
          ${durationHtml}
          ${descHtml}
          ${linksHtml}
        </div>
      </div>
      ${commentsHtml}
    </li>`;
  }).join('');
  return `<ul class="soundcloud-track-list">${listHtml}</ul>`;
}

function buildSoundCloudDropdownSection(title, contentHtml, openByDefault = true) {
  const openClass = openByDefault ? ' open' : '';
  return `<div class="soundcloud-panel-dropdown${openClass}">
    <div class="soundcloud-panel-dropdown-header">${escapeHtml(title)}<span class="soundcloud-panel-dropdown-chevron">▼</span></div>
    <div class="soundcloud-panel-dropdown-content">${contentHtml}</div>
  </div>`;
}

function renderSoundCloudTab(requests) {
  const container = document.getElementById('requestsContainer');

  const soundcloudRequests = requests.filter(req => {
    if (!activeTabDomain || !isSoundCloudDomain(activeTabDomain)) return false;
    if (req.initiator) {
      try { if (isSoundCloudDomain(new URL(req.initiator).hostname)) return true; } catch {}
    }
    try {
      const u = new URL(req.url);
      const h = u.hostname || '';
      if (h === 'api-v2.soundcloud.com' || h === 'api.soundcloud.com' || h.includes('soundcloud')) return true;
    } catch {}
    return false;
  });

  const tracks = aggregateSoundCloudTracksFromRequests(soundcloudRequests);
  const signature = tracks.map(t => t.trackId + ':' + (t.title || '') + ':' + (t.streamUrl || '') + ':' + ((t.comments && t.comments.length) || 0)).join(',');
  if (signature === lastSoundCloudDataSignature) return;
  lastSoundCloudDataSignature = signature;

  const onSoundCloud = isSoundCloudDomain(activeTabDomain);
  if (tracks.length === 0) {
    container.innerHTML = `
      <div class="soundcloud-panel">
        <div class="soundcloud-empty">
          ${onSoundCloud
            ? 'No SoundCloud streams captured yet.<br>Play a track on soundcloud.com to capture stream links.'
            : 'Open SoundCloud (soundcloud.com) in this tab, then play tracks to capture stream links.'}
        </div>
      </div>`;
    return;
  }

  const emptySection = (msg) => `<div class="soundcloud-empty-section">${escapeHtml(msg)}</div>`;
  const tipHtml = '<div class="soundcloud-tip">Play a track on SoundCloud to capture stream links and show the Download / Open Stream buttons.</div>';
  const sectionsHtml = buildSoundCloudDropdownSection(
    'Songs',
    tracks.length ? buildSoundCloudTrackListHtml(tracks) : emptySection('No tracks with stream URLs.')
  );

  container.innerHTML = `<div class="soundcloud-panel">${tipHtml}${sectionsHtml}</div>`;

  container.querySelectorAll('.soundcloud-panel-dropdown').forEach(el => {
    const header = el.querySelector('.soundcloud-panel-dropdown-header');
    if (header) {
      header.addEventListener('click', () => {
        el.classList.toggle('open');
      });
    }
  });

  container.querySelectorAll('.soundcloud-force-download').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const url = el.getAttribute('data-url');
      const filename = el.getAttribute('data-filename');
      if (url) downloadFile(url, filename);
    });
  });
}

