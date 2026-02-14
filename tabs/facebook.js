
function isFacebookDomain(host) {
  if (!host) return false;
  return host === 'www.facebook.com' || host === 'facebook.com' || host === 'm.facebook.com' || host.endsWith('.facebook.com');
}

function parseFacebookBootstrapKeywords(responseBody) {
  const users = [];
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const edges = data?.data?.viewer?.bootstrap_keywords?.edges;
    if (!Array.isArray(edges)) return users;
    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;
      const direct = node?.sts_info?.direct_nav_result;
      if (!direct || direct.entity_type !== 'user') continue;
      let loggingInfo = {};
      try {
        if (node.item_logging_info) loggingInfo = JSON.parse(node.item_logging_info);
      } catch (_) {}
      users.push({
        ent_id: direct.ent_id || loggingInfo.kwEntId || '',
        title: direct.title || node.keyword_text || '',
        keyword_text: node.keyword_text || '',
        img_url: direct.img_url || '',
        link_url: direct.link_url || '',
        snippet: direct.snippet || '',
        type: direct.type || '',
        entity_type: direct.entity_type || 'user',
        item_logging_id: node.item_logging_id || '',
        loggingInfo,
      });
    }
  } catch (_) {}
  return users;
}

function parseFacebookSideFeedAds(responseBody) {
  const ads = [];
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const nodes = data?.data?.viewer?.sideFeedUnit?.nodes;
    if (!Array.isArray(nodes)) return ads;
    for (const node of nodes) {
      if (node?.__typename !== 'AdsSideFeedUnit' || !node?.new_adverts?.nodes) continue;
      for (const item of node.new_adverts.nodes) {
        const rhc = item?.rhc_ad;
        const sponsored = item?.sponsored_data;
        if (!rhc) continue;
        const actor = rhc.actor || {};
        const profilePic = actor.profile_picture?.uri || '';
        const image = rhc.image?.uri || '';
        const webLink = rhc.web_link?.url || rhc.target_url || '';
        ads.push({
          id: item.id || sponsored?.ad_id || '',
          ad_id: sponsored?.ad_id || '',
          actor_id: actor.id || '',
          actor_name: actor.name || '',
          actor_picture_uri: profilePic,
          description: rhc.description || '',
          title: rhc.title || '',
          subtitle: rhc.subtitle || '',
          image_uri: image,
          target_url: rhc.target_url || '',
          web_link_url: webLink,
        });
      }
    }
  } catch (_) {}
  return ads;
}

function aggregateFacebookDataFromRequests(requests) {
  const byEntId = new Map();
  for (const req of requests) {
    if (!req.responseBody) continue;
    const list = parseFacebookBootstrapKeywords(req.responseBody);
    for (const u of list) {
      if (u.ent_id && !byEntId.has(u.ent_id)) byEntId.set(u.ent_id, u);
    }
  }
  return Array.from(byEntId.values());
}

function aggregateFacebookAdsFromRequests(requests) {
  const byId = new Map();
  for (const req of requests) {
    if (!req.responseBody) continue;
    const list = parseFacebookSideFeedAds(req.responseBody);
    for (const ad of list) {
      const key = ad.id || ad.ad_id || (ad.actor_id + '|' + ad.title);
      if (key && !byId.has(key)) byId.set(key, ad);
    }
  }
  return Array.from(byId.values());
}
function _facebookRouteSection(routeName, pathKey) {
  if (routeName && typeof routeName === 'string') {
    if (routeName.includes('About')) return 'About';
    if (routeName.includes('Photos')) return 'Photos';
    if (routeName.includes('Collection') && pathKey) return pathKey.includes('photos') ? 'Photos' : pathKey.includes('friends') ? 'Friends' : null;
    if (routeName.includes('Videos') || routeName.includes('ProfilePlusVideos')) return 'Videos';
    if (routeName.includes('Friends')) return 'Friends';
    if (routeName.includes('TimelineListView') || routeName.includes('Timeline')) return 'Timeline';
    if (routeName.includes('Reels')) return 'Reels';
    if (routeName.includes('Events')) return 'Events';
    if (routeName.includes('Reviews')) return 'Reviews given';
  }
  if (pathKey && typeof pathKey === 'string') {
    if (/\/about\/?(\?|$)/.test(pathKey)) return 'About';
    if (/\/photos\/?(\?|$)/.test(pathKey)) return 'Photos';
    if (/\/videos\/?(\?|$)/.test(pathKey)) return 'Videos';
    if (/\/friends\/?(\?|$)/.test(pathKey)) return 'Friends';
    if (/\/reels/.test(pathKey)) return 'Reels';
    if (/\/events\/?(\?|$)/.test(pathKey)) return 'Events';
    if (/\/reviews/.test(pathKey)) return 'Reviews given';
  }
  return null;
}

