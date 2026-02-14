
function isPinterestDomain(host) {
  if (!host) return false;
  return host === 'pinterest.com' || host === 'www.pinterest.com' || host.endsWith('.pinterest.com');
}function getPinterestImageSignature(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const path = new URL(url).pathname || '';
    const parts = path.split('/').filter(Boolean);
    if (parts.length < 2) return path || url;
    return parts.slice(1).join('/');
  } catch (_) {
    return url;
  }
}function getPinterestImageSizePriority(url) {
  if (!url || typeof url !== 'string') return 0;
  try {
    const path = new URL(url).pathname || '';
    const parts = path.split('/').filter(Boolean);
    const sizeSegment = parts[0] || '';
    if (sizeSegment === 'originals') return 99999;
    const m = sizeSegment.match(/^(\d+)x$/);
    return m ? parseInt(m[1], 10) : 0;
  } catch (_) {
    return 0;
  }
}function dedupePinterestImagesByLargest(images) {
  if (!Array.isArray(images) || images.length === 0) return images;
  const bySig = new Map();
  images.forEach(img => {
    if (!img || !img.url) return;
    const sig = getPinterestImageSignature(img.url);
    if (!sig) return;
    const priority = getPinterestImageSizePriority(img.url);
    const existing = bySig.get(sig);
    if (!existing || priority > getPinterestImageSizePriority(existing.url)) {
      bySig.set(sig, img);
    }
  });
  return Array.from(bySig.values());
}function getPinterestResourceData(responseBody) {
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const root = JSON.parse(raw);
    const rr = root && root.resource_response;
    if (!rr) return null;
    const data = Array.isArray(rr.data) ? rr.data : (rr.resource_response && Array.isArray(rr.resource_response.data) ? rr.resource_response.data : null);
    const clientContext = root.client_context || rr.client_context || null;
    return data != null ? { data, clientContext } : null;
  } catch (_) { return null; }
}function collectPinterestImageUrls(obj, out) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach(item => {
      if (item && typeof item === 'object' && typeof item.url === 'string') {
        out.push({ url: item.url, width: item.width, height: item.height, dominant_color: item.dominant_color });
      }
    });
    return;
  }
  ['images', 'contextual_pin_image_urls', 'recent_pin_images', 'cover_images', 'best_pins_images'].forEach(k => {
    const val = obj[k];
    if (val && typeof val === 'object') {
      if (Array.isArray(val)) {
        collectPinterestImageUrls(val, out);
      } else {
        Object.values(val).forEach(v => {
          if (v && typeof v === 'object') {
            if (Array.isArray(v)) collectPinterestImageUrls(v, out);
            else if (v.url) out.push({ url: v.url, width: v.width, height: v.height, dominant_color: v.dominant_color });
          }
        });
      }
    }
  });
}function normalizePinterestPin(item) {
  if (!item || typeof item !== 'object') return null;
  const id = item.id || '';
  const node_id = item.node_id || '';
  const title = (item.title || item.grid_title || '').trim();
  const description = (item.description || '').trim();
  const link = item.link || item.ad_destination_url || '';
  const domain = item.domain || '';
  const created_at = item.created_at || '';
  
  const pinner = item.pinner ? normalizePinterestUser(item.pinner) : (item.native_creator ? normalizePinterestUser(item.native_creator) : null);
  const board = item.board ? {
    id: item.board.id,
    name: item.board.name,
    url: item.board.url,
    owner: item.board.owner ? normalizePinterestUser(item.board.owner) : null,
    pin_count: item.board.pin_count
  } : null;

  const images = [];
  collectPinterestImageUrls(item, images);
  const uniqueImages = dedupePinterestImagesByLargest(images);

  return {
    id, node_id, title, description, link, domain, created_at,
    pinner, board, images: uniqueImages,
    type: item.type
  };
}function normalizePinterestUser(u) {
  if (!u || typeof u !== 'object') return null;
  const id = u.id != null ? String(u.id) : '';
  const node_id = u.node_id || '';
  const username = (u.username || '').trim();
  const full_name = (u.full_name || u.first_name || '').trim();
  const image_large_url = u.image_large_url || u.image_small_url || u.image_medium_url || u.image_xlarge_url || '';
  return {
    id,
    node_id,
    username,
    full_name,
    image_large_url,
    contextual_pin_image_urls: u.contextual_pin_image_urls || {},
    recent_pin_images: u.recent_pin_images || {},
    is_default_image: !!u.is_default_image,
  };
}function normalizePinterestConversation(item) {
  if (!item || typeof item !== 'object') return null;
  const node_id = item.node_id || '';
  const unread = item.unread != null ? item.unread : 0;
  const last_message = item.last_message;
  let messageText = '';
  let created_ms = null;
  let created_at = '';
  let sender = null;
  if (last_message && typeof last_message === 'object') {
    messageText = (last_message.text || '').trim();
    created_ms = last_message.created_ms;
    created_at = last_message.created_at || '';
    if (last_message.sender) sender = normalizePinterestUser(last_message.sender);
  }
  const users = Array.isArray(item.users) ? item.users.map(normalizePinterestUser).filter(Boolean) : [];
  return {
    node_id,
    unread,
    id: item.id,
    type: item.type,
    name: item.name,
    created_at: item.created_at || '',
    last_message: { text: messageText, created_ms, created_at, sender },
    users,
  };
}

