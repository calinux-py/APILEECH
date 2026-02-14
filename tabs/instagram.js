
function isInstagramDomain(host) {
  if (!host) return false;
  return host === 'www.instagram.com' || host === 'instagram.com' || host.endsWith('.instagram.com');
}
function _instagramMediaDedupeKey(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    return new URL(url).pathname || url;
  } catch (_) {
    return url;
  }
}

function _dedupeInstagramUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return urls;
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (!u || typeof u !== 'string') continue;
    const key = _instagramMediaDedupeKey(u);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(u);
    }
  }
  return out;
}
function parseInstagramFeedFromResponse(responseBody) {
  const nodes = [];
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const root = data?.data || data;
    if (!root || typeof root !== 'object') return nodes;

    function collectEdges(obj, depth) {
      if (!obj || depth > 6) return;
      if (Array.isArray(obj)) {
        for (const item of obj) collectEdges(item, depth + 1);
        return;
      }
      if (obj.edges && Array.isArray(obj.edges)) {
        for (const edge of obj.edges) {
          const node = edge?.node;
          if (node && (node.code != null || node.pk != null) && (node.caption != null || node.image_versions2 != null || node.video_versions != null || node.carousel_media != null))
            nodes.push(node);
        }
        return;
      }
      for (const value of Object.values(obj))
        collectEdges(value, depth + 1);
    }
    collectEdges(root, 0);
  } catch (_) {}
  return nodes;
}
function normalizeInstagramNode(node) {
  if (!node) return null;
  const pk = node.pk != null ? String(node.pk) : (node.id && node.id.split('_')[0]) || '';
  if (!pk) return null;

  const user = node.user || {};
  const author = {
    pk: user.pk != null ? String(user.pk) : '',
    id: user.id != null ? String(user.id) : '',
    username: user.username || '',
    full_name: user.full_name || '',
    profile_pic_url: user.hd_profile_pic_url_info?.url || user.profile_pic_url || '',
    is_verified: !!user.is_verified,
  };

  const captionObj = node.caption;
  const caption = captionObj && typeof captionObj.text === 'string' ? captionObj.text : '';
  const captionCreatedAt = captionObj && captionObj.created_at != null ? captionObj.created_at : null;
  const takenAt = node.taken_at != null ? node.taken_at : captionCreatedAt;

  const imageUrls = [];
  const cands = node.image_versions2?.candidates;
  if (Array.isArray(cands)) for (const c of cands) if (c && c.url) imageUrls.push(c.url);
  const videoUrls = [];
  const vv = node.video_versions;
  if (Array.isArray(vv)) for (const v of vv) if (v && v.url) videoUrls.push(v.url);

  const carousel = [];
  const carouselMedia = node.carousel_media;
  if (Array.isArray(carouselMedia)) {
    for (const item of carouselMedia) {
      const carouselItem = { imageUrls: [], videoUrls: [], accessibility_caption: item.accessibility_caption || null };
      const ic = item.image_versions2?.candidates;
      if (Array.isArray(ic)) for (const c of ic) if (c && c.url) carouselItem.imageUrls.push(c.url);
      const iv = item.video_versions;
      if (Array.isArray(iv)) for (const v of iv) if (v && v.url) carouselItem.videoUrls.push(v.url);
      carousel.push(carouselItem);
    }
  }

  const usertags = [];
  const inTags = node.usertags?.in;
  if (Array.isArray(inTags)) {
    for (const t of inTags) {
      const u = t?.user;
      if (u && (u.username || u.pk)) usertags.push({ username: u.username || '', full_name: u.full_name || '', pk: u.pk != null ? String(u.pk) : '', profile_pic_url: u.profile_pic_url || '', is_verified: !!u.is_verified, position: t.position });
    }
  }

  const coauthors = [];
  const coauthorProducers = node.coauthor_producers;
  if (Array.isArray(coauthorProducers)) {
    for (const c of coauthorProducers) {
      if (c && (c.username || c.pk)) coauthors.push({ username: c.username || '', full_name: c.full_name || '', pk: c.pk != null ? String(c.pk) : '', profile_pic_url: c.profile_pic_url || '', is_verified: !!c.is_verified });
    }
  }

  const commentCount = node.comment_count != null ? node.comment_count : null;
  const likeCount = node.like_count != null ? node.like_count : null;
  const viewCount = node.view_count != null ? node.view_count : null;
  const productType = node.product_type || '';
  const mediaType = node.media_type != null ? node.media_type : null;
  const link = node.link && typeof node.link === 'string' ? node.link : null;
  const code = node.code || '';
  const postUrl = code ? `https://www.instagram.com/p/${code}/` : null;
  const location = node.location || null;
  const isPaidPartnership = !!node.is_paid_partnership;
  const sponsorTags = node.sponsor_tags || null;
  const clipsMetadata = node.clips_metadata || null;
  const originalSoundTitle = clipsMetadata?.original_sound_info?.original_audio_title || null;
  const accessibilityCaption = node.accessibility_caption || null;

  return {
    pk,
    id: node.id || `${pk}_${author.pk}`,
    code,
    postUrl,
    author,
    caption,
    captionCreatedAt,
    takenAt,
    imageUrls: _dedupeInstagramUrls(imageUrls),
    videoUrls: _dedupeInstagramUrls(videoUrls),
    carousel,
    usertags,
    coauthors,
    commentCount,
    likeCount,
    viewCount,
    productType,
    mediaType,
    link,
    location,
    isPaidPartnership,
    sponsorTags,
    originalSoundTitle,
    accessibilityCaption,
  };
}