function parseFacebookBulkRouteDefinitions(responseBody) {
  const profiles = [];
  const routeSectionsByUser = new Map();
  try {
    let raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    if (raw.startsWith('for (;;);')) raw = raw.slice(9);
    const data = JSON.parse(raw);
    const payloads = data?.payload?.payloads;
    if (!payloads || typeof payloads !== 'object') return profiles;
    for (const pathKey of Object.keys(payloads)) {
      const item = payloads[pathKey];
      if (!item || item.error || !item.result) continue;
      const result = item.result;
      const exports = result?.exports;
      const props = exports?.rootView?.props || exports?.hostableView?.props;
      const meta = result?.meta;
      const title = (meta?.title || '').trim();

      if (result.type === 'route_definition' && props) {
        if (props.groupID && (exports?.canonicalRouteName || '').includes('Group')) {
          const groupID = String(props.groupID);
          let groupUrl = '';
          try {
            const pathClean = pathKey.split('?')[0].replace(/^\/+|\/+$/g, '');
            if (pathClean) groupUrl = `https://www.facebook.com/${pathClean}`;
          } catch (_) {}
          if (!groupUrl) groupUrl = `https://www.facebook.com/groups/${encodeURIComponent(groupID)}`;
          const gkey = 'group:' + groupID;
          if (!routeSectionsByUser.has(gkey)) {
            routeSectionsByUser.set(gkey, { userID: '', userVanity: '', profileUrl: groupUrl, viewerID: '', name: title || groupID, routeSections: [{ section: 'Group', url: groupUrl }], isGroup: true });
          } else {
            const rec = routeSectionsByUser.get(gkey);
            if (title) rec.name = rec.name || title;
          }
        } else if (props.userID || props.userVanity) {
          const userID = props.userID ? String(props.userID) : '';
          const userVanity = (props.userVanity || '').trim();
          const viewerID = (props.viewerID ? String(props.viewerID) : exports?.actorID ? String(exports.actorID) : '').trim();
          const profileUrl = userVanity ? `https://www.facebook.com/${encodeURIComponent(userVanity)}` : (userID ? `https://www.facebook.com/profile.php?id=${encodeURIComponent(userID)}` : '');
          const routeName = exports?.canonicalRouteName || '';
          const section = _facebookRouteSection(routeName, pathKey);
          let sectionUrl = '';
          try {
            const pathClean = pathKey.split('?')[0].replace(/^\/+|\/+$/g, '');
            if (pathClean) sectionUrl = `https://www.facebook.com/${pathClean}`;
          } catch (_) {}
          const key = userID || userVanity || pathKey;
          if (key) {
            if (!routeSectionsByUser.has(key)) {
              routeSectionsByUser.set(key, { userID, userVanity, profileUrl, viewerID, name: title, routeSections: [] });
            }
            const rec = routeSectionsByUser.get(key);
            if (title) rec.name = rec.name || title;
            if (sectionUrl && section) {
              const exists = rec.routeSections.some(s => s.url === sectionUrl || s.section === section);
              if (!exists) rec.routeSections.push({ section, url: sectionUrl });
            }
          }
        }
      }

      if (result.type === 'route_redirect' && result.redirect_result?.exports) {
        const rex = result.redirect_result.exports;
        const rprops = rex?.rootView?.props || rex?.hostableView?.props;
        if (rprops?.id != null && rex.canonicalRouteName && rex.canonicalRouteName.includes('TopChartsCity')) {
          const placeId = String(rprops.id);
          const placeTitle = (result.redirect_result?.meta?.title || '').trim();
          const redirectUrl = (result.redirect_url || '').trim();
          if (placeId) {
            const placeUrl = redirectUrl ? (redirectUrl.startsWith('http') ? redirectUrl : `https://www.facebook.com${redirectUrl.startsWith('/') ? '' : '/'}${redirectUrl}`) : `https://www.facebook.com/pages/${placeId}`;
            if (!routeSectionsByUser.has('place:' + placeId)) {
              routeSectionsByUser.set('place:' + placeId, { userID: '', userVanity: '', profileUrl: placeUrl, viewerID: '', name: placeTitle || placeId, routeSections: [{ section: 'Place', url: placeUrl }], isPlace: true });
            }
          }
        }
      }
    }

    for (const rec of routeSectionsByUser.values()) {
      if (rec.isPlace) {
        profiles.push({ userID: '', userVanity: '', profileUrl: rec.profileUrl, viewerID: '', name: rec.name, routeSections: rec.routeSections, isPlace: true });
      } else if (rec.isGroup) {
        profiles.push({ userID: '', userVanity: '', profileUrl: rec.profileUrl, viewerID: '', name: rec.name, routeSections: rec.routeSections || [], isGroup: true });
      } else if (rec.userID || rec.userVanity) {
        profiles.push({
          userID: rec.userID,
          userVanity: rec.userVanity,
          profileUrl: rec.profileUrl,
          viewerID: rec.viewerID,
          name: rec.name,
          routeSections: rec.routeSections,
        });
      }
    }
  } catch (_) {}
  return profiles;
}
function parseFacebookProfileHeader(responseBody) {
  const out = {
    id: '',
    name: '',
    url: '',
    username: '',
    gender: '',
    avatarUris: [],
    coverPhotoUri: '',
    coverPhotoUrl: '',
    profilePhotoUrl: '',
    profilePhotoId: '',
    socialContext: [],
    introCard: { category: '', currentCity: '', currentCityUri: '', links: [], bio: '' },
    tabs: [],
  };
  try {
    let raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    let header = null;

    function applyPayload(data) {
      if (!data || typeof data !== 'object') return;
      const user = data.user || data;
      const renderer = user.profile_header_renderer || (user.__typename === 'User' ? user : null);
      const h = renderer?.user || renderer || user;
      if (!h || typeof h !== 'object') return;
      if (!header) header = { user: h, renderer: renderer || user };
      else {
        if (h.name) header.user.name = h.name;
        if (h.url) header.user.url = h.url;
        if (h.gender) header.user.gender = h.gender;
        if (h.id) header.user.id = h.id;
        if (h.username_for_profile != null) header.user.username_for_profile = h.username_for_profile;
        [['profilePicSmall', 'profilePicMedium', 'profilePicLarge', 'profile_picture_for_sticky_bar']].forEach(keys => {
          keys.forEach(k => { if (h[k]?.uri) header.user[k] = h[k]; });
        });
        if (h.profilePhoto) header.user.profilePhoto = h.profilePhoto;
        if (h.cover_photo) header.user.cover_photo = h.cover_photo;
        if (renderer?.profile_social_context) header.renderer.profile_social_context = renderer.profile_social_context;
        if (renderer?.profile_intro_card) header.renderer.profile_intro_card = renderer.profile_intro_card;
        if (renderer?.profile_tabs) header.renderer.profile_tabs = renderer.profile_tabs;
      }
    }

    try {
      const single = JSON.parse(raw);
      if (single?.data?.user?.profile_header_renderer)
        applyPayload(single.data);
    } catch (_) {}

    if (!header) {
      const lines = raw.split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          const data = obj?.data;
          if (data?.user?.profile_header_renderer) {
            applyPayload(data);
            break;
          }
          if (data && (data.user || data.id)) {
            const path = obj.path;
            if (Array.isArray(path) && (path[0] === 'user' || path.includes('profile_header_renderer')))
              applyPayload({ user: data });
            else if (data.user)
              applyPayload(data);
          }
        } catch (_) {}
      }
    }

    if (!header) return null;

    const u = header.user;
    const r = header.renderer || {};
    out.id = u.id ? String(u.id) : '';
    out.name = (u.name || '').trim();
    out.url = (u.url || '').trim();
    out.gender = (u.gender || '').trim();
    try {
      if (out.url) {
        const parsed = new URL(out.url);
        const path = parsed.pathname.replace(/^\/+|\/+$/g, '');
        if (path && path !== 'profile.php') out.username = path;
      }
    } catch (_) {}
    if (u.username_for_profile) out.username = (u.username_for_profile || out.username).trim();

    const avatarKeys = ['profile_picture_for_sticky_bar', 'profilePicSmall', 'profilePicMedium', 'profilePicLarge'];
    avatarKeys.forEach(k => {
      const uri = u[k]?.uri;
      if (uri && !out.avatarUris.includes(uri)) out.avatarUris.push(uri);
    });

    const cover = u.cover_photo || r.cover_photo;
    if (cover?.photo?.image?.uri) out.coverPhotoUri = cover.photo.image.uri;
    if (cover?.url) out.coverPhotoUrl = cover.url;
    if (u.profilePhoto?.url) out.profilePhotoUrl = u.profilePhoto.url;
    if (u.profilePhoto?.id) out.profilePhotoId = String(u.profilePhoto.id);

    const content = r.profile_social_context?.content;
    if (Array.isArray(content)) {
      content.forEach(c => {
        const text = c?.text?.text || c?.text;
        const uri = c?.uri;
        if (text || uri) out.socialContext.push({ text: (text || '').trim(), uri: (uri || '').trim() });
      });
    }

    const intro = r.profile_intro_card;
    if (intro?.context_items?.edges) {
      intro.context_items.edges.forEach(edge => {
        const node = edge?.node;
        if (!node) return;
        const fieldType = node.profile_field_type || '';
        const shortTitle = node.short_title?.text || node.short_title || '';
        const pageUri = (node.page_uri || '').trim();
        if (fieldType === 'category') out.introCard.category = shortTitle.trim();
        else if (fieldType === 'current_city') {
          out.introCard.currentCity = shortTitle.trim();
          out.introCard.currentCityUri = pageUri;
        }         else if (fieldType === 'screenname') {
          const ranges = node.short_title?.ranges;
          if (Array.isArray(ranges)) {
            ranges.forEach(rng => {
              const entity = rng?.entity;
              const url = (entity?.external_url || entity?.url || '').trim();
              let label = (shortTitle || '').trim();
              if (url) {
                try { label = label || new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
                out.introCard.links.push({ label: label || url, url });
              }
            });
          }
          if (!out.introCard.links.length && shortTitle) out.introCard.links.push({ label: shortTitle.trim(), url: pageUri || '' });
        }
      });
    }
    if (intro?.profile_status?.profile_status_text?.text)
      out.introCard.bio = (intro.profile_status.profile_status_text.text || '').trim();

    const tabEdges = r.profile_tabs?.profile_user?.timeline_nav_app_sections?.edges;
    if (Array.isArray(tabEdges)) {
      tabEdges.forEach(edge => {
        const node = edge?.node;
        if (node && (node.name || node.url))
          out.tabs.push({ name: (node.name || '').trim(), url: (node.url || '').trim(), section_type: node.section_type || '' });
      });
    }

    return (out.id || out.name || out.url) ? out : null;
  } catch (_) { return null; }
}