function aggregatePinterestFromRequests(requests) {
  const conversations = [];
  const pins = [];
  const usersById = new Map();
  const allImages = [];

  requests.forEach(req => {
    if (!req.responseBody) return;
    const parsed = getPinterestResourceData(req.responseBody);
    if (!parsed || !Array.isArray(parsed.data)) return;

    parsed.data.forEach(item => {      if ((item.type === 'pin' || item.images) && !item.is_promoted) {
        const pin = normalizePinterestPin(item);
        if (pin && pin.images.length > 0) {
          pins.push(pin);
          if (pin.pinner && pin.pinner.id) usersById.set(pin.pinner.id, pin.pinner);
          if (pin.board && pin.board.owner && pin.board.owner.id) usersById.set(pin.board.owner.id, pin.board.owner);
          pin.images.forEach(img => allImages.push(img));
        }
      }      if (item.type === 'conversation' || (item.last_message && item.users)) {
        const conv = normalizePinterestConversation(item);
        if (conv) {
          const sender = conv.last_message && conv.last_message.sender;
          const senderName = sender ? (sender.full_name || sender.username || 'Unknown') : 'Unknown';
          const images = [];
          collectPinterestImageUrls(item, images);
          const hasContent = conv.last_message.text || conv.users.length > 0 || images.length > 0;          if (senderName === 'Unknown' && !hasContent) {          } else {
            conversations.push(conv);
            if (sender && sender.id) usersById.set(sender.id, sender);
            conv.users.forEach(u => { if (u && u.id) usersById.set(u.id, u); });
            images.forEach(img => allImages.push(img));
          }
        }
      }      if (item.type === 'user') {
        const u = normalizePinterestUser(item);
        if (u && u.id) usersById.set(u.id, u);
      }      collectPinterestImageUrls(item, allImages);
    });
  });  const dedupedImages = dedupePinterestImagesByLargest(allImages);  const uniqueConversations = [];
  const seenConv = new Set();
  conversations.forEach(c => {
    const key = c.node_id || c.id;
    if (key && !seenConv.has(key)) {
      seenConv.add(key);
      uniqueConversations.push(c);
    }
  });

  const uniquePins = [];
  const seenPins = new Set();
  pins.forEach(p => {
    const key = p.node_id || p.id;
    if (key && !seenPins.has(key)) {
      seenPins.add(key);
      uniquePins.push(p);
    }
  });

  return {
    conversations: uniqueConversations,
    pins: uniquePins,
    users: Array.from(usersById.values()),
    allImages: dedupedImages,
  };
}

function buildPinterestDropdownSection(title, contentHtml, openByDefault = true) {
  const openClass = openByDefault ? ' open' : '';
  return `<div class="pinterest-panel-dropdown${openClass}">
    <div class="pinterest-panel-dropdown-header">${escapeHtml(title)}<span class="pinterest-panel-dropdown-chevron">▼</span></div>
    <div class="pinterest-panel-dropdown-content">${contentHtml}</div>
  </div>`;
}