function aggregateInstagramFeedFromRequests(requests) {
  const byPk = new Map();
  for (const req of requests) {
    if (!req.responseBody) continue;
    const nodes = parseInstagramFeedFromResponse(req.responseBody);
    for (const node of nodes) {
      const post = normalizeInstagramNode(node);
      if (!post) continue;
      const key = post.pk;
      if (!key) continue;
      const existing = byPk.get(key);
      if (!existing || (post.caption && post.caption.length > (existing.caption || '').length))
        byPk.set(key, post);
    }
  }
  return Array.from(byPk.values());
}
function parseInstagramProfileFromResponse(responseBody) {
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const user = data?.data?.user || data?.user;
    if (!user || typeof user !== 'object') return null;
    const pk = user.pk != null ? String(user.pk) : (user.id != null ? String(user.id) : '');
    const username = user.username || '';
    if (!pk && !username) return null;
    return user;
  } catch (_) {}
  return null;
}
function normalizeInstagramProfile(user) {
  if (!user || typeof user !== 'object') return null;
  const pk = user.pk != null ? String(user.pk) : (user.id != null ? String(user.id) : '');
  const username = user.username || '';
  if (!pk && !username) return null;

  const fs = user.friendship_status || {};
  const friendship = {
    following: !!fs.following,
    followed_by: !!fs.followed_by,
    blocking: !!fs.blocking,
    is_restricted: !!fs.is_restricted,
    is_bestie: !!fs.is_bestie,
    is_feed_favorite: !!fs.is_feed_favorite,
    outgoing_request: !!fs.outgoing_request,
    incoming_request: !!fs.incoming_request,
    muting: !!fs.muting,
    is_muting_reel: !!fs.is_muting_reel,
  };

  const hdPic = user.hd_profile_pic_url_info?.url || '';
  const profilePicUrl = hdPic || user.profile_pic_url || '';

  return {
    pk,
    id: user.id != null ? String(user.id) : pk,
    username,
    full_name: user.full_name || '',
    biography: user.biography || '',
    profile_pic_url: profilePicUrl,
    is_verified: !!user.is_verified,
    is_private: !!user.is_private,
    is_memorialized: !!user.is_memorialized,
    is_business: !!user.is_business,
    is_unpublished: !!user.is_unpublished,
    is_embeds_disabled: !!user.is_embeds_disabled,
    account_type: user.account_type != null ? user.account_type : null,
    follower_count: user.follower_count != null ? user.follower_count : null,
    following_count: user.following_count != null ? user.following_count : null,
    media_count: user.media_count != null ? user.media_count : null,
    total_clips_count: user.total_clips_count != null ? user.total_clips_count : null,
    mutual_followers_count: user.mutual_followers_count != null ? user.mutual_followers_count : null,
    external_url: user.external_url || '',
    category: user.category || '',
    should_show_category: !!user.should_show_category,
    fbid_v2: user.fbid_v2 || '',
    address_street: user.address_street || '',
    city_name: user.city_name || '',
    zip: user.zip || '',
    friendship,
    text_post_app_badge_label: user.text_post_app_badge_label || '',
    show_text_post_app_badge: !!user.show_text_post_app_badge,
    latest_reel_media: user.latest_reel_media != null ? user.latest_reel_media : null,
    latest_besties_reel_media: user.latest_besties_reel_media != null ? user.latest_besties_reel_media : null,
    has_chaining: !!user.has_chaining,
    profile_context_facepile_users: user.profile_context_facepile_users || [],
    profile_context_links_with_user_ids: user.profile_context_links_with_user_ids || [],
    bio_links: user.bio_links || [],
    pronouns: user.pronouns || [],
    account_badges: user.account_badges || [],
    linked_fb_info: user.linked_fb_info || null,
    show_account_transparency_details: !!user.show_account_transparency_details,
    transparency_label: user.transparency_label || null,
    transparency_product: user.transparency_product || null,
    profile_url: username ? `https://www.instagram.com/${encodeURIComponent(username)}/` : '',
  };
}

