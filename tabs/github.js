
function isGitHubDomain(host) {
  if (!host) return false;
  return host === 'github.com' || host === 'api.github.com' || host.endsWith('.github.com');
}function parseGitHubUserFromResponse(responseBody, url) {
  try {
    const raw = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
    const data = JSON.parse(raw);
    if (!data || typeof data.login !== 'string') return null;
    const login = (url || '').match(/\/users\/([^/?]+)/);
    const fromUrl = login ? login[1] : data.login;
    return {
      login: data.login || fromUrl,
      id: data.id,
      avatar_url: data.avatar_url,
      html_url: data.html_url || (data.login ? `https://github.com/${data.login}` : null),
      name: data.name,
      company: data.company,
      blog: data.blog,
      location: data.location,
      email: data.email,
      hireable: data.hireable,
      bio: data.bio,
      twitter_username: data.twitter_username,
      public_repos: data.public_repos,
      public_gists: data.public_gists,
      followers: data.followers,
      following: data.following,
      created_at: data.created_at,
      updated_at: data.updated_at,
      type: data.type,
      site_admin: data.site_admin,
    };
  } catch (_) { return null; }
}function parseGitHubProfileFromHtml(html, url) {
  if (typeof html !== 'string') return null;
  const out = { contributionCount: null, contributionDays: [], reposContributedTo: [], activityPercentages: {}, timelineEvents: [], profileLogin: null };
  const loginMatch = url.match(/github\.com\/([^/?]+)/);
  if (loginMatch) out.profileLogin = loginMatch[1];

  const contributionsMatch = html.match(/(\d+)\s+contributions\s+in\s+the\s+last\s+year/i);
  if (contributionsMatch) out.contributionCount = parseInt(contributionsMatch[1], 10);

  const dayRegex = /data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="(\d+)"/g;
  let m;
  while ((m = dayRegex.exec(html)) !== null) {
    out.contributionDays.push({ date: m[1], level: parseInt(m[2], 10) });
  }

  const repoLinkRegex = /href="\/([^/]+)\/([^"/]+)"[^>]*class="[^"]*text-bold[^"]*"/g;
  const repoSet = new Set();
  while ((m = repoLinkRegex.exec(html)) !== null) {
    repoSet.add(m[1] + '/' + m[2]);
  }
  out.reposContributedTo = Array.from(repoSet);

  const percentagesMatch = html.match(/data-percentages="(\{[^"]+\})"/);
  if (percentagesMatch) {
    try {
      const decoded = percentagesMatch[1].replace(/&quot;/g, '"');
      out.activityPercentages = JSON.parse(decoded);
    } catch (_) {}
  }

  const otherReposMatch = html.match(/and\s+(\d+)\s+other\s+repositories/i);
  if (otherReposMatch) out.otherReposCount = parseInt(otherReposMatch[1], 10);

  const timelineCommitMatch = html.match(/Created\s+(\d+)\s+commits?\s+in\s+(\d+)\s+repository/gi);
  if (timelineCommitMatch) {
    timelineCommitMatch.forEach(() => {
      out.timelineEvents.push({ type: 'commits', text: timelineCommitMatch[0] });
    });
  }
  const repoHrefRegex = /href="(\/[^/]+\/[^"?]+)"[^>]*data-view-component="true"[^>]*class="Link[^"]*"[^>]*>([^<]+)</g;
  const reposInTimeline = [];
  while ((m = repoHrefRegex.exec(html)) !== null) {
    const full = m[1].replace(/^\//, '');
    if (full && full.includes('/') && !reposInTimeline.includes(full)) reposInTimeline.push(full);
  }
  if (reposInTimeline.length) out.timelineRepos = reposInTimeline;

  return out;
}

function aggregateGitHubProfilesFromRequests(requests) {
  const byLogin = new Map();
  for (const req of requests) {
    if (!req.url || !req.responseBody) continue;
    try {
      const u = new URL(req.url);
      const host = u.hostname || '';
      if (!isGitHubDomain(host)) continue;

      if (host === 'api.github.com' && u.pathname.startsWith('/users/') && req.method === 'GET') {
        const user = parseGitHubUserFromResponse(req.responseBody, req.url);
        if (user && user.login) {
          const existing = byLogin.get(user.login);
          const merged = existing ? { ...existing, ...user } : { ...user, contributionCount: null, contributionDays: [], reposContributedTo: [], activityPercentages: {}, timelineEvents: [], timelineRepos: [] };
          byLogin.set(user.login, merged);
        }
      }

      const bodyStr = typeof req.responseBody === 'string' ? req.responseBody : (req.responseBody && typeof req.responseBody === 'object' ? null : String(req.responseBody));
      const looksLikeProfileHtml = bodyStr && (bodyStr.includes('ContributionCalendar-day') || bodyStr.includes('contributions in the last year') || bodyStr.includes('Contributed to'));
      if (bodyStr && looksLikeProfileHtml) {
        const parsed = parseGitHubProfileFromHtml(bodyStr, req.url);
        if (parsed && (parsed.contributionCount != null || parsed.contributionDays.length || parsed.reposContributedTo.length || Object.keys(parsed.activityPercentages).length)) {
          const login = parsed.profileLogin || (u.pathname.match(/^\/([^/]+)/) || [])[1];
          if (login) {
            const existing = byLogin.get(login);
            const merged = existing ? { ...existing } : { login, avatar_url: null, html_url: `https://github.com/${login}`, name: null, bio: null, public_repos: null, followers: null, following: null };
            if (parsed.contributionCount != null) merged.contributionCount = parsed.contributionCount;
            if (parsed.contributionDays.length) merged.contributionDays = parsed.contributionDays;
            if (parsed.reposContributedTo.length) merged.reposContributedTo = parsed.reposContributedTo;
            if (parsed.otherReposCount != null) merged.otherReposCount = parsed.otherReposCount;
            if (Object.keys(parsed.activityPercentages).length) merged.activityPercentages = parsed.activityPercentages;
            if (parsed.timelineRepos && parsed.timelineRepos.length) merged.timelineRepos = parsed.timelineRepos;
            byLogin.set(login, merged);
          }
        }
      }
    } catch (_) {}
  }
  return Array.from(byLogin.values());
}

function buildGitHubDropdownSection(title, contentHtml, defaultOpen = true) {
  const openClass = defaultOpen ? ' open' : '';
  return `<div class="github-panel-dropdown${openClass}">
    <div class="github-panel-dropdown-header">${escapeHtml(title)}<span class="twitter-panel-dropdown-chevron">▼</span></div>
    <div class="github-panel-dropdown-content">${contentHtml}</div>
  </div>`;
}

function buildGitHubProfileSectionHtml(profiles) {
  if (!profiles.length) return '';
  const emptySection = (msg) => `<div class="github-empty-section">${escapeHtml(msg)}</div>`;
  const cards = profiles.map(p => {
    const avatarHtml = p.avatar_url
      ? `<div class="github-avatar-wrap"><img src="${escapeHtml(p.avatar_url)}" alt="" referrerpolicy="no-referrer"></div>`
      : '';
    const name = p.name || p.login || '—';
    const login = p.login ? `@${escapeHtml(p.login)}` : '';
    const profileUrl = p.html_url || (p.login ? `https://github.com/${p.login}` : '');
    const bioHtml = p.bio ? `<div class="github-profile-bio">${escapeHtml(p.bio)}</div>` : '';
    const stats = [];
    if (p.followers != null) stats.push(`${p.followers} followers`);
    if (p.following != null) stats.push(`${p.following} following`);
    if (p.public_repos != null) stats.push(`${p.public_repos} repos`);
    const statsHtml = stats.length ? `<div class="github-profile-stats">${escapeHtml(stats.join(' · '))}</div>` : '';
    const linkHtml = profileUrl ? `<a href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener" class="github-profile-link">Open profile</a>` : '';

    const detailRows = [];
    const add = (label, value) => { if (value != null && value !== '') detailRows.push({ label, value: String(value) }); };
    add('ID', p.id);
    add('Company', p.company);
    add('Location', p.location);
    add('Blog', p.blog);
    add('Email', p.email);
    add('Twitter', p.twitter_username);
    add('Created', p.created_at);
    add('Updated', p.updated_at);
    add('Type', p.type);
    if (p.site_admin) add('Site admin', 'Yes');
    const detailsHtml = detailRows.length
      ? `<div class="github-details-list">${detailRows.map(r => `<div class="github-detail-row"><span class="github-detail-label">${escapeHtml(r.label)}</span><span class="github-detail-value">${escapeHtml(r.value)}</span></div>`).join('')}</div>`
      : '';

    return `<div class="github-profile-card">
      <div class="github-profile-header">
        ${avatarHtml}
        <div class="github-profile-head-text">
          <div class="github-profile-name">${escapeHtml(name)}</div>
          <div class="github-profile-login">${login}</div>
          ${bioHtml}
          ${statsHtml}
          ${linkHtml}
        </div>
      </div>
      ${detailsHtml}
    </div>`;
  }).join('');
  return `<div class="github-profile-list">${cards}</div>`;
}

function buildGitHubContributionsHtml(profiles) {
  const withContrib = profiles.filter(p => p.contributionCount != null || (p.contributionDays && p.contributionDays.length));
  if (!withContrib.length) return null;
  const parts = withContrib.map(p => {
    let html = '';
    if (p.contributionCount != null) {
      html += `<div class="github-contributions-summary">${escapeHtml(String(p.contributionCount))} contributions in the last year</div>`;
    }
    if (p.contributionDays && p.contributionDays.length) {
      const maxCols = 53;
      const rows = 7;
      const grid = [];
      for (let i = 0; i < maxCols * rows; i++) {
        const d = p.contributionDays[i];
        const level = d ? d.level : 0;
        const title = d ? d.date : '';
        grid.push(`<span class="github-calendar-day" data-level="${level}" title="${escapeHtml(title)}"></span>`);
      }
      html += `<div class="github-calendar-wrap"><div class="github-calendar-grid">${grid.join('')}</div></div>`;
    }
    return html;
  }).join('');
  return parts ? `<div class="github-contributions-block">${parts}</div>` : null;
}

function buildGitHubReposHtml(profiles) {
  const withRepos = profiles.filter(p => p.reposContributedTo && p.reposContributedTo.length);
  if (!withRepos.length) return null;
  const allRepos = new Set();
  withRepos.forEach(p => p.reposContributedTo.forEach(r => allRepos.add(r)));
  const otherCount = Math.max(0, ...withRepos.map(p => p.otherReposCount || 0));
  const list = Array.from(allRepos);
  const listHtml = list.slice(0, 50).map(repo => {
    const url = repo.includes('/') ? `https://github.com/${repo}` : repo;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="github-repo-link">${escapeHtml(repo)}</a>`;
  }).join('');
  const otherHtml = otherCount > 0 ? `<span class="github-empty-section">and ${otherCount} other repositories</span>` : '';
  return `<div class="github-repos-list">${listHtml}</div>${otherHtml}`;
}

function buildGitHubActivityHtml(profiles) {
  const withActivity = profiles.filter(p => (p.activityPercentages && Object.keys(p.activityPercentages).length) || (p.timelineRepos && p.timelineRepos.length));
  if (!withActivity.length) return null;
  const parts = [];
  withActivity.forEach(p => {
    if (p.activityPercentages && Object.keys(p.activityPercentages).length) {
      parts.push(`<div class="github-activity-item"><strong>Activity</strong>: ${Object.entries(p.activityPercentages).map(([k, v]) => `${escapeHtml(k)} ${v}%`).join(', ')}</div>`);
    }
    if (p.timelineRepos && p.timelineRepos.length) {
      parts.push(`<div class="github-activity-item">Repositories: ${p.timelineRepos.slice(0, 20).map(r => `<a href="https://github.com/${escapeHtml(r)}" target="_blank" rel="noopener" class="github-repo-link">${escapeHtml(r)}</a>`).join(', ')}</div>`);
    }
  });
  return parts.length ? parts.join('') : null;
}

function renderGitHubTab(requests) {
  const container = document.getElementById('requestsContainer');
  const githubRequests = requests.filter(req => {
    if (!activeTabDomain || !isGitHubDomain(activeTabDomain)) return false;
    try {
      const u = new URL(req.url);
      const host = u.hostname || '';
      if (isGitHubDomain(host)) return true;
    } catch (_) {}
    return false;
  });

  const profiles = aggregateGitHubProfilesFromRequests(githubRequests);
  const signature = profiles.map(p => (p.login || '') + (p.contributionCount || '') + (p.contributionDays || []).length).sort().join(',');
  if (signature === lastGitHubDataSignature) return;
  lastGitHubDataSignature = signature;

  const onGitHub = isGitHubDomain(activeTabDomain);
  if (!profiles.length) {
    container.innerHTML = `
      <div class="github-panel">
        <div class="github-empty">
          ${onGitHub
            ? 'No GitHub profile data captured yet.<br>Browse a user profile on github.com (e.g. github.com/username). Profile and contributions are captured from API and page requests.'
            : 'Open GitHub (github.com) in this tab and view a user profile to capture data.'}
        </div>
      </div>`;
    return;
  }

  const emptySection = (msg) => `<div class="github-empty-section">${escapeHtml(msg)}</div>`;
  let sectionsHtml = buildGitHubDropdownSection('Profile', buildGitHubProfileSectionHtml(profiles), true);
  const contribHtml = buildGitHubContributionsHtml(profiles);
  if (contribHtml) sectionsHtml += buildGitHubDropdownSection('Contributions', contribHtml, true);
  const reposHtml = buildGitHubReposHtml(profiles);
  if (reposHtml) sectionsHtml += buildGitHubDropdownSection('Repositories contributed to', reposHtml, true);
  const activityHtml = buildGitHubActivityHtml(profiles);
  if (activityHtml) sectionsHtml += buildGitHubDropdownSection('Activity', activityHtml, false);

  container.innerHTML = `<div class="github-panel">${sectionsHtml}</div>`;

  container.querySelectorAll('.github-panel-dropdown').forEach(el => {
    const header = el.querySelector('.github-panel-dropdown-header');
    if (header) {
      header.addEventListener('click', () => {
        el.classList.toggle('open');
      });
    }
  });
}