function buildPinterestConversationHtml(conv) {
  const lm = conv.last_message || {};
  const sender = lm.sender;
  const senderName = sender ? (sender.full_name || sender.username || 'Unknown') : 'Unknown';
  const senderUsername = sender && sender.username ? `@${escapeHtml(sender.username)}` : '';
  const avatarUrl = sender && sender.image_large_url ? sender.image_large_url : '';
  const avatarHtml = avatarUrl
    ? `<img class="pinterest-user-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy">`
    : `<div class="pinterest-user-avatar-placeholder">?</div>`;
  const timeStr = lm.created_at || (lm.created_ms != null ? new Date(lm.created_ms).toLocaleString() : '');
  const textHtml = lm.text ? `<div class="pinterest-message-text">${escapeHtml(lm.text)}</div>` : '';

  const pinImages = [];
  collectPinterestImageUrls(conv, pinImages);
  if (sender) collectPinterestImageUrls(sender, pinImages);
  const uniqueImages = dedupePinterestImagesByLargest(pinImages);
  const uniqueUrls = uniqueImages.map(img => img.url);

  const imagesHtml = uniqueUrls.length
    ? `<div class="pinterest-images-grid">${uniqueUrls.slice(0, 12).map(url =>
        `<span class="pinterest-image-wrap"><img src="${escapeHtml(url)}" alt="" loading="lazy"></span>`
      ).join('')}</div>`
    : '';

  return `<li class="pinterest-conversation-item">
    <div class="pinterest-message-header">${avatarHtml}
      <div class="pinterest-message-meta">
        <div class="pinterest-message-author">${escapeHtml(senderName)}</div>
        ${senderUsername ? `<div class="pinterest-message-username">${senderUsername}</div>` : ''}
        ${timeStr ? `<div class="pinterest-message-time">${escapeHtml(timeStr)}</div>` : ''}
      </div>
    </div>
    ${textHtml}
    ${imagesHtml}
  </li>`;
}

function buildPinterestPinHtml(pin) {
  const title = pin.title || 'Untitled Pin';
  const desc = pin.description || '';
  const images = pin.images || [];
  const mainImage = images.find(img => img.url.includes('/originals/')) || images[0] || {};
  const thumbnails = images.slice(0, 12);
  
  const pinner = pin.pinner;
  const pinnerName = pinner ? (pinner.full_name || pinner.username || 'Unknown') : 'Unknown';
  const pinnerAvatar = pinner && pinner.image_large_url ? pinner.image_large_url : '';
  
  const board = pin.board;
  const boardName = board ? board.name : '';
  const boardUrl = board && board.url ? `https://www.pinterest.com${board.url}` : '';

  return `<li class="pinterest-pin-item">
    <div class="pinterest-pin-main">
      <div class="pinterest-pin-image-container">
        <img class="pinterest-pin-image" src="${escapeHtml(mainImage.url || '')}" alt="" loading="lazy">
      </div>
      <div class="pinterest-pin-content">
        <div class="pinterest-pin-title">${escapeHtml(title)}</div>
        ${desc ? `<div class="pinterest-pin-description">${escapeHtml(desc)}</div>` : ''}
        
        <div class="pinterest-pin-meta">
          ${pinner ? `
            <div class="pinterest-pin-pinner">
              ${pinnerAvatar ? `<img class="pinterest-pin-avatar" src="${escapeHtml(pinnerAvatar)}" alt="">` : ''}
              <span>${escapeHtml(pinnerName)}</span>
            </div>
          ` : ''}
          ${boardName ? `
            <div class="pinterest-pin-board">
              <span>Saved to </span>
              <a href="${escapeHtml(boardUrl)}" target="_blank" rel="noopener">${escapeHtml(boardName)}</a>
            </div>
          ` : ''}
        </div>
        
        ${pin.link ? `<a href="${escapeHtml(pin.link)}" target="_blank" rel="noopener" class="pinterest-pin-link">${escapeHtml(pin.domain || 'View Link')}</a>` : ''}
      </div>
    </div>
    ${thumbnails.length > 1 ? `
      <div class="pinterest-images-grid">
        ${thumbnails.map(img => `<span class="pinterest-image-wrap"><img src="${escapeHtml(img.url)}" alt="" loading="lazy"></span>`).join('')}
      </div>
    ` : ''}
  </li>`;
}

function buildPinterestUserHtml(user) {
  const avatarUrl = user.image_large_url || '';
  const avatarHtml = avatarUrl
    ? `<img class="pinterest-user-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy">`
    : `<div class="pinterest-user-avatar-placeholder">?</div>`;
  const name = user.full_name || user.username || user.id || 'Unknown';
  const username = user.username ? `@${escapeHtml(user.username)}` : '';
  const profileUrl = user.username ? `https://www.pinterest.com/${encodeURIComponent(user.username)}/` : '';
  const linkHtml = profileUrl ? `<a href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener" class="pinterest-link">View profile</a>` : '';

  const pinImages = [];
  collectPinterestImageUrls(user, pinImages);
  const uniqueImages = dedupePinterestImagesByLargest(pinImages);
  const uniqueUrls = uniqueImages.map(img => img.url);

  const imagesHtml = uniqueUrls.length
    ? `<div class="pinterest-images-grid">${uniqueUrls.slice(0, 12).map(url =>
        `<span class="pinterest-image-wrap"><img src="${escapeHtml(url)}" alt="" loading="lazy"></span>`
      ).join('')}</div>`
    : '';

  return `<li class="pinterest-user-item">
    ${avatarHtml}
    <div class="pinterest-user-info">
      <div class="pinterest-user-name">${escapeHtml(name)}</div>
      ${username ? `<div class="pinterest-user-username">${username}</div>` : ''}
      ${linkHtml}
      ${imagesHtml}
    </div>
  </li>`;
}