function aggregateFacebookProfilesFromRequests(requests) {
  const byUserID = new Map();
  const byKey = (p) => p.userID || p.userVanity || p.profileUrl || '';
  for (const req of requests) {
    try {
      const u = new URL(req.url);
      if (u.origin !== 'https://www.facebook.com' || u.pathname !== '/ajax/bulk-route-definitions/') continue;
    } catch (_) { continue; }
    if (!req.responseBody) continue;
    const list = parseFacebookBulkRouteDefinitions(req.responseBody);
    for (const p of list) {
      const idKey = p.userID || null;
      const vanityKey = p.userVanity ? 'v:' + p.userVanity : null;
      const fallbackKey = p.profileUrl ? 'u:' + p.profileUrl : (p.name ? 'p:' + p.name : null);
      const key = idKey || vanityKey || fallbackKey;
      if (!key) continue;
      let existing = (idKey && byUserID.get(idKey)) || (vanityKey && byUserID.get(vanityKey));
      if (!existing && (idKey || vanityKey)) {
        for (const [, v] of byUserID) {
          if ((idKey && v.userID === p.userID) || (vanityKey && v.userVanity === p.userVanity)) {
            existing = v;
            break;
          }
        }
      }
      if (existing) {
        if (p.name) existing.name = existing.name || p.name;
        if (Array.isArray(p.routeSections)) {
          existing.routeSections = existing.routeSections || [];
          for (const rs of p.routeSections) {
            if (rs.url && !existing.routeSections.some(s => s.url === rs.url))
              existing.routeSections.push(rs);
          }
        }
      } else {
        const copy = { ...p };
        if (!copy.routeSections) copy.routeSections = [];
        byUserID.set(key, copy);
      }
    }
  }
  for (const req of requests) {
    try {
      const u = new URL(req.url);
      if (u.origin !== 'https://www.facebook.com' || u.pathname !== '/api/graphql/') continue;
    } catch (_) { continue; }
    if (!req.responseBody) continue;
    const header = parseFacebookProfileHeader(req.responseBody);
    if (!header) continue;
    const id = header.id || '';
    const username = (header.username || '').trim();
    const profileUrl = header.url || (username ? `https://www.facebook.com/${encodeURIComponent(username)}` : (id ? `https://www.facebook.com/profile.php?id=${encodeURIComponent(id)}` : ''));
    let profile = id ? byUserID.get(id) : null;
    if (!profile && username) {
      for (const [uid, p] of byUserID) {
        if ((p.userVanity || '').toLowerCase() === username.toLowerCase()) { profile = p; break; }
      }
    }
    if (!profile && profileUrl) {
      for (const p of byUserID.values()) {
        if (p.profileUrl === profileUrl) { profile = p; break; }
      }
    }
    if (!profile) {
      profile = { userID: id, userVanity: username, profileUrl, viewerID: '' };
      const key = id || profileUrl || ('h:' + (header.name || '')).trim();
      if (key && !byUserID.has(key)) byUserID.set(key, profile);
    }
    profile.name = header.name || profile.name;
    profile.username = header.username || profile.userVanity || profile.username;
    profile.gender = header.gender || profile.gender;
    profile.avatarUris = (header.avatarUris && header.avatarUris.length) ? header.avatarUris : (profile.avatarUris && profile.avatarUris.length ? profile.avatarUris : []);
    profile.coverPhotoUri = header.coverPhotoUri || profile.coverPhotoUri;
    profile.coverPhotoUrl = header.coverPhotoUrl || profile.coverPhotoUrl;
    profile.profilePhotoUrl = header.profilePhotoUrl || profile.profilePhotoUrl;
    profile.profilePhotoId = header.profilePhotoId || profile.profilePhotoId;
    profile.socialContext = header.socialContext && header.socialContext.length ? header.socialContext : profile.socialContext;
    profile.introCard = (header.introCard && (header.introCard.category || header.introCard.currentCity || header.introCard.bio || header.introCard.links.length)) ? header.introCard : (profile.introCard || { category: '', currentCity: '', currentCityUri: '', links: [], bio: '' });
    profile.tabs = header.tabs && header.tabs.length ? header.tabs : (profile.tabs || []);
    if (!profile.tabs.length && profile.routeSections && profile.routeSections.length)
      profile.tabs = profile.routeSections.map(rs => ({ name: rs.section, url: rs.url || '' })).filter(t => t.url);
  }
  const authorPicturesByID = new Map();
  for (const req of requests) {
    try {
      const u = new URL(req.url);
      if (u.origin !== 'https://www.facebook.com' || u.pathname !== '/api/graphql/') continue;
    } catch (_) { continue; }
    if (!req.responseBody) continue;
    const contentItems = parseFacebookGroupMemberFeedContent(req.responseBody);
    for (const item of contentItems) {
      const id = (item.author_id || '').trim();
      const pic = (item.author_picture || '').trim();
      if (id && pic && !authorPicturesByID.has(id)) authorPicturesByID.set(id, pic);
    }
  }
  const profileIDs = new Set([...byUserID.values()].map(p => (p.userID || '').trim()).filter(Boolean));
  for (const req of requests) {
    try {
      const u = new URL(req.url);
      if (u.origin !== 'https://www.facebook.com' || u.pathname !== '/api/graphql/') continue;
    } catch (_) { continue; }
    if (!req.responseBody) continue;
    const raw = typeof req.responseBody === 'string' ? req.responseBody : JSON.stringify(req.responseBody);
    const payloads = [];
    try {
      payloads.push(JSON.parse(raw));
    } catch (_) {
      for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try {
          payloads.push(JSON.parse(t));
        } catch (_) {}
      }
    }
    for (const data of payloads) _collectFacebookProfilePicturesFromPayload(data, profileIDs, authorPicturesByID);
  }
  for (const profile of byUserID.values()) {
    if (profile.avatarUris && profile.avatarUris.length) continue;
    if (profile.profilePhotoUrl) continue;
    const uid = (profile.userID || '').trim();
    const pic = uid ? authorPicturesByID.get(uid) : null;
    if (pic) profile.avatarUris = [pic];
  }
  return Array.from(byUserID.values());
}
function _collectFacebookProfilePicturesFromPayload(obj, profileIDs, outMap, depth = 0) {
  if (!obj || depth > 15) return;
  if (Array.isArray(obj)) {
    for (const item of obj) _collectFacebookProfilePicturesFromPayload(item, profileIDs, outMap, depth + 1);
    return;
  }
  if (typeof obj !== 'object') return;
  const id = obj.id != null ? String(obj.id) : '';
  const uri = obj.profile_picture?.uri || obj.profilePicSmall?.uri || obj.profilePicMedium?.uri || obj.profilePicLarge?.uri || obj.profile_picture_for_sticky_bar?.uri || '';
  if (id && profileIDs.has(id) && uri && !outMap.has(id)) outMap.set(id, uri);
  for (const value of Object.values(obj)) _collectFacebookProfilePicturesFromPayload(value, profileIDs, outMap, depth + 1);
}
function _facebookImageDedupeKey(uri) {
  if (!uri || typeof uri !== 'string') return '';
  try {
    const u = new URL(uri);
    return u.pathname || uri;
  } catch (_) {
    return uri;
  }
}
function _dedupeImageUris(uris) {
  if (!Array.isArray(uris) || uris.length === 0) return uris;
  const seen = new Set();
  const out = [];
  for (const u of uris) {
    if (!u || typeof u !== 'string') continue;
    const key = _facebookImageDedupeKey(u);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(u);
    }
  }
  return out;
}

function _collectImageUrisFromObject(root, add, path = '', depth = 0) {
  if (!root || depth > 8) return;
  if (Array.isArray(root)) {
    for (const item of root) _collectImageUrisFromObject(item, add, `${path}[]`, depth + 1);
    return;
  }
  if (typeof root !== 'object') return;

  for (const [key, value] of Object.entries(root)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (key === 'uri' && typeof value === 'string') {
      const p = nextPath.toLowerCase();
      const allow = /(image|photo|media|background|portrait|thumbnail|preview|attachment)/.test(p);
      const deny = /(profile_picture|avatar|actor_photo|ufi_silhouette|icon_image|darkmodeimage|lightmodeimage|animation)/.test(p);
      if (allow && !deny) add(value);
      continue;
    }
    _collectImageUrisFromObject(value, add, nextPath, depth + 1);
  }
}

