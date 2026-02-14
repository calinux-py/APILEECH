
function isTwitterDomain(host) {
  if (!host) return false;
  return host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com');
}

function parseTwitterExploreData(responseBody) {
  const trends = [];
  let sectionTitle = "What's happening";
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const instructions = data?.data?.explore_sidebar?.timeline?.instructions;
    if (!Array.isArray(instructions)) return { trends, sectionTitle };

    for (const inst of instructions) {
      if (inst.type !== 'TimelineAddEntries' || !Array.isArray(inst.entries)) continue;
      for (const entry of inst.entries) {
        const content = entry?.content;
        if (!content || content.entryType !== 'TimelineTimelineModule' || !Array.isArray(content.items)) continue;
        if (content.header?.text) sectionTitle = content.header.text;
        for (const item of content.items) {
          const itemContent = item?.item?.itemContent;
          if (!itemContent || itemContent.itemType !== 'TimelineTrend') continue;
          const meta = itemContent.trend_metadata || {};
          const promoted = itemContent.promoted_metadata || {};
          const advertiser = promoted?.advertiser_results?.result?.legacy?.name ||
            promoted?.advertiser_results?.result?.core?.name;
          const grouped = Array.isArray(itemContent.grouped_trends)
            ? itemContent.grouped_trends.map(g => g.name).filter(Boolean)
            : [];
          trends.push({
            name: itemContent.name || '',
            description: itemContent.description || promoted.promotedTrendDescription || '',
            context: meta.domain_context || '',
            promoted: !!advertiser,
            advertiser: advertiser || (promoted.promotedTrendName ? 'Promoted' : ''),
            related: grouped,
          });
        }
      }
    }
  } catch (_) {}
  return { trends, sectionTitle };
}