function aggregateInstagramProfilesFromRequests(requests) {
  const byPk = new Map();
  for (const req of requests) {
    if (!req.responseBody) continue;
    const user = parseInstagramProfileFromResponse(req.responseBody);
    if (!user) continue;
    const profile = normalizeInstagramProfile(user);
    if (!profile) continue;
    const key = profile.pk || profile.username || '';
    if (!key) continue;
    const existing = byPk.get(key);
    if (!existing || (profile.biography && profile.biography.length > (existing.biography || '').length))
      byPk.set(key, profile);
  }
  return Array.from(byPk.values());
}

function normalizeInstagramImageUrl(url) {
  let out = (url || '').trim();
  if (!out) return '';
  out = out.replace(/\\u0026/gi, '&').replace(/&amp;/gi, '&');
  if (out.startsWith('http://')) out = 'https://' + out.slice('http://'.length);
  return out;
}

function buildInstagramImageUrlCandidates(url) {
  const base = normalizeInstagramImageUrl(url);
  if (!base) return [];
  const set = new Set([base]);
  try {
    const u = new URL(base);
    if (u.search) {
      const noQuery = `${u.origin}${u.pathname}`;
      set.add(noQuery);
    }
  } catch (_) {}
  return Array.from(set).filter(Boolean);
}

function cleanupInstagramProfilePicBlobs() {
  for (const blobUrl of instagramProfilePicBlobUrls) {
    try { URL.revokeObjectURL(blobUrl); } catch (_) {}
  }
  instagramProfilePicBlobUrls.clear();
}

function loadImageIntoElement(imgEl, src, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    if (!imgEl) return reject(new Error('missing image element'));
    const timer = setTimeout(() => {
      imgEl.onload = null;
      imgEl.onerror = null;
      reject(new Error('image load timeout'));
    }, timeoutMs);
    imgEl.onload = () => {
      clearTimeout(timer);
      imgEl.onload = null;
      imgEl.onerror = null;
      resolve(true);
    };
    imgEl.onerror = () => {
      clearTimeout(timer);
      imgEl.onload = null;
      imgEl.onerror = null;
      reject(new Error('image load error'));
    };
    imgEl.src = src;
  });
}