function _collectStoryImageUris(story) {
  const uris = [];
  const seenKeys = new Set();
  function add(u) {
    if (!u || typeof u !== 'string') return;
    const key = _facebookImageDedupeKey(u);
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    uris.push(u);
  }
  const attachments = story.attachments;
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      add(a?.media?.image?.uri);
      add(a?.image?.uri);
      const nodes = a?.nodes;
      if (Array.isArray(nodes)) {
        for (const n of nodes) {
          add(n?.media?.image?.uri);
          add(n?.image?.uri);
        }
      }
      _collectImageUrisFromObject(a, add, 'attachments');
    }
  }
  const contentStory = story.comet_sections?.content?.story;
  if (contentStory) {
    const tfm = contentStory.text_format_metadata;
    if (tfm) {
      add(tfm.background_image?.uri);
      add(tfm.portrait_background_image?.uri);
    }
    const bg = contentStory.background || contentStory.text_format_metadata?.background;
    if (bg) {
      add(bg.image?.uri);
      add(bg.portrait_image?.uri);
    }

    const messageStory = contentStory.comet_sections?.message?.story;
    const messageContainerStory = contentStory.comet_sections?.message_container?.story;
    const messageTfm = messageStory?.text_format_metadata;
    if (messageTfm) {
      add(messageTfm.background_image?.uri);
      add(messageTfm.portrait_background_image?.uri);
      add(messageTfm.background?.image?.uri);
      add(messageTfm.background?.portrait_image?.uri);
    }
    _collectImageUrisFromObject(contentStory, add, 'content_story');
    _collectImageUrisFromObject(messageStory, add, 'message_story');
    _collectImageUrisFromObject(messageContainerStory, add, 'message_container_story');
  }
  _collectImageUrisFromObject(story.attached_story, add, 'attached_story');
  return uris;
}

function _extractNumericCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d]/g, '');
    const parsed = cleaned ? Number.parseInt(cleaned, 10) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function _collectCommentImageUris(comment) {
  const uris = [];
  const seenKeys = new Set();
  function add(u) {
    if (!u || typeof u !== 'string') return;
    const key = _facebookImageDedupeKey(u);
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);
    uris.push(u);
  }
  const attachments = comment?.attachments;
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      add(a?.media?.image?.uri);
      add(a?.image?.uri);
      const nodes = a?.nodes;
      if (Array.isArray(nodes)) {
        for (const n of nodes) {
          add(n?.media?.image?.uri);
          add(n?.image?.uri);
        }
      }
      _collectImageUrisFromObject(a, add, 'comment.attachments');
    }
  }
  return uris;
}

function _extractCommentFromInteresting(entry) {
  const c = entry?.comment;
  if (!c) return null;

  const actionLinks = Array.isArray(c.comment_action_links) ? c.comment_action_links : [];
  const linkFromActions = actionLinks.find(l => l?.comment?.url)?.comment?.url || '';
  const createdFromActions = actionLinks.find(l => l?.comment?.created_time)?.comment?.created_time;
  const feedbackFromActions = actionLinks.find(l => l?.comment?.feedback)?.comment?.feedback;
  const feedback = c.feedback || feedbackFromActions;

  const reactorsCount = _extractNumericCount(feedback?.reactors?.count)
    || _extractNumericCount(feedback?.reactors?.count_reduced)
    || _extractNumericCount(feedback?.unified_reactors?.count);
  const replyCount = _extractNumericCount(feedback?.total_reply_count);
  const commentTopReactions = Array.isArray(feedback?.top_reactions?.edges)
    ? feedback.top_reactions.edges.map(r => ({
      name: r?.node?.localized_name || '',
      count: _extractNumericCount(r?.reaction_count),
    })).filter(r => r.name || r.count > 0)
    : [];

  const interestingReply = c.inline_replies_expander_renderer?.interesting_reply;
  const replyPreview = interestingReply
    ? {
      id: interestingReply.id || '',
      author_name: interestingReply.author?.name || '',
      author_picture: interestingReply.author?.profilePictureForReplyExpander?.uri || interestingReply.author?.ufi_silhouette_uri || '',
      created_time: interestingReply.created_time || null,
    }
    : null;

  return {
    author_name: c.author?.name
      || c.comet_comment_author_name_and_badges_renderer?.comment?.user?.name
      || '',
    author_picture: c.author?.profile_picture_depth_0_increased?.uri
      || c.author?.profile_picture_depth_0?.uri
      || c.author?.profile_picture_depth_1?.uri
      || c.comet_comment_author_name_and_badges_renderer?.comment?.user?.profile_picture?.uri
      || c.author?.profile_picture?.uri
      || '',
    body: c.body?.text || c.preferred_body?.text || c.body_renderer?.text || '',
    created_time: c.created_time || createdFromActions || null,
    id: c.id || c.legacy_fbid || '',
    link: c.url || feedback?.url || linkFromActions || '',
    reaction_count: reactorsCount,
    reply_count: replyCount,
    top_reactions: commentTopReactions,
    images: _collectCommentImageUris(c),
    reply_preview: replyPreview,
  };
}

function _getStoryFeedback(story) {
  const ufi = story.comet_sections?.feedback?.story?.story_ufi_container?.story;
  const nested = ufi?.feedback_context?.feedback_target_with_context?.comet_ufi_summary_and_actions_renderer?.feedback;
  const feedback = nested || ufi?.feedback || story.comet_sections?.feedback?.story?.feedback || story.feedback;
  return feedback || ufi;
}

function _getStoryPrivacyAndLocation(story) {
  let privacy = '';
  let locationName = '';
  let locationUrl = '';
  const contextStory = story.comet_sections?.context_layout?.story;
  const meta = contextStory?.comet_sections?.metadata;
  if (Array.isArray(meta)) {
    for (const m of meta) {
      if (m?.__typename === 'CometFeedStoryAudienceStrategy' && m.story?.privacy_scope?.description) {
        privacy = m.story.privacy_scope.description;
      }
      if (m?.__typename === 'CometFeedStoryLocationStrategy' && m.story?.implicit_place) {
        const place = m.story.implicit_place;
        locationName = place.contextual_name || locationName;
        locationUrl = place.url || locationUrl;
      }
    }
  }
  return { privacy, location_name: locationName, location_url: locationUrl };
}

function _getStoryInterestingComments(story, feedback) {
  const ufi = story.comet_sections?.feedback?.story?.story_ufi_container?.story;
  return feedback?.interesting_top_level_comments
    || ufi?.interesting_top_level_comments
    || ufi?.feedback_context?.feedback_target_with_context?.interesting_top_level_comments;
}

