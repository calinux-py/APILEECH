
function isDiscordDomain(host) {
  if (!host) return false;
  return host === 'discord.com' || host === 'www.discord.com' || host.endsWith('.discord.com');
}

const DISCORD_CDN_AVATAR = 'https://cdn.discordapp.com/avatars';

function discordAvatarUrl(userId, avatarHash, animated) {
  if (!userId || !avatarHash) return '';
  const ext = animated && String(avatarHash).startsWith('a_') ? 'gif' : 'png';
  return `${DISCORD_CDN_AVATAR}/${userId}/${avatarHash}.${ext}`;
}

function normalizeDiscordUser(obj) {
  if (!obj || !obj.id) return null;
  const id = String(obj.id);
  const avatar = obj.avatar || '';
  return {
    id,
    username: obj.username || '',
    global_name: obj.global_name || '',
    discriminator: obj.discriminator || '0',
    avatar,
    avatar_url: discordAvatarUrl(id, avatar, true),
    bot: !!obj.bot,
    clan: obj.clan || null,
    primary_guild: obj.primary_guild || null,
  };
}

function parseDiscordMessagesResponse(responseBody, requestUrl) {
  let channelId = '';
  try {
    const m = (requestUrl || '').match(/\/channels\/\d+\/(\d+)\/messages/);
    if (m) channelId = m[1];
  } catch (_) {}
  const messages = [];
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    const list = Array.isArray(data) ? data : [];
    for (const msg of list) {
      if (!msg || msg.id == null) continue;
      const author = normalizeDiscordUser(msg.author);
      const att = (msg.attachments || []).map(a => ({
        id: a.id,
        filename: a.filename || '',
        size: a.size,
        url: a.url || '',
        proxy_url: a.proxy_url || a.url || '',
        width: a.width,
        height: a.height,
        content_type: a.content_type || '',
      }));
      const emb = (msg.embeds || []).map(e => ({
        type: e.type || 'rich',
        url: e.url || '',
        title: e.title || '',
        description: e.description || '',
        color: e.color,
        thumbnail: e.thumbnail ? { url: e.thumbnail.url || '', proxy_url: e.thumbnail.proxy_url || '' } : null,
      }));
      let refMsg = null;
      if (msg.referenced_message && msg.referenced_message.id) {
        const r = msg.referenced_message;
        refMsg = {
          id: r.id,
          content: (r.content || '').slice(0, 200),
          author: normalizeDiscordUser(r.author),
          timestamp: r.timestamp,
        };
      }
      const reactions = (msg.reactions || []).map(re => ({
        emoji: (re.emoji && (re.emoji.name || re.emoji.id)) ? (re.emoji.name || re.emoji.id) : '?',
        count: re.count != null ? re.count : 0,
      }));
      messages.push({
        id: String(msg.id),
        channel_id: msg.channel_id ? String(msg.channel_id) : channelId,
        type: msg.type,
        content: msg.content || '',
        timestamp: msg.timestamp || '',
        edited_timestamp: msg.edited_timestamp || null,
        author,
        mentions: (msg.mentions || []).map(normalizeDiscordUser).filter(Boolean),
        attachments: att,
        embeds: emb,
        referenced_message: refMsg,
        reactions,
        pinned: !!msg.pinned,
      });
    }
  } catch (_) {}
  return { channelId, messages };
}

function aggregateDiscordDataFromRequests(requests) {
  const usersById = new Map();
  const messagesById = new Map();
  for (const req of requests) {
    if (!req.responseBody) continue;
    const { messages } = parseDiscordMessagesResponse(req.responseBody, req.url);
    for (const msg of messages) {
      if (msg.author) {
        usersById.set(msg.author.id, msg.author);
        if (msg.referenced_message && msg.referenced_message.author) {
          usersById.set(msg.referenced_message.author.id, msg.referenced_message.author);
        }
        for (const u of msg.mentions) {
          if (u) usersById.set(u.id, u);
        }
      }
      messagesById.set(msg.id, msg);
    }
  }
  const allUsers = Array.from(usersById.values());
  const allMessages = Array.from(messagesById.values());
  const users = allUsers.filter(u => (u.global_name || u.username));
  const messages = allMessages
    .filter(msg => {
      const hasContent = !!(msg.content && msg.content.trim());
      const hasAttachments = msg.attachments && msg.attachments.length > 0;
      const hasEmbeds = msg.embeds && msg.embeds.length > 0;
      return hasContent || hasAttachments || hasEmbeds;
    })
    .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return { users, messages };
}