async function fetchImageAsBlobUrl(url) {
  const resp = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!resp.ok) throw new Error(`http_${resp.status}`);
  const ctype = (resp.headers.get('content-type') || '').toLowerCase();
  if (ctype && !ctype.startsWith('image/')) throw new Error(`not_image_${ctype}`);
  const blob = await resp.blob();
  if (!blob || !blob.size) throw new Error('empty_blob');
  const blobUrl = URL.createObjectURL(blob);
  instagramProfilePicBlobUrls.add(blobUrl);
  return blobUrl;
}

async function hydrateInstagramInlinePictures(container) {
  if (!container) return;
  const images = Array.from(container.querySelectorAll('img[data-instagram-image-src]'));
  for (const img of images) {
    if (!img || !img.isConnected) continue;
    if (img.dataset.hydrated === '1') continue;
    img.dataset.hydrated = '1';
    img.style.display = 'block';

    const rawUrl = img.getAttribute('data-instagram-image-src') || img.getAttribute('src') || '';
    const candidates = buildInstagramImageUrlCandidates(rawUrl);
    if (candidates.length === 0) {
      img.style.display = 'none';
      continue;
    }

    let rendered = false;
    for (const candidate of candidates) {
      if (!img.isConnected) break;
      try {
        await loadImageIntoElement(img, candidate);
        rendered = true;
        break;
      } catch (_) {}
    }
    if (rendered || !img.isConnected) continue;
    for (const candidate of candidates) {
      if (!img.isConnected) break;
      try {
        const blobUrl = await fetchImageAsBlobUrl(candidate);
        await loadImageIntoElement(img, blobUrl);
        rendered = true;
        break;
      } catch (_) {}
    }

    if (!rendered && img.isConnected) {
      img.style.display = 'none';
    }
  }
}