function _getStoryCommentEntries(story, feedback) {
  const ufi = story.comet_sections?.feedback?.story?.story_ufi_container?.story;
  const nestedFeedback = ufi?.feedback_context?.feedback_target_with_context?.comet_ufi_summary_and_actions_renderer?.feedback;
  const result = [];
  const seen = new Set();

  function pushComment(comment) {
    if (!comment) return;
    const key = comment.id || comment.legacy_fbid || `${comment.author?.id || ''}|${comment.created_time || ''}|${comment.body?.text || comment.preferred_body?.text || ''}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push({ comment });
  }

  const interesting = _getStoryInterestingComments(story, feedback);
  if (Array.isArray(interesting)) {
    for (const entry of interesting) pushComment(entry?.comment);
  }

  const commentLists = [
    feedback?.comment_rendering_instance?.comments?.edges,
    feedback?.comment_rendering_instance?.comments?.nodes,
    nestedFeedback?.comment_rendering_instance?.comments?.edges,
    nestedFeedback?.comment_rendering_instance?.comments?.nodes,
    ufi?.comment_rendering_instance?.comments?.edges,
    ufi?.comment_rendering_instance?.comments?.nodes,
  ];
  for (const list of commentLists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      pushComment(entry?.comment || entry?.node || entry);
    }
  }

  return result;
}

function parseFacebookGroupMemberFeedContent(responseBody) {
  const items = [];
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const node = data?.data?.node;
    if (!node || node.__typename !== 'Group') return items;
    const edges = node.group_member_feed?.edges;
    if (!Array.isArray(edges)) return items;
    for (const edge of edges) {
      const story = edge?.node;
      if (!story || story.__typename !== 'Story') continue;
      const postId = story.post_id || story.id || '';
      const owner = story.feedback?.owning_profile;
      const authorName = owner?.name || '';
      const authorId = owner?.id ? String(owner.id) : '';
      let authorPicture = '';
      const actor0 = story.actors?.[0];
      if (actor0?.profile_picture?.uri) authorPicture = actor0.profile_picture.uri;
      if (!authorPicture && story.comet_sections?.context_layout?.story?.comet_sections?.actor_photo?.story?.actors?.[0]?.profile_picture?.uri)
        authorPicture = story.comet_sections.context_layout.story.comet_sections.actor_photo.story.actors[0].profile_picture.uri;
      let messageText = story.message?.text || '';
      if (!messageText && story.comet_sections?.content?.story) {
        const inner = story.comet_sections.content.story;
        messageText = inner?.message?.text
          || inner?.comet_sections?.message?.story?.message?.text
          || inner?.comet_sections?.message_container?.story?.message?.text
          || inner?.message_container?.story?.message?.text
          || '';
      }
      const link = story.permalink_url
        || story.wwwURL
        || story.url
        || story.comet_sections?.feedback?.story?.story_ufi_container?.story?.url
        || '';
      const group = story.to || story.target_group || story.feedback?.associated_group;
      const groupName = group?.name || '';
      const groupId = group?.id ? String(group.id) : '';
      const images = _collectStoryImageUris(story);
      const feedback = _getStoryFeedback(story);
      const commentEntries = _getStoryCommentEntries(story, feedback);
      let reactionCount = 0;
      let reactionCountI18n = '';
      let topReactions = [];
      let commentCount = 0;
      let shareCount = 0;
      let shareCountI18n = '';
      let creationTime = null;
      const comments = [];
      if (feedback) {
        reactionCount = feedback.reaction_count?.count ?? 0;
        reactionCountI18n = feedback.i18n_reaction_count || (reactionCount ? String(reactionCount) : '');
        const trEdges = feedback.top_reactions?.edges;
        if (Array.isArray(trEdges)) topReactions = trEdges.map(e => ({ name: e?.node?.localized_name || '', count: e?.reaction_count ?? 0 }));
        commentCount = feedback.comment_rendering_instance?.comments?.total_count ?? feedback.comments_count_summary_renderer?.feedback?.comment_rendering_instance?.comments?.total_count ?? 0;
        shareCount = feedback.share_count?.count ?? 0;
        shareCountI18n = feedback.i18n_share_count || (shareCount ? String(shareCount) : '');
      }
      if (Array.isArray(commentEntries)) {
        for (const entry of commentEntries) {
          const comment = _extractCommentFromInteresting(entry);
          if (comment) comments.push(comment);
        }
      }
      creationTime = story.creation_time
        ?? story.comet_sections?.context_layout?.story?.creation_time
        ?? story.comet_sections?.context_layout?.story?.comet_sections?.timestamp?.story?.creation_time
        ?? story.comet_sections?.timestamp?.story?.creation_time
        ?? null;
      const { privacy, location_name: locationName, location_url: locationUrl } = _getStoryPrivacyAndLocation(story);
      items.push({
        post_id: postId,
        story_id: story.id || '',
        author_id: authorId,
        author_name: authorName,
        author_picture: authorPicture,
        message: messageText,
        link,
        group_id: groupId,
        group_name: groupName,
        images,
        reaction_count: reactionCount,
        reaction_count_i18n: reactionCountI18n,
        top_reactions: topReactions,
        comment_count: commentCount,
        share_count: shareCount,
        share_count_i18n: shareCountI18n,
        creation_time: creationTime,
        comments,
        privacy: privacy || undefined,
        location_name: locationName || undefined,
        location_url: locationUrl || undefined,
      });
    }
  } catch (_) {}
  return items;
}
function parseFacebookTimelineFeedContent(responseBody) {
  const items = [];
  const stories = [];
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    if (raw.includes('\n')) {
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed);
          const path = chunk.path;
          const data = chunk.data;
          if (Array.isArray(path) && path.includes('timeline_list_feed_units') && path.includes('edges') && data?.node) {
            const node = data.node;
            if (node.__typename === 'Story') stories.push(node);
          }
        } catch (_) {}
      }
    } else {
      const data = JSON.parse(raw);
      const node = data?.data?.node;
      if (node && node.__typename === 'User') {
        const edges = node.timeline_list_feed_units?.edges;
        if (Array.isArray(edges)) {
          for (const edge of edges) {
            const story = edge?.node;
            if (story && story.__typename === 'Story') stories.push(story);
          }
        }
      }
    }
    for (const story of stories) {
      const postId = story.post_id || story.id || '';
      const owner = story.feedback?.owning_profile;
      const authorName = owner?.name || '';
      const authorId = owner?.id ? String(owner.id) : '';
      let authorPicture = '';
      const actor0 = story.actors?.[0];
      if (actor0?.profile_picture?.uri) authorPicture = actor0.profile_picture.uri;
      if (!authorPicture && story.comet_sections?.context_layout?.story?.comet_sections?.actor_photo?.story?.actors?.[0]?.profile_picture?.uri)
        authorPicture = story.comet_sections.context_layout.story.comet_sections.actor_photo.story.actors[0].profile_picture.uri;
      let messageText = story.message?.text || '';
      if (!messageText && story.comet_sections?.content?.story) {
        const inner = story.comet_sections.content.story;
        messageText = inner?.message?.text
          || inner?.comet_sections?.message?.story?.message?.text
          || inner?.comet_sections?.message_container?.story?.message?.text
          || inner?.message_container?.story?.message?.text
          || '';
      }
      const link = story.permalink_url || story.wwwURL || story.url
        || story.comet_sections?.feedback?.story?.story_ufi_container?.story?.url || '';
      const images = _collectStoryImageUris(story);
      const feedback = _getStoryFeedback(story);
      const commentEntries = _getStoryCommentEntries(story, feedback);
      let reactionCount = 0, reactionCountI18n = '', topReactions = [], commentCount = 0, shareCount = 0, shareCountI18n = '';
      const comments = [];
      if (feedback) {
        reactionCount = feedback.reaction_count?.count ?? 0;
        reactionCountI18n = feedback.i18n_reaction_count || (reactionCount ? String(reactionCount) : '');
        const trEdges = feedback.top_reactions?.edges;
        if (Array.isArray(trEdges)) topReactions = trEdges.map(e => ({ name: e?.node?.localized_name || '', count: e?.reaction_count ?? 0 }));
        commentCount = feedback.comment_rendering_instance?.comments?.total_count ?? feedback.comments_count_summary_renderer?.feedback?.comment_rendering_instance?.comments?.total_count ?? 0;
        shareCount = feedback.share_count?.count ?? 0;
        shareCountI18n = feedback.i18n_share_count || (shareCount ? String(shareCount) : '');
      }
      for (const entry of commentEntries || []) {
        const comment = _extractCommentFromInteresting(entry);
        if (comment) comments.push(comment);
      }
      const creationTime = story.creation_time
        ?? story.comet_sections?.context_layout?.story?.creation_time
        ?? story.comet_sections?.context_layout?.story?.comet_sections?.metadata?.[0]?.story?.creation_time
        ?? story.comet_sections?.timestamp?.story?.creation_time ?? null;
      const { privacy, location_name: locationName, location_url: locationUrl } = _getStoryPrivacyAndLocation(story);
      items.push({
        post_id: postId,
        story_id: story.id || '',
        author_id: authorId,
        author_name: authorName,
        author_picture: authorPicture,
        message: messageText,
        link,
        group_id: '',
        group_name: '',
        images,
        reaction_count: reactionCount,
        reaction_count_i18n: reactionCountI18n,
        top_reactions: topReactions,
        comment_count: commentCount,
        share_count: shareCount,
        share_count_i18n: shareCountI18n,
        creation_time: creationTime,
        comments,
        privacy: privacy || undefined,
        location_name: locationName || undefined,
        location_url: locationUrl || undefined,
      });
    }
  } catch (_) {}
  return items;
}

function _mergeFacebookTopReactions(baseList, nextList) {
  const byName = new Map();
  for (const r of (baseList || [])) {
    if (!r || !r.name) continue;
    byName.set(r.name, { name: r.name, count: _extractNumericCount(r.count) });
  }
  for (const r of (nextList || [])) {
    if (!r || !r.name) continue;
    const existing = byName.get(r.name);
    const count = _extractNumericCount(r.count);
    if (!existing) byName.set(r.name, { name: r.name, count });
    else if (count > existing.count) existing.count = count;
  }
  return Array.from(byName.values()).sort((a, b) => b.count - a.count);
}

function _mergeFacebookComments(baseComments, nextComments) {
  const byKey = new Map();
  function keyForComment(c) {
    if (!c) return '';
    if (c.id) return `id:${c.id}`;
    return `fallback:${c.author_name || ''}|${c.created_time || ''}|${c.body || ''}`;
  }
  function mergeOne(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      id: a.id || b.id || '',
      author_name: a.author_name || b.author_name || '',
      author_picture: a.author_picture || b.author_picture || '',
      body: (a.body && a.body.length >= (b.body || '').length) ? a.body : (b.body || ''),
      created_time: a.created_time || b.created_time || null,
      link: a.link || b.link || '',
      reaction_count: Math.max(_extractNumericCount(a.reaction_count), _extractNumericCount(b.reaction_count)),
      reply_count: Math.max(_extractNumericCount(a.reply_count), _extractNumericCount(b.reply_count)),
      top_reactions: _mergeFacebookTopReactions(a.top_reactions, b.top_reactions),
      images: _dedupeImageUris([...(a.images || []), ...(b.images || [])]),
      reply_preview: a.reply_preview || b.reply_preview || null,
    };
  }
  for (const c of (baseComments || [])) {
    const key = keyForComment(c);
    if (key) byKey.set(key, c);
  }
  for (const c of (nextComments || [])) {
    const key = keyForComment(c);
    if (!key) continue;
    byKey.set(key, mergeOne(byKey.get(key), c));
  }
  return Array.from(byKey.values());
}

function _mergeFacebookContentItem(base, next) {
  if (!base) return next;
  if (!next) return base;
  const mergedImages = _dedupeImageUris([...(base.images || []), ...(next.images || [])]);
  const mergedComments = _mergeFacebookComments(base.comments, next.comments);
  const reactionCount = Math.max(_extractNumericCount(base.reaction_count), _extractNumericCount(next.reaction_count));
  const shareCount = Math.max(_extractNumericCount(base.share_count), _extractNumericCount(next.share_count));
  const commentCount = Math.max(
    _extractNumericCount(base.comment_count),
    _extractNumericCount(next.comment_count),
    mergedComments.length,
  );
  return {
    post_id: base.post_id || next.post_id || '',
    story_id: base.story_id || next.story_id || '',
    author_id: base.author_id || next.author_id || '',
    author_name: base.author_name || next.author_name || '',
    author_picture: base.author_picture || next.author_picture || '',
    message: (base.message && base.message.length >= (next.message || '').length) ? base.message : (next.message || ''),
    link: base.link || next.link || '',
    group_id: base.group_id || next.group_id || '',
    group_name: base.group_name || next.group_name || '',
    images: mergedImages,
    reaction_count: reactionCount,
    reaction_count_i18n: (base.reaction_count_i18n && reactionCount === _extractNumericCount(base.reaction_count))
      ? base.reaction_count_i18n
      : (next.reaction_count_i18n || base.reaction_count_i18n || ''),
    top_reactions: _mergeFacebookTopReactions(base.top_reactions, next.top_reactions),
    comment_count: commentCount,
    share_count: shareCount,
    share_count_i18n: (base.share_count_i18n && shareCount === _extractNumericCount(base.share_count))
      ? base.share_count_i18n
      : (next.share_count_i18n || base.share_count_i18n || ''),
    creation_time: base.creation_time || next.creation_time || null,
    comments: mergedComments,
    privacy: base.privacy || next.privacy || undefined,
    location_name: base.location_name || next.location_name || undefined,
    location_url: base.location_url || next.location_url || undefined,
  };
}

function aggregateFacebookContentFromRequests(requests) {
  const byPostId = new Map();
  for (const req of requests) {
    try {
      const u = new URL(req.url);
      if (u.origin !== 'https://www.facebook.com' || u.pathname !== '/api/graphql/') continue;
    } catch (_) { continue; }
    if (!req.responseBody) continue;
    const groupList = parseFacebookGroupMemberFeedContent(req.responseBody);
    const timelineList = parseFacebookTimelineFeedContent(req.responseBody);
    for (const item of [...groupList, ...timelineList]) {
      const key = item.post_id || item.story_id;
      if (!key) continue;
      const existing = byPostId.get(key);
      byPostId.set(key, existing ? _mergeFacebookContentItem(existing, item) : item);
    }
  }
  return Array.from(byPostId.values());
}
const FACEBOOK_CDN_IMAGE_URL_RE = /https:\/\/scontent[^"'\s]*fbcdn\.net\/v\/[^"'\s)\]\}]+/g;

function collectAllFacebookCdnImageUrls(requests) {
  const urls = [];
  for (const req of requests) {
    if (!req.responseBody) continue;
    const raw = typeof req.responseBody === 'string' ? req.responseBody : JSON.stringify(req.responseBody);
    let m;
    FACEBOOK_CDN_IMAGE_URL_RE.lastIndex = 0;
    while ((m = FACEBOOK_CDN_IMAGE_URL_RE.exec(raw)) !== null) {
      urls.push(m[0]);
    }
  }
  return _dedupeImageUris(urls);
}

function buildFacebookImagesSectionHtml(imageUrls) {
  if (!imageUrls || imageUrls.length === 0) return '';
  const items = imageUrls.map(uri =>
    `<a href="${escapeHtml(uri)}" target="_blank" rel="noopener noreferrer" class="facebook-all-images-item"><img src="${escapeHtml(uri)}" alt="" loading="lazy"></a>`
  ).join('');
  return `<div class="facebook-all-images-grid">${items}</div>`;
}

function buildFacebookUserListHtml(users) {
  const listHtml = users.map(u => {
    const avatarHtml = u.img_url
      ? `<img class="facebook-user-avatar" src="${escapeHtml(u.img_url)}" alt="" loading="lazy">`
      : `<div class="facebook-user-avatar-placeholder">?</div>`;
    const metaParts = [u.snippet || '', u.type || ''].filter(Boolean);
    const metaStr = metaParts.length ? metaParts.join(' · ') : (u.ent_id ? `ID: ${u.ent_id}` : '');
    const linkHtml = u.link_url
      ? `<a href="${escapeHtml(u.link_url)}" target="_blank" rel="noopener" class="facebook-user-link">${escapeHtml(u.link_url)}</a>`
      : '';
    return `<li class="facebook-user-item">
      ${avatarHtml}
      <div class="facebook-user-info">
        <div class="facebook-user-name">${escapeHtml(u.title || u.keyword_text || 'Unknown')}</div>
        ${metaStr ? `<div class="facebook-user-meta">${escapeHtml(metaStr)}</div>` : ''}
        ${linkHtml}
      </div>
    </li>`;
  }).join('');
  return `<ul class="facebook-user-list">${listHtml}</ul>`;
}

function buildFacebookAdListHtml(ads) {
  const listHtml = ads.map(ad => {
    const actorImg = ad.actor_picture_uri
      ? `<img class="facebook-ad-actor-pic" src="${escapeHtml(ad.actor_picture_uri)}" alt="" loading="lazy">`
      : `<div class="facebook-ad-actor-placeholder">?</div>`;
    const adImg = ad.image_uri
      ? `<img class="facebook-ad-image" src="${escapeHtml(ad.image_uri)}" alt="" loading="lazy">`
      : '';
    const linkUrl = ad.web_link_url || ad.target_url || '';
    const linkHtml = linkUrl
      ? `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener" class="facebook-ad-link">${escapeHtml(linkUrl)}</a>`
      : '';
    const metaParts = [];
    if (ad.subtitle) metaParts.push(escapeHtml(ad.subtitle));
    if (ad.ad_id) metaParts.push(`Ad ID: ${escapeHtml(ad.ad_id)}`);
    const metaStr = metaParts.length ? metaParts.join(' · ') : '';
    return `<li class="facebook-ad-item">
      <div class="facebook-ad-actor-row">
        ${actorImg}
        <div class="facebook-ad-actor-info">
          <div class="facebook-ad-actor-name">${escapeHtml(ad.actor_name || 'Advertiser')}</div>
          ${metaStr ? `<div class="facebook-ad-meta">${metaStr}</div>` : ''}
        </div>
      </div>
      ${adImg}
      <div class="facebook-ad-title">${escapeHtml(ad.title || '')}</div>
      ${ad.description ? `<div class="facebook-ad-description">${escapeHtml(ad.description)}</div>` : ''}
      ${linkHtml}
    </li>`;
  }).join('');
  return `<ul class="facebook-ad-list">${listHtml}</ul>`;
}