function aggregateTwitterTrendsFromRequests(requests) {
  const seen = new Set();
  const aggregated = [];
  for (const req of requests) {
    if (!req.responseBody) continue;
    const { trends } = parseTwitterExploreData(req.responseBody);
    for (const t of trends) {
      const key = t.name + '|' + (t.context || '');
      if (seen.has(key)) continue;
      seen.add(key);
      aggregated.push(t);
    }
  }
  return aggregated;
}
function normalizeTwitterUser(r) {
  if (!r || r.__typename !== 'User') return null;
  const core = r.core || {};
  const legacy = r.legacy || {};
  const entities = legacy.entities || {};
  const urlObj = entities.url?.urls?.[0];
  const profileUrl = urlObj ? (urlObj.expanded_url || urlObj.url || legacy.url) : legacy.url;
  const displayUrl = urlObj?.display_url || '';
  const professional = r.professional;
  const categoryNames = Array.isArray(professional?.category)
    ? professional.category.map(c => c.name).filter(Boolean).join(', ')
    : '';
  const categoryIds = Array.isArray(professional?.category)
    ? professional.category.map(c => c.id).filter((id) => id !== undefined && id !== null).join(', ')
    : '';
  const affLabel = r.affiliates_highlighted_label?.label;
  const affLabelDesc = affLabel?.description || '';
  const affLabelType = affLabel?.userLabelType || '';
  const descriptionUrls = (entities.description?.urls || [])
    .map((u) => u.expanded_url || u.url).filter(Boolean);
  const pinnedStr = Array.isArray(legacy.pinned_tweet_ids_str) ? legacy.pinned_tweet_ids_str.join(', ') : '';
  const profileUrlEntities = entities.url?.urls || [];
  const descriptionUrlEntities = entities.description?.urls || [];
  const professionalCategoriesFull = Array.isArray(professional?.category)
    ? professional.category.map((c) => ({ id: c.id, name: c.name, icon_name: c.icon_name }))
    : [];
  const safeStringify = (obj) => {
    try { return JSON.stringify(obj, null, 2); } catch (_) { return String(obj); }
  };
  return {
    __typename: r.__typename || 'User',
    id: r.id || '',
    rest_id: r.rest_id || '',
    avatar_url: r.avatar?.image_url || '',
    name: core.name || '',
    screen_name: core.screen_name || '',
    created_at: core.created_at || '',
    description: (r.profile_bio?.description || legacy.description || '').trim(),
    url: profileUrl || '',
    display_url: displayUrl,
    description_entities_urls: descriptionUrls.length ? descriptionUrls.join(' ; ') : '',
    followers_count: legacy.followers_count,
    friends_count: legacy.friends_count,
    favourites_count: legacy.favourites_count,
    statuses_count: legacy.statuses_count,
    listed_count: legacy.listed_count,
    media_count: legacy.media_count,
    normal_followers_count: legacy.normal_followers_count,
    fast_followers_count: legacy.fast_followers_count,
    location: (r.location?.location || '').trim(),
    profile_banner_url: legacy.profile_banner_url || '',
    profile_image_shape: r.profile_image_shape || 'Circle',
    profile_interstitial_type: legacy.profile_interstitial_type || '',
    profile_description_language: r.profile_description_language || '',
    protected: r.privacy?.protected === true,
    following: r.relationship_perspectives?.following === true,
    verified: r.verification?.verified === true || r.is_blue_verified === true,
    verified_type: r.verification?.verified_type || '',
    can_dm: r.dm_permissions?.can_dm === true,
    can_media_tag: r.media_permissions?.can_media_tag === true,
    professional_type: professional?.professional_type || '',
    professional_rest_id: professional?.rest_id || '',
    professional_category: categoryNames,
    professional_category_ids: categoryIds || '',
    pinned_tweet_ids_str: legacy.pinned_tweet_ids_str || [],
    pinned_tweet_ids_display: pinnedStr,
    default_profile: legacy.default_profile,
    default_profile_image: legacy.default_profile_image,
    possibly_sensitive: legacy.possibly_sensitive,
    translator_type: legacy.translator_type || '',
    want_retweets: legacy.want_retweets,
    has_custom_timelines: legacy.has_custom_timelines,
    is_translator: legacy.is_translator,
    withheld_in_countries: Array.isArray(legacy.withheld_in_countries) ? legacy.withheld_in_countries.join(', ') : '',
    follow_request_sent: r.follow_request_sent === true,
    has_graduated_access: r.has_graduated_access === true,
    super_follow_eligible: r.super_follow_eligible === true,
    parody_commentary_fan_label: r.parody_commentary_fan_label || '',
    affiliates_highlighted_label: affLabelDesc || affLabelType || '',
    is_blue_verified: r.is_blue_verified === true,
    _raw: r,
    legacy_entities_full: Object.keys(entities).length ? safeStringify(entities) : '',
    profile_url_entities_full: profileUrlEntities.length ? safeStringify(profileUrlEntities) : '',
    description_url_entities_full: descriptionUrlEntities.length ? safeStringify(descriptionUrlEntities) : '',
    professional_categories_full: professionalCategoriesFull.length ? safeStringify(professionalCategoriesFull) : '',
    professional_full: professional ? safeStringify(professional) : '',
    affiliates_highlighted_label_full: r.affiliates_highlighted_label && Object.keys(r.affiliates_highlighted_label).length ? safeStringify(r.affiliates_highlighted_label) : '',
    core_full: safeStringify(core),
    dm_permissions_full: r.dm_permissions ? safeStringify(r.dm_permissions) : '',
    media_permissions_full: r.media_permissions ? safeStringify(r.media_permissions) : '',
    privacy_full: r.privacy ? safeStringify(r.privacy) : '',
    relationship_perspectives_full: r.relationship_perspectives ? safeStringify(r.relationship_perspectives) : '',
    verification_full: r.verification ? safeStringify(r.verification) : '',
    location_full: r.location ? safeStringify(r.location) : '',
    avatar_full: r.avatar ? safeStringify(r.avatar) : '',
    profile_bio_full: r.profile_bio ? safeStringify(r.profile_bio) : '',
    legacy_full: safeStringify(legacy),
  };
}
function normalizeTwitterTweet(result) {
  const tweet = result?.tweet ? result.tweet : result;
  if (!tweet || (tweet.__typename !== 'Tweet' && tweet.__typename !== 'TweetWithVisibilityResults')) return null;
  const legacy = tweet.legacy || {};
  const core = tweet.core || {};
  const author = core?.user_results?.result;
  const noteResult = tweet.note_tweet?.note_tweet_results?.result;
  const fullText = (noteResult?.text || legacy.full_text || '').trim();
  const authorName = author?.core?.name || '';
  const authorScreenName = author?.core?.screen_name || '';
  const authorRestId = author?.rest_id || '';
  const authorAvatar = author?.avatar?.image_url || '';
  const source = (legacy.source || '').replace(/<[^>]+>/g, '').trim() || '';
  const mediaList = legacy.extended_entities?.media || legacy.entities?.media || [];
  const firstMedia = Array.isArray(mediaList) && mediaList[0] ? mediaList[0] : null;
  let mediaThumbUrl = '';
  let mediaUrl = '';
  if (firstMedia && firstMedia.media_url_https) {
    mediaThumbUrl = firstMedia.media_url_https;
    if (firstMedia.type === 'video' && firstMedia.video_info?.variants?.length) {
      const mp4Variants = firstMedia.video_info.variants.filter((v) => (v.content_type || '').startsWith('video/mp4'));
      const best = mp4Variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      mediaUrl = best?.url || firstMedia.media_url_https;
    } else {
      mediaUrl = firstMedia.media_url_https;
    }
  }
  return {
    rest_id: tweet.rest_id || legacy.id_str || '',
    full_text: fullText,
    created_at: legacy.created_at || '',
    author_name: authorName,
    author_screen_name: authorScreenName,
    author_rest_id: authorRestId,
    author_avatar_url: authorAvatar,
    favorite_count: legacy.favorite_count ?? 0,
    retweet_count: legacy.retweet_count ?? 0,
    reply_count: legacy.reply_count ?? 0,
    quote_count: legacy.quote_count ?? 0,
    bookmark_count: legacy.bookmark_count ?? 0,
    views: tweet.views?.count ?? '',
    lang: legacy.lang || '',
    source,
    possibly_sensitive: legacy.possibly_sensitive === true,
    conversation_id_str: legacy.conversation_id_str || '',
    media_thumb_url: mediaThumbUrl,
    media_url: mediaUrl,
    _raw: tweet,
  };
}
function parseTwitterProfileTweets(responseBody) {
  const tweets = [];
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const instructions = data?.data?.user?.result?.timeline?.timeline?.instructions;
    if (!Array.isArray(instructions)) return tweets;
    for (const inst of instructions) {
      if (inst.type === 'TimelinePinEntry' && inst.entry?.content?.itemContent?.tweet_results?.result) {
        const t = normalizeTwitterTweet(inst.entry.content.itemContent.tweet_results.result);
        if (t?.rest_id) tweets.push(t);
      }
      if (inst.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) {
        for (const entry of inst.entries) {
          const itemContent = entry?.content?.itemContent;
          const tweetResult = itemContent?.tweet_results?.result;
          if (!tweetResult || itemContent?.itemType !== 'TimelineTweet') continue;
          const t = normalizeTwitterTweet(tweetResult);
          if (t?.rest_id) tweets.push(t);
        }
      }
    }
  } catch (_) {}
  return tweets;
}
function parseTwitterHomeTimeline(responseBody) {
  const tweets = [];
  const pushTweetFromItemContent = (itemContent) => {
    const tweetResult = itemContent?.tweet_results?.result;
    if (!tweetResult || itemContent?.itemType !== 'TimelineTweet') return;
    const t = normalizeTwitterTweet(tweetResult);
    if (t?.rest_id) tweets.push(t);
  };
  const findMatchingBrace = (text, startIdx) => {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (inString) {
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  };
  const extractInstructionsFromRaw = (raw) => {
    if (typeof raw !== 'string') return null;
    const key = '"home_timeline_urt"';
    const keyIdx = raw.indexOf(key);
    if (keyIdx === -1) return null;
    const colonIdx = raw.indexOf(':', keyIdx + key.length);
    if (colonIdx === -1) return null;
    const objStart = raw.indexOf('{', colonIdx + 1);
    if (objStart === -1) return null;
    const objEnd = findMatchingBrace(raw, objStart);
    if (objEnd === -1) return null;
    const objText = raw.slice(objStart, objEnd + 1);
    try {
      const obj = JSON.parse(objText);
      return Array.isArray(obj?.instructions) ? obj.instructions : null;
    } catch (_) {
      return null;
    }
  };
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const tryParse = (txt) => {
      try { return JSON.parse(txt); } catch (_) { return null; }
    };
    let data = tryParse(raw);
    if (!data && typeof raw === 'string') {
      const markerIdx = raw.indexOf('\n\n/* truncated ');
      if (markerIdx !== -1) {
        const trimmed = raw.slice(0, markerIdx);
        data = tryParse(trimmed);
      }
    }
    let instructions =
      data?.data?.home?.home_timeline_urt?.instructions ??
      data?.home?.home_timeline_urt?.instructions ??
      extractInstructionsFromRaw(raw);
    if (!Array.isArray(instructions)) return tweets;
    for (const inst of instructions) {
      if (inst.type !== 'TimelineAddEntries' || !Array.isArray(inst.entries)) continue;
      for (const entry of inst.entries) {
        const content = entry?.content;
        if (content?.entryType === 'TimelineTimelineCursor') continue;
        if (content?.entryType === 'TimelineTimelineModule' && Array.isArray(content.items)) {
          for (const moduleItem of content.items) {
            pushTweetFromItemContent(moduleItem?.item?.itemContent);
          }
          continue;
        }
        pushTweetFromItemContent(content?.itemContent);
      }
    }
  } catch (_) {}
  return tweets;
}
function parseTwitterThreadTweets(responseBody) {
  const tweets = [];
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions;
    if (!Array.isArray(instructions)) return tweets;
    for (const inst of instructions) {
      if (inst.type !== 'TimelineAddEntries' || !Array.isArray(inst.entries)) continue;
      for (const entry of inst.entries) {
        const itemContent = entry?.content?.itemContent;
        const tweetResult = itemContent?.tweet_results?.result;
        if (!tweetResult || itemContent?.itemType !== 'TimelineTweet') continue;
        const t = normalizeTwitterTweet(tweetResult);
        if (t?.rest_id) tweets.push(t);
      }
    }
  } catch (_) {}
  return tweets;
}