function buildInstagramProfileSectionHtml(profiles) {
  if (!profiles || profiles.length === 0) return '';

  const cards = profiles.map(p => {
    const initial = (p.full_name || p.username || '?').charAt(0).toUpperCase();
    const nameLine = p.full_name ? escapeHtml(p.full_name) + (p.is_verified ? ' ✓' : '') : '';
    const handleLine = p.username ? `@${escapeHtml(p.username)}` : '';
    const profilePicUrl = normalizeInstagramImageUrl(p.profile_pic_url);
    const picBlock = profilePicUrl
      ? `<div class="instagram-profile-pic-wrap"><img class="instagram-profile-pic-img" src="${escapeHtml(profilePicUrl)}" data-instagram-image-src="${escapeHtml(profilePicUrl)}" alt="" referrerpolicy="no-referrer" decoding="async"><span class="instagram-profile-pic-fallback">${escapeHtml(initial)}</span></div>`
      : `<div class="instagram-profile-pic-wrap"><span class="instagram-profile-pic-fallback">${escapeHtml(initial)}</span></div>`;

    const rows = [];
    function row(label, value) {
      if (value === undefined || value === null || value === '') return;
      const v = typeof value === 'object' ? JSON.stringify(value) : String(value);
      rows.push(`<div class="instagram-profile-row"><span class="instagram-profile-label">${escapeHtml(label)}</span><span class="instagram-profile-value">${escapeHtml(v)}</span></div>`);
    }
    function rowBool(label, val) { if (val === true || val === false) row(label, val ? 'Yes' : 'No'); }

    if (p.biography) row('Bio', p.biography);
    row('Username', p.username || '—');
    row('Full name', p.full_name || '—');
    row('ID / PK', p.pk || p.id || '—');
    row('FBID v2', p.fbid_v2 || '—');
    row('Profile URL', p.profile_url || '—');
    row('Followers', p.follower_count != null ? p.follower_count : null);
    row('Following', p.following_count != null ? p.following_count : null);
    row('Posts', p.media_count != null ? p.media_count : null);
    row('Clips', p.total_clips_count != null ? p.total_clips_count : null);
    row('Mutual followers', p.mutual_followers_count != null ? p.mutual_followers_count : null);
    rowBool('Private', p.is_private);
    rowBool('Verified', p.is_verified);
    rowBool('Business', p.is_business);
    row('Account type', p.account_type != null ? p.account_type : '');
    row('External URL', p.external_url || '');
    row('Category', p.category || '');
    row('Address', [p.address_street, p.city_name, p.zip].filter(Boolean).join(', ') || null);
    if (p.text_post_app_badge_label) row('App badge', p.text_post_app_badge_label);
    rowBool('Show app badge', p.show_text_post_app_badge);
    if (p.pronouns && p.pronouns.length) row('Pronouns', p.pronouns.join(', '));
    if (p.latest_reel_media != null) row('Latest reel (ts)', p.latest_reel_media);
    rowBool('Has chaining', p.has_chaining);
    rowBool('Embeds disabled', p.is_embeds_disabled);
    rowBool('Memorialized', p.is_memorialized);
    rowBool('Show transparency', p.show_account_transparency_details);
    if (p.transparency_label) row('Transparency label', p.transparency_label);
    if (p.transparency_product) row('Transparency product', p.transparency_product);

    const friendshipLabels = [];
    if (p.friendship.following) friendshipLabels.push('Following');
    if (p.friendship.followed_by) friendshipLabels.push('Followed by');
    if (p.friendship.blocking) friendshipLabels.push('Blocking');
    if (p.friendship.is_restricted) friendshipLabels.push('Restricted');
    if (p.friendship.is_bestie) friendshipLabels.push('Bestie');
    if (p.friendship.is_feed_favorite) friendshipLabels.push('Feed favorite');
    if (p.friendship.outgoing_request) friendshipLabels.push('Outgoing request');
    if (p.friendship.incoming_request) friendshipLabels.push('Incoming request');
    if (p.friendship.muting) friendshipLabels.push('Muting');
    if (p.friendship.is_muting_reel) friendshipLabels.push('Muting reel');
    if (friendshipLabels.length) rows.push(`<div class="instagram-profile-row"><span class="instagram-profile-label">Friendship</span><span class="instagram-profile-value">${escapeHtml(friendshipLabels.join(', ') || '—')}</span></div>`);

    if (p.bio_links && p.bio_links.length) row('Bio links', JSON.stringify(p.bio_links));
    if (p.profile_context_facepile_users && p.profile_context_facepile_users.length) row('Facepile users', p.profile_context_facepile_users.length + ' user(s)');
    if (p.account_badges && p.account_badges.length) row('Account badges', JSON.stringify(p.account_badges));

    const detailsHtml = rows.length ? `<div class="instagram-profile-details">${rows.join('')}</div>` : '';

    return `<div class="instagram-profile-card">
      <div class="instagram-profile-header">
        ${picBlock}
        <div class="instagram-profile-head-text">
          <div class="instagram-profile-name">${nameLine || '—'}</div>
          <div class="instagram-profile-handle">${handleLine || ''}</div>
          <div class="instagram-profile-links">
            ${p.profile_url ? `<a href="${escapeHtml(p.profile_url)}" target="_blank" rel="noopener" class="instagram-profile-link">Open profile</a>` : ''}
          </div>
        </div>
      </div>
      ${detailsHtml}
    </div>`;
  }).join('');

  return `<div class="instagram-profile-list">${cards}</div>`;
}

function buildInstagramDropdownSection(title, contentHtml, defaultOpen = true) {
  const openClass = defaultOpen ? ' open' : '';
  return `<div class="instagram-panel-dropdown${openClass}">
    <div class="instagram-panel-dropdown-header">${escapeHtml(title)}<span class="twitter-panel-dropdown-chevron">▼</span></div>
    <div class="instagram-panel-dropdown-content">${contentHtml}</div>
  </div>`;
}