function buildFacebookProfileListHtml(profiles) {
  const listHtml = profiles.map(p => {
    const typeLabel = p.isGroup ? 'Group' : p.isPlace ? 'Place' : '';
    const displayName = (p.name || p.userVanity || p.userID || 'Unknown').trim();
    const profileUrl = (p.profileUrl || (p.username ? `https://www.facebook.com/${encodeURIComponent(p.username)}` : '')).trim();
    const linkHtml = profileUrl ? `<a href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener" class="facebook-user-link">${escapeHtml(profileUrl)}</a>` : '';
    const avatarUris = p.avatarUris && Array.isArray(p.avatarUris) ? p.avatarUris : [];
    const profilePhotoUrl = (p.profilePhotoUrl || '').trim();
    const coverPhotoUri = (p.coverPhotoUri || '').trim();
    const avatarUri = avatarUris[0] || (avatarUris.length && avatarUris[avatarUris.length - 1]) || profilePhotoUrl || coverPhotoUri;
    const avatarHtml = avatarUri
      ? `<img class="facebook-user-avatar" src="${escapeHtml(avatarUri)}" alt="" loading="lazy">`
      : `<div class="facebook-user-avatar-placeholder">👤</div>`;
    const parts = [];
    if (p.userID) parts.push(`ID: ${escapeHtml(p.userID)}`);
    if (p.username) parts.push(`@${escapeHtml(p.username)}`);
    if (p.gender) parts.push(escapeHtml(p.gender));
    if (p.viewerID) parts.push(`Viewer: ${escapeHtml(p.viewerID)}`);
    const metaStr = parts.length ? parts.join(' · ') : '';

    let body = '';
    const socialContext = p.socialContext && Array.isArray(p.socialContext) ? p.socialContext : [];
    if (socialContext.length) {
      const scParts = socialContext.map(sc => {
        const text = (sc.text || '').trim();
        const uri = (sc.uri || '').trim();
        if (uri && text) return `<a href="${escapeHtml(uri)}" target="_blank" rel="noopener" style="margin-right:8px;">${escapeHtml(text)}</a>`;
        return text ? escapeHtml(text) : '';
      }).filter(Boolean);
      if (scParts.length) body += `<div class="facebook-profile-social">${scParts.join('')}</div>`;
    }
    const intro = p.introCard || {};
    if (intro.category) body += `<div class="facebook-profile-intro">Category: ${escapeHtml(intro.category)}</div>`;
    if (intro.currentCity) {
      const cityLink = intro.currentCityUri
        ? `<a href="${escapeHtml(intro.currentCityUri)}" target="_blank" rel="noopener">${escapeHtml(intro.currentCity)}</a>`
        : escapeHtml(intro.currentCity);
      body += `<div class="facebook-profile-intro">Location: ${cityLink}</div>`;
    }
    const links = intro.links && Array.isArray(intro.links) ? intro.links : [];
    links.forEach(link => {
      const label = (link.label || link.url || '').trim();
      const url = (link.url || '').trim();
      if (url) body += `<div class="facebook-profile-intro">Link: <a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(label || url)}</a></div>`;
      else if (label) body += `<div class="facebook-profile-intro">${escapeHtml(label)}</div>`;
    });
    if (intro.bio) body += `<div class="facebook-profile-bio">${escapeHtml(intro.bio)}</div>`;

    let tabs = p.tabs && Array.isArray(p.tabs) ? p.tabs : [];
    if (!tabs.length && p.routeSections && Array.isArray(p.routeSections))
      tabs = p.routeSections.map(rs => ({ name: rs.section, url: rs.url || '' })).filter(t => t.url);
    if (tabs.length) {
      const tabLinks = tabs.slice(0, 16).map(t => (t.url && t.name) ? `<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" style="font-size:11px;margin-right:6px;">${escapeHtml(t.name)}</a>` : '').filter(Boolean);
      if (tabLinks.length) body += `<div class="facebook-profile-tabs">${tabLinks.join('')}</div>`;
    }

    const coverUri = p.coverPhotoUri || '';
    const coverUrl = p.coverPhotoUrl || '';
    let imagesBlock = '';
    const allPics = [...avatarUris];
    if (profilePhotoUrl && !allPics.includes(profilePhotoUrl)) allPics.push(profilePhotoUrl);
    if (coverUri && !allPics.includes(coverUri)) allPics.push(coverUri);
    if (allPics.length) {
      imagesBlock = `<div class="facebook-profile-images">${allPics.map(uri => `<a href="${escapeHtml(uri)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(uri)}" alt="" loading="lazy" style="max-width:80px;max-height:80px;object-fit:cover;margin:2px;"></a>`).join('')}</div>`;
    }
    if (coverUrl && !coverUri) imagesBlock += `<div class="facebook-profile-cover"><a href="${escapeHtml(coverUrl)}" target="_blank" rel="noopener">Cover photo</a></div>`;

    return `<li class="facebook-user-item facebook-profile-item">
      ${avatarHtml}
      <div style="flex:1;min-width:0;">
        <div class="facebook-user-name">${escapeHtml(displayName)}${typeLabel ? ` <span style="font-size:10px;opacity:0.8;">(${escapeHtml(typeLabel)})</span>` : ''}</div>
        ${metaStr ? `<div class="facebook-user-meta">${metaStr}</div>` : ''}
        ${body}
        ${imagesBlock}
        ${linkHtml}
      </div>
    </li>`;
  }).join('');
  return `<ul class="facebook-user-list facebook-profile-list">${listHtml}</ul>`;
}