function aggregateTwitterTweetsFromRequests(requests) {
  const byId = new Map();
  for (const req of requests) {
    if (!req.responseBody) continue;
    for (const parse of [parseTwitterProfileTweets, parseTwitterThreadTweets]) {
      const list = parse(req.responseBody);
      for (const t of list) {
        if (t.rest_id && !byId.has(t.rest_id)) byId.set(t.rest_id, t);
      }
    }
  }
  return Array.from(byId.values());
}

function aggregateTwitterTimelineFromRequests(requests) {
  const byId = new Map();
  const urlLower = (u) => (u || '').toLowerCase();
  for (const req of requests) {
    if (!req.responseBody) continue;
    const u = urlLower(req.url);
    if (!u.includes('hometimeline')) continue;
    const list = parseTwitterHomeTimeline(req.responseBody);
    for (const t of list) {
      if (t.rest_id && !byId.has(t.rest_id)) byId.set(t.rest_id, t);
    }
  }
  return Array.from(byId.values());
}
function parseTwitterProfileUser(responseBody) {
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const root = data?.data?.user?.result;
    let r = root;
    let user = normalizeTwitterUser(r);
    if (!user && root?.timeline?.timeline?.instructions) {
      const instructions = root.timeline.timeline.instructions;
      for (const inst of instructions) {
        if (inst.type === 'TimelinePinEntry' && inst.entry?.content?.itemContent?.tweet_results?.result?.core?.user_results?.result) {
          r = inst.entry.content.itemContent.tweet_results.result.core.user_results.result;
          user = normalizeTwitterUser(r);
          break;
        }
        if (inst.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) {
          for (const entry of inst.entries) {
            const itemContent = entry?.content?.itemContent;
            const tweetResult = itemContent?.tweet_results?.result;
            const u = tweetResult?.core?.user_results?.result;
            if (u && (tweetResult.__typename === 'Tweet' || tweetResult.__typename === 'TweetWithVisibilityResults')) {
              user = normalizeTwitterUser(u);
              break;
            }
          }
          if (user) break;
        }
      }
    }
    return user ? [user] : [];
  } catch (_) { return []; }
}
function parseTwitterUserRecommendations(responseBody) {
  const users = [];
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const list = data?.data?.sidebar_user_recommendations;
    if (!Array.isArray(list)) return users;
    for (const item of list) {
      const r = item?.user_results?.result;
      const user = normalizeTwitterUser(r);
      if (user) users.push(user);
    }
  } catch (_) {}
  return users;
}