function buildInstagramFeedListHtml(posts) {
  const listHtml = posts.map(post => {
    const author = post.author;
    const authorName = author.full_name || author.username || 'Unknown';
    const authorHandle = author.username ? `@${escapeHtml(author.username)}` : '';
    const verifiedBadge = author.is_verified ? ' ✓' : '';
    const initial = (authorName.charAt(0) || author.username?.charAt(0) || '?').toUpperCase();
    const profilePicUrl = normalizeInstagramImageUrl(author.profile_pic_url || '');
    const avatarBlock = profilePicUrl
      ? `<div class="instagram-feed-avatar-wrap"><img class="instagram-feed-avatar-img" src="${escapeHtml(profilePicUrl)}" data-instagram-image-src="${escapeHtml(profilePicUrl)}" alt="" referrerpolicy="no-referrer" decoding="async"><span class="instagram-feed-avatar-fallback">${escapeHtml(initial)}</span></div>`
      : `<div class="instagram-avatar-letter" aria-hidden="true">${escapeHtml(initial)}</div>`;
    const authorBlock =
      `<div class="instagram-byline">
        ${avatarBlock}
        <div class="instagram-byline-text">
          <span class="instagram-byline-name">${escapeHtml(authorName)}${verifiedBadge}</span>
          ${authorHandle ? `<span class="instagram-byline-handle">${authorHandle}</span>` : ''}
        </div>
      </div>`;

    const captionHtml = post.caption
      ? `<div class="instagram-caption">${escapeHtml(post.caption)}</div>`
      : '';
    const engagementParts = [];
    if (post.likeCount != null && post.likeCount > 0) engagementParts.push((post.likeCount >= 1e6 ? (post.likeCount / 1e6).toFixed(1) + 'M' : post.likeCount >= 1e3 ? (post.likeCount / 1e3).toFixed(1) + 'K' : post.likeCount) + ' likes');
    if (post.commentCount != null && post.commentCount > 0) engagementParts.push((post.commentCount >= 1e6 ? (post.commentCount / 1e6).toFixed(1) + 'M' : post.commentCount >= 1e3 ? (post.commentCount / 1e3).toFixed(1) + 'K' : post.commentCount) + ' comments');
    if (post.viewCount != null && post.viewCount > 0) engagementParts.push((post.viewCount >= 1e6 ? (post.viewCount / 1e6).toFixed(1) + 'M' : post.viewCount >= 1e3 ? (post.viewCount / 1e3).toFixed(1) + 'K' : post.viewCount) + ' views');
    const engagementHtml = engagementParts.length ? `<div class="instagram-engagement">${escapeHtml(engagementParts.join(' · '))}</div>` : '';

    const mediaUrls = post.imageUrls && post.imageUrls.length ? post.imageUrls : [];
    const carouselImages = (post.carousel || []).flatMap(c => c.imageUrls || []);
    const allImages = _dedupeInstagramUrls([...mediaUrls, ...carouselImages]);
    const videoUrls = post.videoUrls && post.videoUrls.length ? post.videoUrls : [];
    const carouselVideos = (post.carousel || []).flatMap(c => c.videoUrls || []);
    const allVideos = _dedupeInstagramUrls([...videoUrls, ...carouselVideos]);

    let mediaHtml = '';
    if (allImages.length > 0) {
      mediaHtml += `<div class="instagram-media-grid">${allImages.slice(0, 12).map(uri => `<a href="${escapeHtml(uri)}" target="_blank" rel="noopener noreferrer" class="facebook-all-images-item"><img class="instagram-embed-image" src="${escapeHtml(uri)}" alt="" loading="lazy"></a>`).join('')}</div>`;
    }
    if (allVideos.length > 0) {
      const firstVideo = allVideos[0];
      mediaHtml += `<a href="${escapeHtml(firstVideo)}" target="_blank" rel="noopener" class="instagram-video-link">Open video</a>`;
      if (allVideos.length > 1) mediaHtml += ` <span class="instagram-engagement">+ ${allVideos.length - 1} more video URL(s)</span>`;
    }

    const taggedHtml = post.usertags && post.usertags.length
      ? `<div class="instagram-tagged">Tagged: ${post.usertags.map(t => `@${escapeHtml(t.username)}${t.full_name ? ' (' + escapeHtml(t.full_name) + ')' : ''}`).join(', ')}</div>`
      : '';
    const coauthorsHtml = post.coauthors && post.coauthors.length
      ? `<div class="instagram-coauthors">Co-authors: ${post.coauthors.map(c => `@${escapeHtml(c.username)}${c.full_name ? ' (' + escapeHtml(c.full_name) + ')' : ''}`).join(', ')}</div>`
      : '';
    const linkHtml = (post.link || post.postUrl)
      ? `<a href="${escapeHtml(post.link || post.postUrl)}" target="_blank" rel="noopener" class="instagram-post-link">${post.link ? 'Link in post' : 'View on Instagram'}</a>`
      : '';
    let timeStr = '';
    if (post.takenAt != null) {
      try {
        timeStr = new Date(post.takenAt * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
      } catch (_) {}
    }
    const timeHtml = timeStr ? `<div class="instagram-post-time">${escapeHtml(timeStr)}</div>` : '';
    const paidBadge = post.isPaidPartnership ? ' <span style="color:var(--text-secondary);font-size:10px;">Paid partnership</span>' : '';
    const soundHtml = post.originalSoundTitle ? `<div class="instagram-engagement">Sound: ${escapeHtml(post.originalSoundTitle)}</div>` : '';

    return `<div class="instagram-post-card">
      ${authorBlock}
      ${mediaHtml}
      ${captionHtml}
      ${engagementHtml}
      ${taggedHtml}
      ${coauthorsHtml}
      ${soundHtml}
      ${linkHtml}
      ${timeHtml}${paidBadge}
    </div>`;
  }).join('');
  return `<div class="instagram-feed-list">${listHtml}</div>`;
}

function renderInstagramTab(requests) {
  const container = document.getElementById('requestsContainer');

  const instagramRequests = requests.filter(req => {
    if (!activeTabDomain || !isInstagramDomain(activeTabDomain)) return false;
    try {
      const u = new URL(req.url);
      const host = u.hostname || '';
      if (isInstagramDomain(host)) return true;
      if (host.includes('instagram')) return true;
    } catch (_) {}
    return false;
  });

  const posts = aggregateInstagramFeedFromRequests(instagramRequests);
  const profiles = aggregateInstagramProfilesFromRequests(instagramRequests);
  const signature = posts.map(p => p.pk).sort().join(',') + '|' + profiles.map(p => p.pk).sort().join(',');
  if (signature === lastInstagramDataSignature) return;
  lastInstagramDataSignature = signature;

  const onInstagram = isInstagramDomain(activeTabDomain);
  const hasAny = posts.length > 0 || profiles.length > 0;
  if (!hasAny) {
    cleanupInstagramProfilePicBlobs();
    container.innerHTML = `
      <div class="instagram-panel">
        <div class="instagram-empty">
          ${onInstagram
            ? 'No Instagram data captured yet.<br>View a user profile or feed on instagram.com to capture profile details and posts.'
            : 'Open Instagram (instagram.com) in this tab and view a profile or feed to capture data.'}
        </div>
      </div>`;
    return;
  }

  const emptySection = (msg) => `<div class="instagram-empty-section">${escapeHtml(msg)}</div>`;
  let sectionsHtml = '';
  if (profiles.length > 0) {
    sectionsHtml += buildInstagramDropdownSection(
      'Profile',
      buildInstagramProfileSectionHtml(profiles),
      true
    );
  }
  sectionsHtml += buildInstagramDropdownSection(
    'Feed / Posts',
    posts.length ? buildInstagramFeedListHtml(posts) : emptySection('No posts.'),
    profiles.length === 0
  );
  cleanupInstagramProfilePicBlobs();
  container.innerHTML = `<div class="instagram-panel">${sectionsHtml}</div>`;

  container.querySelectorAll('.instagram-panel-dropdown').forEach(el => {
    const header = el.querySelector('.instagram-panel-dropdown-header');
    if (header) {
      header.addEventListener('click', () => {
        el.classList.toggle('open');
      });
    }
  });
  hydrateInstagramInlinePictures(container);

}