function buildFacebookContentListHtml(items) {
  const listHtml = items.map(item => {
    const metaParts = [];
    if (item.author_name) metaParts.push(escapeHtml(item.author_name));
    if (item.group_name) metaParts.push(escapeHtml(item.group_name));
    const metaStr = metaParts.length ? metaParts.join(' · ') : '';
    const authorAvatar = item.author_picture
      ? `<img class="facebook-content-author-pic" src="${escapeHtml(item.author_picture)}" alt="" loading="lazy">`
      : '<div class="facebook-content-author-pic-placeholder">?</div>';
    const messageFull = (item.message || '').trim();
    const messageHtml = messageFull ? `<div class="facebook-content-message">${escapeHtml(messageFull)}</div>` : '';
    const imageUris = item.images && item.images.length ? item.images : [];
    const imagesHtml = imageUris.length
      ? `<div class="facebook-content-images">
          ${imageUris.map(uri => `<img class="facebook-content-embed-image" src="${escapeHtml(uri)}" alt="" loading="lazy">`).join('')}
        </div>`
      : '';
    const reactionParts = [];
    if (item.reaction_count != null && item.reaction_count > 0) reactionParts.push((item.reaction_count_i18n || item.reaction_count) + ' likes');
    if (item.comment_count != null && item.comment_count > 0) reactionParts.push(item.comment_count + ' comment' + (item.comment_count !== 1 ? 's' : ''));
    if (item.share_count != null && item.share_count > 0) reactionParts.push((item.share_count_i18n || item.share_count) + ' share' + (item.share_count !== 1 ? 's' : ''));
    const topReactionNames = (item.top_reactions || []).slice(0, 5).map(r => r.name).filter(Boolean);
    const engagementStr = reactionParts.length ? reactionParts.join(' · ') : '';
    const engagementHtml = engagementStr
      ? `<div class="facebook-content-engagement">${escapeHtml(engagementStr)}${topReactionNames.length ? ' <span class="facebook-content-reactions">' + escapeHtml(topReactionNames.join(', ')) + '</span>' : ''}</div>`
      : '';
    let creationStr = '';
    if (item.creation_time != null && item.creation_time > 0) {
      try {
        const d = new Date(item.creation_time * 1000);
        creationStr = d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
      } catch (_) {}
    }
    const timeHtml = creationStr ? `<div class="facebook-content-time">${escapeHtml(creationStr)}</div>` : '';
    const privacyLocationParts = [];
    if (item.privacy) privacyLocationParts.push(escapeHtml(item.privacy));
    if (item.location_name) {
      const locLink = item.location_url
        ? `<a href="${escapeHtml(item.location_url)}" target="_blank" rel="noopener">${escapeHtml(item.location_name)}</a>`
        : escapeHtml(item.location_name);
      privacyLocationParts.push(locLink);
    }
    const privacyLocationHtml = privacyLocationParts.length
      ? `<div class="facebook-content-privacy-location" style="font-size:11px;opacity:0.85;margin-top:2px;">${privacyLocationParts.join(' · ')}</div>`
      : '';
    const commentsHtml = (item.comments || []).length
      ? `<div class="facebook-content-comments">
          <div class="facebook-content-comments-title">Comments</div>
          ${(item.comments || []).map(c => {
            const cAvatar = c.author_picture
              ? `<img class="facebook-content-comment-pic" src="${escapeHtml(c.author_picture)}" alt="" loading="lazy">`
              : '<div class="facebook-content-comment-pic-placeholder">?</div>';
            const cTime = c.created_time ? (() => { try { return new Date(c.created_time * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); } catch (_) { return ''; } })() : '';
            const cMetaParts = [];
            if (c.reaction_count != null && c.reaction_count > 0) cMetaParts.push(`${c.reaction_count} like${c.reaction_count === 1 ? '' : 's'}`);
            if (c.reply_count != null && c.reply_count > 0) cMetaParts.push(`${c.reply_count} repl${c.reply_count === 1 ? 'y' : 'ies'}`);
            const cMeta = cMetaParts.length ? `<div class="facebook-content-comment-engagement">${escapeHtml(cMetaParts.join(' · '))}</div>` : '';
            const cImages = Array.isArray(c.images) ? c.images : [];
            const cImagesHtml = cImages.length
              ? `<div class="facebook-content-comment-images">${cImages.map(uri => `<img class="facebook-content-comment-embed-image" src="${escapeHtml(uri)}" alt="" loading="lazy">`).join('')}</div>`
              : '';
            const cLinkHtml = c.link
              ? `<a href="${escapeHtml(c.link)}" target="_blank" rel="noopener" class="facebook-content-comment-link">View comment</a>`
              : '';
            const replyPreview = c.reply_preview;
            const replyPreviewText = replyPreview
              ? (() => {
                let when = '';
                if (replyPreview.created_time) {
                  try {
                    when = new Date(replyPreview.created_time * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
                  } catch (_) {}
                }
                const who = replyPreview.author_name || 'Someone';
                return `Reply preview: ${who}${when ? ` · ${when}` : ''}`;
              })()
              : '';
            const replyPreviewHtml = replyPreviewText
              ? `<div class="facebook-content-inline-reply">${escapeHtml(replyPreviewText)}</div>`
              : '';
            return `<div class="facebook-content-comment">
              ${cAvatar}
              <div class="facebook-content-comment-body">
                <span class="facebook-content-comment-author">${escapeHtml(c.author_name || 'Unknown')}</span>
                ${cTime ? `<span class="facebook-content-comment-time">${escapeHtml(cTime)}</span>` : ''}
                <div class="facebook-content-comment-text">${escapeHtml(c.body || '')}</div>
                ${cImagesHtml}
                ${cMeta}
                ${replyPreviewHtml}
                ${cLinkHtml}
              </div>
            </div>`;
          }).join('')}
        </div>`
      : '';
    const linkHtml = item.link
      ? `<a href="${escapeHtml(item.link)}" target="_blank" rel="noopener" class="facebook-content-permalink">View post</a>`
      : '';
    return `<li class="facebook-content-item">
      <div class="facebook-content-header">
        ${authorAvatar}
        <div class="facebook-content-header-info">
          <div class="facebook-content-meta">${metaStr}</div>
          ${timeHtml}
          ${privacyLocationHtml}
        </div>
      </div>
      ${messageHtml}
      ${imagesHtml}
      ${engagementHtml}
      ${commentsHtml}
      ${linkHtml}
    </li>`;
  }).join('');
  return `<ul class="facebook-content-list">${listHtml}</ul>`;
}