function buildPinterestImagesSection(images) {
  if (!images.length) return '';
  return `<div class="pinterest-all-images-section">
    <div class="pinterest-all-images-grid">${images.slice(0, 100).map(img =>
      `<span class="pinterest-all-images-item"><img src="${escapeHtml(img.url)}" alt="" loading="lazy" title="${escapeHtml((img.width && img.height) ? `${img.width}×${img.height}` : '')}"></span>`
    ).join('')}</div>
  </div>`;
}

function renderPinterestTab(requests) {
  const container = document.getElementById('requestsContainer');

  const pinterestRequests = requests.filter(req => {
    if (!activeTabDomain || !isPinterestDomain(activeTabDomain)) return false;
    try {
      const u = new URL(req.url);
      const host = u.hostname || '';
      if (isPinterestDomain(host) || host === 'pinimg.com' || host.endsWith('.pinimg.com')) return true;
    } catch (_) {}
    return false;
  });

  const { conversations, pins, users, allImages } = aggregatePinterestFromRequests(pinterestRequests);
  const signature = [
    conversations.map(c => (c.node_id || c.id) + (c.last_message && c.last_message.text || '')).join(','),
    pins.map(p => (p.node_id || p.id) + p.title).join(','),
    users.map(u => u.id + u.username).join(','),
    allImages.length,
  ].join(';');
  if (signature === lastPinterestDataSignature) return;
  lastPinterestDataSignature = signature;

  const onPinterest = isPinterestDomain(activeTabDomain);
  if (conversations.length === 0 && pins.length === 0 && users.length === 0 && allImages.length === 0) {
    container.innerHTML = `
      <div class="pinterest-panel">
        <div class="pinterest-empty">
          ${onPinterest
            ? 'No Pinterest data captured yet.<br>Open pins, browse your home feed, or check messages on pinterest.com to capture data.'
            : 'Open Pinterest (pinterest.com) in this tab, then browse pins or open messages to capture data.'}
        </div>
      </div>`;
    return;
  }

  const emptySection = (msg) => `<div class="pinterest-empty-section">${escapeHtml(msg)}</div>`;
  let sectionsHtml = '';  if (pins.length) {
    sectionsHtml += buildPinterestDropdownSection(
      `Pins (${pins.length})`,
      `<ul class="pinterest-pin-list">${pins.map(p => buildPinterestPinHtml(p)).join('')}</ul>`,
      true
    );
  } else {
    sectionsHtml += buildPinterestDropdownSection('Pins', emptySection('No pins captured.'), false);
  }  if (conversations.length) {
    sectionsHtml += buildPinterestDropdownSection(
      `Conversations (${conversations.length})`,
      `<ul class="pinterest-conversation-list">${conversations.map(c => buildPinterestConversationHtml(c)).join('')}</ul>`,
      true
    );
  } else {
    sectionsHtml += buildPinterestDropdownSection('Conversations', emptySection('No conversations captured.'), false);
  }  if (users.length) {
    sectionsHtml += buildPinterestDropdownSection(
      `Users (${users.length})`,
      `<ul class="pinterest-user-list">${users.map(u => buildPinterestUserHtml(u)).join('')}</ul>`,
      true
    );
  } else {
    sectionsHtml += buildPinterestDropdownSection('Users', emptySection('No users captured.'), false);
  }  if (allImages.length) {
    sectionsHtml += buildPinterestDropdownSection(
      `All Images (${allImages.length})`,
      buildPinterestImagesSection(allImages),
      true
    );
  } else {
    sectionsHtml += buildPinterestDropdownSection('All images', emptySection('No images captured.'), false);
  }

  container.innerHTML = `<div class="pinterest-panel">${sectionsHtml}</div>`;

  container.querySelectorAll('.pinterest-panel-dropdown').forEach(el => {
    const header = el.querySelector('.pinterest-panel-dropdown-header');
    if (header) {
      header.addEventListener('click', () => {
        el.classList.toggle('open');
      });
    }
  });

  container.querySelectorAll('.pinterest-panel-dropdown img').forEach(img => {
    img.addEventListener('click', () => {
      const url = img.src;
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create)
          chrome.tabs.create({ url });
        else
          window.open(url, '_blank', 'noopener');
      } catch (_) {
        window.open(url, '_blank', 'noopener');
      }
    });
  });
}