function aggregateTwitterUsersFromRequests(requests) {
  const byId = new Map();
  for (const req of requests) {
    if (!req.responseBody) continue;
    const list = parseTwitterUserRecommendations(req.responseBody);
    for (const u of list) {
      if (u.rest_id && !byId.has(u.rest_id)) byId.set(u.rest_id, u);
    }
  }
  return Array.from(byId.values());
}

function aggregateTwitterProfileUsersFromRequests(requests) {
  const byId = new Map();
  for (const req of requests) {
    if (!req.responseBody) continue;
    const list = parseTwitterProfileUser(req.responseBody);
    for (const u of list) {
      if (u.rest_id && !byId.has(u.rest_id)) byId.set(u.rest_id, u);
    }
  }
  return Array.from(byId.values());
}

function formatTwitterUserDetailRow(label, value, opts) {
  if (value === undefined || value === null) return '';
  if (value === '' && !(opts && opts.allowEmpty)) return '';
  const display = String(value);
  const isLink = opts === true || (opts && opts.link);
  const isBio = opts && opts.bio;
  let content;
  if (isLink) content = `<a href="${escapeHtml(display)}" target="_blank" rel="noopener">${escapeHtml(display)}</a>`;
  else if (isBio) content = `<span class="twitter-user-bio">${escapeHtml(display)}</span>`;
  else content = escapeHtml(display);
  return `<div class="twitter-user-detail-row"><span class="twitter-user-detail-label">${escapeHtml(label)}</span><span class="twitter-user-detail-value">${content}</span></div>`;
}