function buildFacebookDropdownSection(title, contentHtml, openByDefault = true) {
  const openClass = openByDefault ? ' open' : '';
  return `<div class="facebook-panel-dropdown${openClass}">
    <div class="facebook-panel-dropdown-header">${escapeHtml(title)}<span class="facebook-panel-dropdown-chevron">▼</span></div>
    <div class="facebook-panel-dropdown-content">${contentHtml}</div>
  </div>`;
}

function renderFacebookTab(requests) {
  const container = document.getElementById('requestsContainer');

  const facebookRequests = requests.filter(req => {
    if (!activeTabDomain || !isFacebookDomain(activeTabDomain)) return false;
    try {
      const u = new URL(req.url);
      if (u.origin !== 'https://www.facebook.com') return false;
      return u.pathname === '/api/graphql/' || u.pathname === '/ajax/bulk-route-definitions/';
    } catch (_) {}
    return false;
  });

  const users = aggregateFacebookDataFromRequests(facebookRequests);
  const profiles = aggregateFacebookProfilesFromRequests(facebookRequests);
  const content = aggregateFacebookContentFromRequests(facebookRequests);
  const allImages = collectAllFacebookCdnImageUrls(facebookRequests);
  const signature = users.map(u => u.ent_id).sort().join(',') + '|' + profiles.map(p => p.userID).sort().join(',') + '|' + content.map(c => c.post_id).sort().join(',') + '|' + allImages.length + '|' + (allImages[0] || '');
  if (signature === lastFacebookDataSignature) return;
  lastFacebookDataSignature = signature;

  const onFacebook = isFacebookDomain(activeTabDomain);
  const hasAny = users.length > 0 || profiles.length > 0 || content.length > 0 || allImages.length > 0;
  if (!hasAny) {
    container.innerHTML = `
      <div class="facebook-panel">
        <div class="facebook-empty">
          ${onFacebook
            ? 'No Facebook data captured yet.<br>Use search, browse, profiles, or the home feed on facebook.com (GraphQL and bulk-route-definitions).'
            : 'Open Facebook (facebook.com) in this tab and browse profiles or the feed to capture people and profile data.'}
        </div>
      </div>`;
    return;
  }

  const emptySection = (msg) => `<div class="facebook-empty-section">${escapeHtml(msg)}</div>`;
  let sectionsHtml =
    buildFacebookDropdownSection(
      'People / Friends',
      users.length ? buildFacebookUserListHtml(users) : emptySection('No people captured.')
    ) +
    buildFacebookDropdownSection(
      'Profiles',
      profiles.length ? buildFacebookProfileListHtml(profiles) : emptySection('No profiles captured.')
    ) +
    buildFacebookDropdownSection(
      'Profile content / Posts',
      content.length ? buildFacebookContentListHtml(content) : emptySection('No profile or group feed posts captured.')
    ) +
    buildFacebookDropdownSection(
      'Images',
      allImages.length ? buildFacebookImagesSectionHtml(allImages) : emptySection('No Facebook CDN images captured.')
    );
  container.innerHTML = `<div class="facebook-panel">${sectionsHtml}</div>`;

  container.querySelectorAll('.facebook-panel-dropdown').forEach(el => {
    const header = el.querySelector('.facebook-panel-dropdown-header');
    if (header) {
      header.addEventListener('click', () => {
        el.classList.toggle('open');
      });
    }
  });
}