function buildDiscordUserListHtml(users) {
  const listHtml = users.map(u => {
    const name = u.global_name || u.username || 'Unknown';
    const handle = u.username ? `@${u.username}` : '';
    const tag = (u.clan && u.clan.tag) ? ` [${u.clan.tag}]` : (u.primary_guild && u.primary_guild.tag) ? ` [${u.primary_guild.tag}]` : '';
    const avatarHtml = u.avatar_url
      ? `<img class="discord-user-avatar" src="${escapeHtml(u.avatar_url)}" alt="" loading="lazy">`
      : `<div class="discord-user-avatar-placeholder">?</div>`;
    return `<li class="discord-user-item">
      ${avatarHtml}
      <div class="discord-user-info">
        <div class="discord-user-name">${escapeHtml(name)}${tag}</div>
        <div class="discord-user-meta">${escapeHtml(handle)} · ID: ${escapeHtml(u.id)}${u.bot ? ' · Bot' : ''}</div>
      </div>
    </li>`;
  }).join('');
  return `<ul class="discord-user-list">${listHtml}</ul>`;
}

function buildDiscordMessageListHtml(messages) {
  const listHtml = messages.map(msg => {
    const author = msg.author;
    const authorName = author ? (author.global_name || author.username || 'Unknown') : 'Unknown';
    const avatarHtml = author && author.avatar_url
      ? `<img class="discord-user-avatar discord-message-avatar" src="${escapeHtml(author.avatar_url)}" alt="" loading="lazy">`
      : `<div class="discord-user-avatar-placeholder discord-message-avatar">?</div>`;
    const timeStr = msg.timestamp ? new Date(msg.timestamp).toLocaleString() : '';
    const contentHtml = msg.content ? `<div class="discord-message-content">${escapeHtml(msg.content)}</div>` : '';
    let replyHtml = '';
    if (msg.referenced_message) {
      const r = msg.referenced_message;
      const rAuthor = r.author ? (r.author.global_name || r.author.username || 'Unknown') : 'Unknown';
      replyHtml = `<div class="discord-message-reply">
        <span class="discord-message-reply-author">${escapeHtml(rAuthor)}</span>: ${escapeHtml((r.content || '').slice(0, 150))}${(r.content || '').length > 150 ? '…' : ''}
      </div>`;
    }
    let attachmentsHtml = '';
    if (msg.attachments && msg.attachments.length > 0) {
      attachmentsHtml = `<div class="discord-attachments">${msg.attachments.map(a => {
        const url = a.url || a.proxy_url || '';
        const isImage = (a.content_type || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.filename || '');
        const thumb = isImage && url
          ? `<img class="discord-attachment-thumb" src="${escapeHtml(url)}" alt="" loading="lazy">`
          : '';
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="discord-attachment" title="${escapeHtml(a.filename || '')}">
          ${thumb}
          <span class="discord-attachment-link">${escapeHtml(a.filename || 'Download')}</span>
        </a>`;
      }).join('')}</div>`;
    }
    let embedsHtml = '';
    if (msg.embeds && msg.embeds.length > 0) {
      embedsHtml = `<div class="discord-embeds">${msg.embeds.map(e => {
        const titlePart = e.title
          ? (e.url ? `<a href="${escapeHtml(e.url)}" target="_blank" rel="noopener" class="discord-embed-title">${escapeHtml(e.title)}</a>` : `<span class="discord-embed-title">${escapeHtml(e.title)}</span>`)
          : '';
        const descPart = e.description ? `<div class="discord-embed-desc">${escapeHtml(e.description)}</div>` : '';
        const thumbPart = e.thumbnail && (e.thumbnail.url || e.thumbnail.proxy_url)
          ? `<img class="discord-embed-thumb" src="${escapeHtml(e.thumbnail.url || e.thumbnail.proxy_url)}" alt="" loading="lazy">`
          : '';
        return `<div class="discord-embed">${titlePart}${descPart}${thumbPart}</div>`;
      }).join('')}</div>`;
    }
    let reactionsHtml = '';
    if (msg.reactions && msg.reactions.length > 0) {
      reactionsHtml = `<div class="discord-reactions">${msg.reactions.map(r =>
        `<span class="discord-reaction">${escapeHtml(String(r.emoji))} × ${r.count}</span>`
      ).join('')}</div>`;
    }
    return `<li class="discord-message-item">
      <div class="discord-message-avatar-wrap">${avatarHtml}</div>
      <div class="discord-message-body">
        <div class="discord-message-header">
          <span class="discord-message-author">${escapeHtml(authorName)}</span>
          <span class="discord-message-time">${escapeHtml(timeStr)}</span>
          ${msg.channel_id ? `<span class="discord-message-channel">Channel: ${escapeHtml(msg.channel_id)}</span>` : ''}
        </div>
        ${contentHtml}
        ${replyHtml}
        ${attachmentsHtml}
        ${embedsHtml}
        ${reactionsHtml}
      </div>
    </li>`;
  }).join('');
  return `<ul class="discord-message-list">${listHtml}</ul>`;
}

function buildDiscordDropdownSection(title, contentHtml, openByDefault = true) {
  const openClass = openByDefault ? ' open' : '';
  return `<div class="discord-panel-dropdown${openClass}">
    <div class="discord-panel-dropdown-header">${escapeHtml(title)}<span class="discord-panel-dropdown-chevron">▼</span></div>
    <div class="discord-panel-dropdown-content">${contentHtml}</div>
  </div>`;
}

function renderDiscordTab(requests) {
  const container = document.getElementById('requestsContainer');

  const discordRequests = requests.filter(req => {
    if (!activeTabDomain || !isDiscordDomain(activeTabDomain)) return false;
    if (req.initiator) {
      try { if (isDiscordDomain(new URL(req.initiator).hostname)) return true; } catch {}
    }
    try {
      const u = new URL(req.url);
      if (u.hostname === 'discord.com' && (u.pathname.includes('/api/') || u.pathname.includes('/channels/'))) return true;
    } catch {}
    return false;
  });

  const { users, messages } = aggregateDiscordDataFromRequests(discordRequests);
  const signature = users.length + ':' + messages.map(m => m.id).join(',');
  if (signature === lastDiscordDataSignature) return;
  lastDiscordDataSignature = signature;

  const onDiscord = isDiscordDomain(activeTabDomain);
  if (users.length === 0 && messages.length === 0) {
    container.innerHTML = `
      <div class="discord-panel">
        <div class="discord-empty">
          ${onDiscord
            ? 'No Discord data captured yet.<br>Open a channel and scroll to load messages (discord.com/api/.../messages).'
            : 'Open Discord (discord.com) in this tab, then open a channel to capture messages and users.'}
        </div>
      </div>`;
    return;
  }

  const emptySection = (msg) => `<div class="discord-empty-section">${escapeHtml(msg)}</div>`;
  let sectionsHtml =
    buildDiscordDropdownSection('Users', users.length ? buildDiscordUserListHtml(users) : emptySection('No users captured.')) +
    buildDiscordDropdownSection('Channel messages', messages.length ? buildDiscordMessageListHtml(messages) : emptySection('No messages captured.'));
  container.innerHTML = `<div class="discord-panel">${sectionsHtml}</div>`;

  container.querySelectorAll('.discord-panel-dropdown').forEach(el => {
    const header = el.querySelector('.discord-panel-dropdown-header');
    if (header) {
      header.addEventListener('click', () => {
        el.classList.toggle('open');
      });
    }
  });
}