function formatTwitterUserJsonBlock(label, jsonText) {
  if (!jsonText || String(jsonText).trim() === '') return '';
  return `<details class="twitter-user-json-block"><summary>${escapeHtml(label)}</summary><pre class="twitter-user-json-pre">${escapeHtml(String(jsonText))}</pre></details>`;
}

function twitterUserDetailRows(u) {
  const row = (label, value, opts) => formatTwitterUserDetailRow(label, value, opts);
  const num = (v) => (v != null ? v.toLocaleString() : '');
  const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : '');
  const safeStringify = (o) => { try { return JSON.stringify(o, null, 2); } catch (_) { return String(o); } };
  const rows = [
    row('__typename', u.__typename),
    row('User ID (rest_id)', u.rest_id),
    row('GraphQL id', u.id),
    row('Name', u.name),
    row('Screen name', u.screen_name),
    row('Joined', u.created_at),
    row('Bio', u.description, { bio: true }),
    row('Website', u.url || u.display_url, !!u.url),
    row('Display URL', u.display_url),
    row('Bio URLs', u.description_entities_urls),
    row('Location', u.location),
    row('Profile language', u.profile_description_language),
    row('Followers', num(u.followers_count)),
    row('Following', num(u.friends_count)),
    row('Tweets', num(u.statuses_count)),
    row('Likes', num(u.favourites_count)),
    row('Lists', num(u.listed_count)),
    row('Media count', num(u.media_count)),
    row('Normal followers', num(u.normal_followers_count)),
    row('Fast followers', num(u.fast_followers_count)),
    row('Protected', yesNo(u.protected) || '—'),
    row('Verified', yesNo(u.verified) || '—'),
    row('Verified type', u.verified_type),
    row('Blue verified', yesNo(u.is_blue_verified) || '—'),
    row('Can DM', yesNo(u.can_dm) || '—'),
    row('Can media tag', yesNo(u.can_media_tag) || '—'),
    row('You follow', yesNo(u.following) || '—'),
    row('Follow request sent', yesNo(u.follow_request_sent) || '—'),
    row('Professional type', u.professional_type),
    row('Professional rest_id', u.professional_rest_id),
    row('Professional category', u.professional_category),
    row('Professional category IDs', u.professional_category_ids),
    row('Super follow eligible', yesNo(u.super_follow_eligible) || '—'),
    row('Pinned tweet IDs', u.pinned_tweet_ids_display || (Array.isArray(u.pinned_tweet_ids_str) && u.pinned_tweet_ids_str.length ? u.pinned_tweet_ids_str.join(', ') : '')),
    row('Profile image shape', u.profile_image_shape),
    row('Profile interstitial', u.profile_interstitial_type),
    u.profile_banner_url ? row('Banner URL', u.profile_banner_url, true) : '',
    row('Default profile', yesNo(u.default_profile) || '—'),
    row('Default profile image', yesNo(u.default_profile_image) || '—'),
    row('Possibly sensitive', yesNo(u.possibly_sensitive) || '—'),
    row('Translator type', u.translator_type),
    row('Want retweets', yesNo(u.want_retweets) || '—'),
    row('Has custom timelines', yesNo(u.has_custom_timelines) || '—'),
    row('Is translator', yesNo(u.is_translator) || '—'),
    row('Has graduated access', yesNo(u.has_graduated_access) || '—'),
    row('Parody/commentary label', u.parody_commentary_fan_label),
    row('Affiliates label', u.affiliates_highlighted_label),
    u.withheld_in_countries ? row('Withheld in countries', u.withheld_in_countries) : '',
  ].filter(Boolean);
  const rawBlock = u._raw ? formatTwitterUserJsonBlock('Full raw API response (entire User object)', safeStringify(u._raw)) : '';
  return rows.join('') + (rawBlock ? '<div class="twitter-user-json-section">' + rawBlock + '</div>' : '');
}

function buildTwitterUserListHtml(users) {
  const userItemsHtml = users.map((u, idx) => {
    const avatarHtml = u.avatar_url
      ? `<img class="twitter-user-avatar" src="${escapeHtml(u.avatar_url)}" alt="">`
      : `<div class="twitter-user-avatar-placeholder">@</div>`;
    const verifiedBadge = u.verified ? ' <span style="color:var(--blue)">✓</span>' : '';
    const detailsParts = twitterUserDetailRows(u);
    return `
      <div class="twitter-user-item" data-user-index="${idx}">
        <div class="twitter-user-header">
          ${avatarHtml}
          <div class="twitter-user-headline">
            <div class="twitter-user-name">${escapeHtml(u.name)}${verifiedBadge}</div>
            <div class="twitter-user-handle">@${escapeHtml(u.screen_name)}</div>
          </div>
          <span class="twitter-user-chevron">▼</span>
        </div>
        <div class="twitter-user-details">${detailsParts}</div>
      </div>`;
  }).join('');
  return `<div class="twitter-user-list">${userItemsHtml}</div>`;
}

function buildTwitterDropdownSection(title, contentHtml, defaultOpen = true) {
  const openClass = defaultOpen ? ' open' : '';
  return `<div class="twitter-panel-dropdown${openClass}">
    <div class="twitter-panel-dropdown-header">${escapeHtml(title)}<span class="twitter-panel-dropdown-chevron">▼</span></div>
    <div class="twitter-panel-dropdown-content">${contentHtml}</div>
  </div>`;
}

function buildTwitterTweetsListHtml(tweets) {
  const linkStyle = 'font-size:11px;color:var(--blue);margin-top:6px;display:inline-block;';
  const listHtml = tweets.map((t) => {
    const avatarHtml = t.author_avatar_url
      ? `<img class="twitter-tweet-avatar" src="${escapeHtml(t.author_avatar_url)}" alt="">`
      : `<div class="twitter-tweet-avatar-placeholder">@</div>`;
    const metrics = [];
    if (t.reply_count != null && t.reply_count > 0) metrics.push(`${t.reply_count} replies`);
    if (t.retweet_count != null && t.retweet_count > 0) metrics.push(`${t.retweet_count} RTs`);
    if (t.favorite_count != null && t.favorite_count > 0) metrics.push(`${t.favorite_count} likes`);
    if (t.quote_count != null && t.quote_count > 0) metrics.push(`${t.quote_count} quotes`);
    if (t.views) metrics.push(`${t.views} views`);
    const metricsHtml = metrics.length ? `<div class="twitter-tweet-metrics">${metrics.join(' · ')}</div>` : '';
    const dateHtml = t.created_at ? `<div class="twitter-tweet-date">${escapeHtml(t.created_at)}</div>` : '';
    const sourceHtml = t.source ? `<div class="twitter-tweet-source">${escapeHtml(t.source)}</div>` : '';
    const hasMedia = t.media_thumb_url && t.media_url;
    const mediaThumbHtml = hasMedia
      ? `<div class="twitter-tweet-media-wrap"><img class="twitter-tweet-media-thumb" src="${escapeHtml(t.media_thumb_url)}" alt="" loading="lazy"></div>`
      : '';
    const mediaLinkHtml = hasMedia
      ? `<a href="${escapeHtml(t.media_url)}" target="_blank" rel="noopener" style="${linkStyle}">Open media</a>`
      : '';
    return `
      <li class="twitter-tweet-item${hasMedia ? ' twitter-tweet-item-with-media' : ''}">
        ${mediaThumbHtml}
        <div class="twitter-tweet-body">
          <div class="twitter-tweet-author">
            ${avatarHtml}
            <div class="twitter-tweet-author-info">
              <span class="twitter-tweet-author-name">${escapeHtml(t.author_name)}</span>
              <span class="twitter-tweet-author-handle">@${escapeHtml(t.author_screen_name)}</span>
            </div>
          </div>
          <div class="twitter-tweet-text">${escapeHtml(t.full_text || '(no text)')}</div>
          ${dateHtml}
          ${metricsHtml}
          ${mediaLinkHtml}
          ${sourceHtml}
        </div>
      </li>`;
  }).join('');
  return `<ul class="twitter-tweet-list">${listHtml}</ul>`;
}

function buildTwitterTrendsListHtml(trends) {
  const listHtml = trends.map(t => {
    const descHtml = t.description ? `<div class="twitter-trend-context">${escapeHtml(t.description)}</div>` : '';
    const ctxHtml = t.context ? `<div class="twitter-trend-context">${escapeHtml(t.context)}</div>` : '';
    const relatedHtml = t.related && t.related.length
      ? `<div class="twitter-trend-context">Related: ${t.related.map(r => escapeHtml(r)).join(' · ')}</div>`
      : '';
    return `
      <li class="twitter-trend-item">
        <div class="twitter-trend-name">${escapeHtml(t.name)}</div>
        ${ctxHtml}
        ${descHtml}
        ${relatedHtml}
      </li>`;
  }).join('');
  return `<ul class="twitter-trend-list">${listHtml}</ul>`;
}

function renderTwitterTab(requests) {
  const container = document.getElementById('requestsContainer');

  const twitterRequests = requests.filter(req => {
    if (!activeTabDomain || !isTwitterDomain(activeTabDomain)) return false;
    if (req.initiator) {
      try { if (isTwitterDomain(new URL(req.initiator).hostname)) return true; } catch {} }
    try { if (isTwitterDomain(new URL(req.url).hostname)) return true; } catch {}
    return false;
  });

  const profileUsers = aggregateTwitterProfileUsersFromRequests(twitterRequests);
  const sidebarUsers = aggregateTwitterUsersFromRequests(twitterRequests);
  const tweets = aggregateTwitterTweetsFromRequests(twitterRequests);
  const timelineTweets = aggregateTwitterTimelineFromRequests(twitterRequests);
  const signature = [
    profileUsers.map(u => u.rest_id).join(','),
    sidebarUsers.map(u => u.rest_id).join(','),
    tweets.map(t => t.rest_id).join(','),
    timelineTweets.map(t => t.rest_id).join(','),
  ].join(';');
  if (signature === lastTwitterDataSignature) return;
  lastTwitterDataSignature = signature;

  const onTwitter = isTwitterDomain(activeTabDomain);
  if (profileUsers.length === 0 && sidebarUsers.length === 0 && tweets.length === 0 && timelineTweets.length === 0) {
    container.innerHTML = `
      <div class="twitter-panel">
        <div class="twitter-empty">
          ${onTwitter
            ? 'No Twitter data captured yet.<br>Open a profile, browse the sidebar (Explore, Who to follow), or refresh the page to capture API data.'
            : 'Open a Twitter/X page (x.com or twitter.com) in this tab, then browse or refresh to capture data.'}
        </div>
      </div>`;
    return;
  }

  const emptySection = (msg) => `<div class="twitter-empty-section">${escapeHtml(msg)}</div>`;
  const sectionsHtml =
    buildTwitterDropdownSection('Users', profileUsers.length ? buildTwitterUserListHtml(profileUsers) : emptySection('No users captured.')) +
    buildTwitterDropdownSection('Tweets', tweets.length ? buildTwitterTweetsListHtml(tweets) : emptySection('No tweets captured.')) +
    buildTwitterDropdownSection('Timeline', timelineTweets.length ? buildTwitterTweetsListHtml(timelineTweets) : emptySection('No home timeline captured. Open or refresh the For You feed on x.com to capture.')) +
    buildTwitterDropdownSection('Users you might like', sidebarUsers.length ? buildTwitterUserListHtml(sidebarUsers) : emptySection('No suggestions.'));

  container.innerHTML = `<div class="twitter-panel">${sectionsHtml}</div>`;

  container.querySelectorAll('.twitter-panel-dropdown').forEach(el => {
    const header = el.querySelector('.twitter-panel-dropdown-header');
    if (header) {
      header.addEventListener('click', () => {
        el.classList.toggle('open');
      });
    }
  });

  container.querySelectorAll('.twitter-user-item').forEach(el => {
    const header = el.querySelector('.twitter-user-header');
    if (header) {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        el.classList.toggle('open');
      });
    }
  });
}

