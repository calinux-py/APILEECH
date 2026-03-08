const STATIC_FILTER_STORAGE_KEY = 'hideStaticResources';
const TAB_VISIBILITY_STORAGE_KEY = 'popupTabVisibility';
const TAB_DEFINITIONS = [
  { key: 'current', buttonId: 'currentTabBtn', view: 'current', label: 'Current tab', locked: true },
  { key: 'history', buttonId: 'historyTabBtn', view: 'history', label: 'History', locked: true },
  { key: 'comments', buttonId: 'commentsTabBtn', view: 'comments', label: 'Comments', locked: false },
  { key: 'activeInterception', buttonId: 'activeInterceptionTabBtn', view: 'activeInterception', label: 'Active Interception', locked: false },
  { key: 'bugs', buttonId: 'bugsTabBtn', view: 'bugs', label: 'Bug Hunter', locked: false },
  { key: 'twitter', buttonId: 'twitterTabBtn', view: 'twitter', label: 'Twitter / X', locked: false },
  { key: 'tiktok', buttonId: 'tiktokTabBtn', view: 'tiktok', label: 'TikTok', locked: false },
  { key: 'soundcloud', buttonId: 'soundcloudTabBtn', view: 'soundcloud', label: 'SoundCloud', locked: false },
  { key: 'discord', buttonId: 'discordTabBtn', view: 'discord', label: 'Discord', locked: false },
  { key: 'facebook', buttonId: 'facebookTabBtn', view: 'facebook', label: 'Facebook', locked: false },
  { key: 'instagram', buttonId: 'instagramTabBtn', view: 'instagram', label: 'Instagram', locked: false },
  { key: 'github', buttonId: 'githubTabBtn', view: 'github', label: 'GitHub', locked: false },
  { key: 'pinterest', buttonId: 'pinterestTabBtn', view: 'pinterest', label: 'Pinterest', locked: false }
];
const TAB_DEFINITION_BY_KEY = Object.fromEntries(TAB_DEFINITIONS.map(tab => [tab.key, tab]));
const TAB_DEFINITION_BY_VIEW = Object.fromEntries(TAB_DEFINITIONS.map(tab => [tab.view, tab]));
let hideStaticResources = true;

function buildDefaultTabVisibilitySettings() {
  const defaults = {};
  TAB_DEFINITIONS.forEach(tab => {
    defaults[tab.key] = true;
  });
  return defaults;
}

function normalizeTabVisibilitySettings(raw) {
  const normalized = buildDefaultTabVisibilitySettings();
  if (!raw || typeof raw !== 'object') return normalized;
  TAB_DEFINITIONS.forEach(tab => {
    if (tab.locked) {
      normalized[tab.key] = true;
      return;
    }
    if (typeof raw[tab.key] === 'boolean') {
      normalized[tab.key] = raw[tab.key];
    }
  });
  return normalized;
}

let tabVisibilitySettings = buildDefaultTabVisibilitySettings();
let tabVisibilityUiReady = false;

(function() {
  const theme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);

  chrome.storage.local.get(['theme', 'shellMode', STATIC_FILTER_STORAGE_KEY, TAB_VISIBILITY_STORAGE_KEY], (result) => {
    if (result.theme && result.theme !== theme) {
      document.documentElement.setAttribute('data-theme', result.theme);
      localStorage.setItem('theme', result.theme);
      const icon = document.getElementById('themeIcon');
      if (icon) icon.innerHTML = result.theme === 'dark' ? '&#9728;' : '&#9790;';
    }
    if (result.shellMode && (result.shellMode === 'cmd' || result.shellMode === 'ps')) {
      shellMode = result.shellMode;
      localStorage.setItem('shellMode', result.shellMode);
    }
    if (typeof result[STATIC_FILTER_STORAGE_KEY] === 'boolean') {
      hideStaticResources = result[STATIC_FILTER_STORAGE_KEY];
    } else {
      hideStaticResources = true;
      chrome.storage.local.set({ [STATIC_FILTER_STORAGE_KEY]: true });
    }
    if (result[TAB_VISIBILITY_STORAGE_KEY]) {
      tabVisibilitySettings = normalizeTabVisibilitySettings(result[TAB_VISIBILITY_STORAGE_KEY]);
    } else {
      tabVisibilitySettings = buildDefaultTabVisibilitySettings();
      chrome.storage.local.set({ [TAB_VISIBILITY_STORAGE_KEY]: tabVisibilitySettings });
    }
    chrome.runtime.sendMessage({ action: 'setHideStaticResources', enabled: hideStaticResources }, () => {});
    syncTabVisibilityUi();
  });
})();

function updateThemeIcon() {
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const icon = document.getElementById('themeIcon');
  if (icon) icon.innerHTML = theme === 'dark' ? '&#9728;' : '&#9790;';
}

let currentRequests = [];
let combinedRequestsCache = [];
let activeTabId = -1;
let activeTabDomain = '';
let activeTabUrl = '';
let currentView = 'current';
let modalList = [];
let modalIndex = -1;
let twitterRefreshInterval = null;
let tiktokRefreshInterval = null;
let soundcloudRefreshInterval = null;
let discordRefreshInterval = null;
let facebookRefreshInterval = null;
let instagramRefreshInterval = null;
let githubRefreshInterval = null;
let pinterestRefreshInterval = null;
let commentsRefreshInterval = null;
let activeInterceptionRefreshInterval = null;
let currentHistoryRefreshInterval = null;
let requestUrlSearchQuery = '';
const requestFilterMethods = new Set();
const requestFilterTypes = new Set();
const FILTER_METHODS = ['GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const FILTER_TYPES = ['fetch', 'document'];
const TWITTER_REFRESH_MS = 2000;
const TIKTOK_REFRESH_MS = 2000;
const SOUNDCLOUD_REFRESH_MS = 2000;
const DISCORD_REFRESH_MS = 2000;
const FACEBOOK_REFRESH_MS = 2000;
const INSTAGRAM_REFRESH_MS = 2000;
const GITHUB_REFRESH_MS = 2000;
const PINTEREST_REFRESH_MS = 2000;
const COMMENTS_REFRESH_MS = 2000;
const ACTIVE_INTERCEPTION_REFRESH_MS = 2000;
const CURRENT_HISTORY_REFRESH_MS = 1000;
let lastTwitterDataSignature = '';
let lastTikTokDataSignature = '';
let lastSoundCloudDataSignature = '';
let lastDiscordDataSignature = '';
let lastFacebookDataSignature = '';
let lastInstagramDataSignature = '';
let lastGitHubDataSignature = '';
let lastPinterestDataSignature = '';
let lastCommentsDataSignature = '';
let instagramProfilePicBlobUrls = new Set();
let activeInterceptionEntries = [];
let activeInterceptionStats = { scriptsScanned: 0, storageDbCount: 0, endpointCount: 0, endpointHits: 0, updatedAt: null };
let lastActiveInterceptionEntriesSignature = '';
let pageCommentsData = { pageUrl: '', pageTitle: '', comments: [] };

function isTabVisible(tabKey) {
  const tab = TAB_DEFINITION_BY_KEY[tabKey];
  if (!tab) return true;
  if (tab.locked) return true;
  return tabVisibilitySettings[tab.key] !== false;
}

function getPersistedTabVisibilitySettings() {
  const persisted = {};
  TAB_DEFINITIONS.forEach(tab => {
    if (!tab.locked) {
      persisted[tab.key] = isTabVisible(tab.key);
    }
  });
  return persisted;
}

function getTabVisibilitySettingsMarkup() {
  return TAB_DEFINITIONS.filter(tab => !tab.locked).map(tab => {
    const button = document.getElementById(tab.buttonId);
    const checked = isTabVisible(tab.key) ? ' checked' : '';
    const disabled = tab.locked ? ' disabled' : '';
    const lockedClass = tab.locked ? ' is-locked' : '';
    const iconHtml = button ? button.innerHTML : '';
    return `
      <label class="settings-option${lockedClass}">
        <span class="settings-option-main">
          ${iconHtml}
          <span class="settings-option-label">${escapeHtml(tab.label)}</span>
        </span>
        <input type="checkbox" data-tab-key="${tab.key}"${checked}${disabled}>
      </label>
    `;
  }).join('');
}

function attachTabVisibilitySettingsHandlers(root = document) {
  const listEl = root.querySelector('#tabVisibilityList');
  if (!listEl) return;

  listEl.querySelectorAll('input[data-tab-key]').forEach(input => {
    input.addEventListener('change', () => {
      const tab = TAB_DEFINITION_BY_KEY[input.dataset.tabKey];
      if (!tab || tab.locked) return;
      tabVisibilitySettings[tab.key] = input.checked;
      chrome.storage.local.set({ [TAB_VISIBILITY_STORAGE_KEY]: getPersistedTabVisibilitySettings() });
      applyTabVisibilitySettings();
    });
  });
}

function applyTabVisibilitySettings() {
  TAB_DEFINITIONS.forEach(tab => {
    const button = document.getElementById(tab.buttonId);
    if (button) button.hidden = !isTabVisible(tab.key);
  });

  const activeTab = TAB_DEFINITION_BY_VIEW[currentView];
  if (activeTab && !isTabVisible(activeTab.key)) {
    const currentTabButton = document.getElementById('currentTabBtn');
    if (currentTabButton) currentTabButton.click();
  }
}

function syncTabVisibilityUi() {
  if (!tabVisibilityUiReady) return;
  applyTabVisibilitySettings();
  if (currentView === 'settings') renderSettingsView();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  chrome.storage.local.set({ theme: next });
  if (currentView === 'settings') {
    renderSettingsView();
  } else {
    updateThemeIcon();
  }
}

function stopAllViewRefreshes() {
  stopTwitterRefresh();
  stopTikTokRefresh();
  stopSoundCloudRefresh();
  stopDiscordRefresh();
  stopFacebookRefresh();
  stopInstagramRefresh();
  stopGitHubRefresh();
  stopPinterestRefresh();
  stopCommentsRefresh();
  stopActiveInterceptionRefresh();
  if (typeof stopBugRefresh === 'function') stopBugRefresh();
  stopCurrentHistoryRefresh();
}

function resetAllPlatformDataSignatures() {
  lastTwitterDataSignature = '';
  lastTikTokDataSignature = '';
  lastSoundCloudDataSignature = '';
  lastDiscordDataSignature = '';
  lastFacebookDataSignature = '';
  lastInstagramDataSignature = '';
  lastGitHubDataSignature = '';
  lastPinterestDataSignature = '';
  lastCommentsDataSignature = '';
}

function renderSettingsView() {
  const container = document.getElementById('requestsContainer');
  if (!container) return;

  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const themeModeLabel = theme === 'dark' ? 'Dark mode' : 'Light mode';
  const themeSwitchLabel = theme === 'dark' ? 'Switch to Light' : 'Switch to Dark';

  container.innerHTML = `
    <div class="settings-page">
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Appearance</div>
          <div class="settings-card-note">Theme controls moved here from the header.</div>
        </div>
        <div class="settings-card-body">
          <button class="settings-theme-btn" id="settingsThemeToggle">
            <span class="settings-theme-main">
              <span class="settings-theme-icon" id="themeIcon">&#9728;</span>
              <span class="settings-theme-copy">
                <span class="settings-row-title">${themeModeLabel}</span>
                <span class="settings-row-subtitle">Choose how the popup is displayed.</span>
              </span>
            </span>
            <span class="settings-theme-value">${themeSwitchLabel}</span>
          </button>
        </div>
      </div>
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-title">Visible Tabs</div>
        </div>
        <div class="settings-card-body">
          <div class="settings-list" id="tabVisibilityList">${getTabVisibilitySettingsMarkup()}</div>
        </div>
      </div>
    </div>
  `;

  attachTabVisibilitySettingsHandlers(container);
  document.getElementById('settingsThemeToggle')?.addEventListener('click', toggleTheme);
  updateThemeIcon();
}

function isGraphQLRequest(request) {
  if (!request.body || request.method !== 'POST') return false;
  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    return body && typeof body.query === 'string';
  } catch {
    return false;
  }
}

function parseGraphQLBody(request) {
  try {
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    return { query: body.query || '', variables: body.variables || {} };
  } catch {
    return null;
  }
}

function formatGraphQLValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  if (Array.isArray(value)) return '[' + value.map(formatGraphQLValue).join(', ') + ']';
  if (typeof value === 'object') {
    const fields = Object.entries(value).map(([k, v]) => `${k}: ${formatGraphQLValue(v)}`);
    return '{ ' + fields.join(', ') + ' }';
  }
  return String(value);
}

function inlineVariables(queryStr, variables) {
  if (!variables) variables = {};

  let result = '';
  let inString = false;
  let escapeNext = false;
  let i = 0;

  while (i < queryStr.length) {
    if (escapeNext) {
      result += queryStr[i]; escapeNext = false; i++; continue;
    }
    if (queryStr[i] === '\\' && inString) {
      result += queryStr[i]; escapeNext = true; i++; continue;
    }
    if (queryStr[i] === '"') {
      result += queryStr[i]; inString = !inString; i++; continue;
    }
    if (inString) {
      result += queryStr[i]; i++; continue;
    }

    if (queryStr[i] === '$') {
      let varName = '';
      let j = i + 1;
      while (j < queryStr.length && /[a-zA-Z0-9_]/.test(queryStr[j])) {
        varName += queryStr[j]; j++;
      }
      if (varName) {
        const value = variables.hasOwnProperty(varName) ? variables[varName] : null;
        result += formatGraphQLValue(value);
        i = j;
        continue;
      }
    }

    result += queryStr[i]; i++;
  }
  return result;
}

function extractQueryInner(queryStr) {
  let q = queryStr.trim();
  q = q.replace(/^(query|subscription)\s*\w*\s*(\([^)]*\))?\s*/, '');

  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < q.length; i++) {
    const ch = q[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') { if (depth === 0) start = i + 1; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start !== -1) return q.slice(start, i).trim(); }
  }
  return q;
}

function isMutation(queryStr) {
  return queryStr.trim().startsWith('mutation');
}

function groupGraphQLRequests(requests) {
  const groups = {};
  requests.forEach((req, index) => {
    if (isGraphQLRequest(req)) {
      const parsed = parseGraphQLBody(req);
      if (parsed && !isMutation(parsed.query)) {
        if (!groups[req.url]) groups[req.url] = [];
        groups[req.url].push({ request: req, index });
      }
    }
  });
  const result = [];
  for (const [url, items] of Object.entries(groups)) {
    if (items.length >= 2) result.push({ url, items });
  }
  return result;
}

function buildCombinedRequest(group) {
  const seen = new Set();
  const uniqueItems = [];
  group.items.forEach(({ request }) => {
    const parsed = parseGraphQLBody(request);
    if (!parsed) return;
    const key = parsed.query.replace(/\s+/g, ' ').trim();
    if (!seen.has(key)) { seen.add(key); uniqueItems.push(request); }
  });
  if (uniqueItems.length < 2) return null;

  const queryParts = [];
  const descriptions = [];

  uniqueItems.forEach((request, i) => {
    const parsed = parseGraphQLBody(request);
    if (!parsed) return;

    let inner = extractQueryInner(parsed.query);
    inner = inlineVariables(inner, parsed.variables);

    queryParts.push(`q${i}: ${inner}`);

    const fieldMatch = inner.match(/^(\w+)/);
    const argMatch = inner.match(/\(([^)]*)\)/s);
    let desc = fieldMatch ? fieldMatch[1] : `query ${i}`;
    if (argMatch) {
      const strMatch = argMatch[1].match(/"([^"]*)"/);
      if (strMatch) {
        const val = strMatch[1];
        const short = val.split('~').pop() || val.split('@').pop() || val;
        desc += ` [${short.length > 30 ? short.substring(0, 30) + '...' : short}]`;
      }
    }
    descriptions.push(`q${i}: ${desc}`);
  });

  const combinedQuery = `{ ${queryParts.join(' ')} }`;
  const combinedBody = JSON.stringify({ variables: {}, query: combinedQuery });

  const template = group.items[0].request;
  return {
    url: group.url,
    method: 'POST',
    headers: template.headers,
    body: combinedBody,
    timestamp: new Date().toISOString(),
    type: 'combined',
    _combinedCount: uniqueItems.length,
    _descriptions: descriptions,
    _originalRequests: uniqueItems
  };
}

function compactBody(request) {
  if (!request.body || request.body === 'null') return null;
  let raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
  try {
    const obj = JSON.parse(raw);
    if (obj.query && typeof obj.query === 'string') {
      obj.query = obj.query.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    }
    return JSON.stringify(obj);
  } catch { return raw.replace(/\n/g, ' ').replace(/\s+/g, ' '); }
}

let shellMode = 'ps';

function generateCurl(request) {
  const method = request.method ? request.method.toUpperCase().replace(/[^A-Z]/g, '') : 'GET';
  
  if (shellMode === 'ps') {
    return generateCurlPS(request, method);
  }
  if (shellMode === 'cmd') {
    return generateCurlCMD(request, method);
  }
  return generateCurlBash(request, method);
}

function generateCurlPS(request, method) {
  const esc = (str) => String(str).replace(/'/g, "''");
  
  let cmd = `curl.exe '${esc(request.url)}' -X ${method}`;
  
  if (request.headers) {
    const headers = Array.isArray(request.headers)
      ? request.headers
      : Object.entries(request.headers).map(([name, value]) => ({ name, value }));
    
    headers.forEach(h => {
      const name  = h.name  || h[0];
      const value = h.value || h[1];
      const skip  = ['host', 'connection', 'content-length', 'accept-encoding'];
      if (String(value) === 'undefined' || String(value) === 'null' || !value) return;
      if (skip.includes(name.toLowerCase())) return;
      
      cmd += ` -H '${esc(name)}: ${esc(value)}'`;
    });
  }

  const body = compactBody(request);
  if (body) {
    cmd += ` --data-raw '${esc(body)}'`;
  }
  
  cmd += ` --compressed`;
  return cmd;
}

function generateCurlCMD(request, method) {
  const escCmd = (str) => String(str).replace(/"/g, '\\"').replace(/&/g, '^&').replace(/\^/g, '^^');
  
  let cmd = `curl.exe "${escCmd(request.url)}" -X ${method}`;
  
  if (request.headers) {
    const headers = Array.isArray(request.headers)
      ? request.headers
      : Object.entries(request.headers).map(([name, value]) => ({ name, value }));
    
    headers.forEach(h => {
      const name  = h.name  || h[0];
      const value = h.value || h[1];
      const skip  = ['host', 'connection', 'content-length', 'accept-encoding'];
      if (String(value) === 'undefined' || String(value) === 'null' || !value) return;
      if (skip.includes(name.toLowerCase())) return;
      
      cmd += ` -H "${escCmd(name)}: ${escCmd(value)}"`;
    });
  }

  const body = compactBody(request);
  if (body) {
    cmd += ` --data-raw "${escCmd(body)}"`;
  }
  
  cmd += ` --compressed`;
  return cmd;
}

function generateCurlBash(request, method) {
  const esc = (str) => String(str).replace(/'/g, "'\\''");
  
  let cmd = `curl '${esc(request.url)}' -X ${method}`;
  
  if (request.headers) {
    const headers = Array.isArray(request.headers)
      ? request.headers
      : Object.entries(request.headers).map(([name, value]) => ({ name, value }));
    
    headers.forEach(h => {
      const name  = h.name  || h[0];
      const value = h.value || h[1];
      const skip  = ['host', 'connection', 'content-length', 'accept-encoding'];
      if (String(value) === 'undefined' || String(value) === 'null' || !value) return;
      if (skip.includes(name.toLowerCase())) return;
      
      cmd += ` -H '${esc(name)}: ${esc(value)}'`;
    });
  }

  const body = compactBody(request);
  if (body) {
    cmd += ` --data-raw '${esc(body)}'`;
  }
  
  cmd += ` --compressed`;
  return cmd;
}

function generateCurlForMode(mode, request) {
  const method = request.method ? request.method.toUpperCase().replace(/[^A-Z]/g, '') : 'GET';
  if (mode === 'ps') return generateCurlPS(request, method);
  if (mode === 'cmd') return generateCurlCMD(request, method);
  return generateCurlBash(request, method);
}

function buildActiveEndpointRequest(entry) {
  const method = (entry && entry.method ? String(entry.method) : 'GET').toUpperCase();
  const headers = [{ name: 'Accept', value: 'application/json' }];
  return {
    url: entry && entry.url ? entry.url : (entry && entry.rawUrl ? entry.rawUrl : ''),
    method: method || 'GET',
    headers,
    body: null
  };
}

function formatLastSeen(value) {
  if (!value) return 'just now';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return 'just now';
  const diffMs = Date.now() - then;
  if (diffMs < 5000) return 'just now';
  if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  return `${Math.floor(diffMs / 3600000)}h ago`;
}

function copyTextWithButtonFeedback(text, btn) {
  if (!btn) return;
  navigator.clipboard.writeText(String(text || '')).then(() => {
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copied');
    }, 1800);
  });
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function countForCurrentSite(requests) {
  if (!activeTabDomain) return 0;
  return requests.filter(req => {
    if (req.initiator) {
      try { if (new URL(req.initiator).hostname === activeTabDomain) return true; } catch {}
    }
    if (req.url) {
      try { if (new URL(req.url).hostname === activeTabDomain) return true; } catch {}
    }
    return false;
  }).length;
}

function updateStats(requests) {
  const siteNameEl = document.getElementById('currentSiteName');
  if (siteNameEl) siteNameEl.textContent = activeTabDomain || '—';
  document.getElementById('currentSiteCount').textContent = countForCurrentSite(requests);
  document.getElementById('totalCount').textContent = requests.length;
}

function getResponseBodySearchString(req) {
  const v = req.responseBody;
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (_) { return String(v); }
}

function tokenMatchesText(token, text) {
  if (!token || text == null) return !token;
  const t = String(text);
  if (!token.includes('*')) return t.toLowerCase().includes(token.toLowerCase());
  const parts = token.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = parts.join('.*');
  try {
    return new RegExp(pattern, 'i').test(t);
  } catch (_) {
    return t.toLowerCase().includes(token.toLowerCase());
  }
}

function matchRequestSearch(req, query) {
  if (!query || !String(query).trim()) return true;
  const tokens = String(query).trim().split(/\s+/).filter(Boolean);
  const urlStr = String(req.url || '');
  const bodyStr = getResponseBodySearchString(req);
  return tokens.every(t => tokenMatchesText(t, urlStr) || tokenMatchesText(t, bodyStr));
}

function renderRequests(requests) {
  const container = document.getElementById('requestsContainer');
  updateStats(requests);

  if (currentView === 'comments') {
    renderCommentsTabEnhanced();
    return;
  }
  if (currentView === 'activeInterception') {
    renderActiveInterceptionTab();
    return;
  }
  if (currentView === 'bugs') {
    if (typeof renderBugTab === 'function') renderBugTab();
    return;
  }
  if (currentView === 'settings') {
    renderSettingsView();
    return;
  }

  if (requests.length === 0 && (currentView === 'current' || currentView === 'history')) {
    container.innerHTML = '<div class="empty-state"><div class="empty-text">Waiting for API requests...<br>Navigate any website to capture traffic</div></div>';
    return;
  }

  if (currentView === 'current') {
    renderCurrentTab(requests);
  } else if (currentView === 'twitter') {
    renderTwitterTab(requests);
  } else if (currentView === 'tiktok') {
    renderTikTokTab(requests);
  } else if (currentView === 'soundcloud') {
    renderSoundCloudTab(requests);
  } else if (currentView === 'discord') {
    renderDiscordTab(requests);
  } else if (currentView === 'facebook') {
    renderFacebookTab(requests);
  } else if (currentView === 'instagram') {
    renderInstagramTab(requests);
  } else if (currentView === 'github') {
    renderGitHubTab(requests);
  } else if (currentView === 'pinterest') {
    renderPinterestTab(requests);
  } else {
    renderHistoryTab(requests);
  }
}

function escapeHtml(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(String(value == null ? '' : value)).replace(/"/g, '&quot;');
}

function getCodeLanguage(comment) {
  const st = (comment && comment.sourceType) || '';
  const url = (comment && comment.fileUrl) || '';
  if (/html/i.test(st)) return 'html';
  if (/style/i.test(st) || /\.css$/i.test(url)) return 'css';
  if (/script/i.test(st) || /\.(js|ts|mjs|cjs|jsx|tsx)$/i.test(url)) return 'javascript';
  return 'javascript';
}

function highlightCode(code, lang) {
  if (!code) return '';
  const ranges = [];
  const add = (re, cls) => {
    let m;
    const copy = new RegExp(re.source, re.flags);
    while ((m = copy.exec(code)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length, cls, text: m[0] });
    }
  };
  add(/(^\s*\d+\s*\|\s*)/gm, 'hl-line');
  add(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g, 'hl-string');
  add(/\/\*[\s\S]*?\*\//g, 'hl-comment');
  add(/\/\/[^\n]*/g, 'hl-comment');
  add(/<!--[\s\S]*?-->/g, 'hl-comment');
  add(/\b(var|let|const|function|return|if|else|for|while|do|switch|case|break|continue|try|catch|throw|new|typeof|instanceof|in|of|async|await|class|extends|import|export|from|default)\b/g, 'hl-keyword');
  add(/\b(true|false|null|undefined)\b/g, 'hl-literal');
  add(/\b(\d+\.?\d*)\b/g, 'hl-number');
  if (lang === 'html') {
    add(/<\/?[\w-]+/g, 'hl-tag');
    add(/[\w-]+(?=\s*=)/g, 'hl-attr');
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of ranges) {
    if (merged.length && r.start < merged[merged.length - 1].end) continue;
    merged.push(r);
  }
  let out = '';
  let pos = 0;
  for (const r of merged) {
    out += escapeHtml(code.slice(pos, r.start));
    out += `<span class="${r.cls}">${escapeHtml(r.text)}</span>`;
    pos = r.end;
  }
  out += escapeHtml(code.slice(pos));
  return out;
}

function stripJsonXssiPrefix(str) {
  if (typeof str !== 'string') return str;
  const trimmed = str.trimStart();
  if (trimmed.startsWith(")]}'\n")) return trimmed.slice(5);
  if (trimmed.startsWith(")]}'\r\n")) return trimmed.slice(6);
  if (trimmed.startsWith(")]}'")) return trimmed.slice(4).trimStart();
  if (trimmed.startsWith(")]}\n")) return trimmed.slice(4);
  if (trimmed.startsWith(")]}")) return trimmed.slice(3).trimStart();
  return str;
}

function highlightJson(jsonStr) {
  if (!jsonStr || typeof jsonStr !== 'string') return '';
  const code = jsonStr;
  const ranges = [];
  const add = (re, cls) => {
    let m;
    const copy = new RegExp(re.source, re.flags);
    while ((m = copy.exec(code)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length, cls, text: m[0] });
    }
  };
  add(/"(?:[^"\\]|\\.)*"(?=\s*:)/g, 'hl-json-key');
  add(/"(?:[^"\\]|\\.)*"/g, 'hl-json-string');
  add(/\b(true|false|null)\b/g, 'hl-json-literal');
  add(/\b(-?\d+\.?\d*([eE][+-]?\d+)?)\b/g, 'hl-json-number');
  ranges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of ranges) {
    if (merged.length && r.start < merged[merged.length - 1].end) continue;
    merged.push(r);
  }
  let out = '';
  let pos = 0;
  for (const r of merged) {
    out += escapeHtml(code.slice(pos, r.start));
    out += `<span class="${r.cls}">${escapeHtml(r.text)}</span>`;
    pos = r.end;
  }
  out += escapeHtml(code.slice(pos));
  return out;
}

function getSourceFileLabel(url) {
  if (!url) return 'Unknown file';
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : parsed.hostname;
    return last || parsed.hostname || url;
  } catch (_) {
    return url;
  }
}

function buildLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function getLineNumberForIndex(lineStarts, index) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = lineStarts[mid];
    const next = mid + 1 < lineStarts.length ? lineStarts[mid + 1] : Number.MAX_SAFE_INTEGER;
    if (index < start) high = mid - 1;
    else if (index >= next) low = mid + 1;
    else return mid + 1;
  }
  return 1;
}

function buildContextSnippet(lines, startLine, endLine, radius = 10) {
  const from = Math.max(1, startLine - radius);
  const to = Math.min(lines.length, endLine + radius);
  return lines.slice(from - 1, to).map((line, idx) => {
    const lineNumber = from + idx;
    return `${String(lineNumber).padStart(5, ' ')} | ${line}`;
  }).join('\n');
}

function normalizeCommentPreview(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripCommentDecorators(text, syntax) {
  let value = String(text || '');
  if (syntax === 'html') value = value.replace(/^<!--\s?|\s?-->$/g, '');
  else if (syntax === 'block') value = value.replace(/^\/\*\s?|\s?\*\/$/g, '');
  else if (syntax === 'line') value = value.replace(/^\/\/\s?/, '');
  return normalizeCommentPreview(value);
}

function extractHtmlComments(text, sourceMeta) {
  const comments = [];
  const lines = text.split(/\r?\n/);
  const lineStarts = buildLineStarts(text);
  const regex = /<!--([\s\S]*?)-->/g;
  let match;
  while ((match = regex.exec(text))) {
    const full = match[0];
    const startLine = getLineNumberForIndex(lineStarts, match.index);
    const endLine = getLineNumberForIndex(lineStarts, match.index + full.length - 1);
    comments.push({
      fileUrl: sourceMeta.fileUrl,
      rawUrl: sourceMeta.rawUrl || sourceMeta.fileUrl,
      fileLabel: sourceMeta.fileLabel,
      sourceType: sourceMeta.sourceType,
      syntax: 'html',
      text: stripCommentDecorators(full, 'html'),
      line: startLine,
      endLine,
      context: buildContextSnippet(lines, startLine, endLine, 10)
    });
  }
  return comments;
}

function extractCodeComments(text, sourceMeta, options = {}) {
  const comments = [];
  const lines = text.split(/\r?\n/);
  const lineStarts = buildLineStarts(text);
  const allowLineComments = options.allowLineComments !== false;
  let i = 0;
  let state = 'normal';
  let startIndex = -1;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === 'line') {
      if (ch === '\n') {
        const raw = text.slice(startIndex, i);
        const relStart = getLineNumberForIndex(lineStarts, startIndex);
        const relEnd = getLineNumberForIndex(lineStarts, Math.max(startIndex, i - 1));
        const startLine = sourceMeta.lineOffset + relStart - 1;
        const endLine = sourceMeta.lineOffset + relEnd - 1;
        comments.push({
          fileUrl: sourceMeta.fileUrl,
          rawUrl: sourceMeta.rawUrl || sourceMeta.fileUrl,
          fileLabel: sourceMeta.fileLabel,
          sourceType: sourceMeta.sourceType,
          syntax: 'line',
          text: stripCommentDecorators(raw, 'line'),
          line: startLine,
          endLine,
          context: buildContextSnippet(sourceMeta.fullLines || lines, startLine, endLine, 10)
        });
        state = 'normal';
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        const endExclusive = i + 2;
        const raw = text.slice(startIndex, endExclusive);
        const relStart = getLineNumberForIndex(lineStarts, startIndex);
        const relEnd = getLineNumberForIndex(lineStarts, endExclusive - 1);
        const startLine = sourceMeta.lineOffset + relStart - 1;
        const endLine = sourceMeta.lineOffset + relEnd - 1;
        comments.push({
          fileUrl: sourceMeta.fileUrl,
          rawUrl: sourceMeta.rawUrl || sourceMeta.fileUrl,
          fileLabel: sourceMeta.fileLabel,
          sourceType: sourceMeta.sourceType,
          syntax: 'block',
          text: stripCommentDecorators(raw, 'block'),
          line: startLine,
          endLine,
          context: buildContextSnippet(sourceMeta.fullLines || lines, startLine, endLine, 10)
        });
        state = 'normal';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === 'single') {
      if (ch === '\\') i += 2;
      else if (ch === '\'') { state = 'normal'; i += 1; }
      else i += 1;
      continue;
    }
    if (state === 'double') {
      if (ch === '\\') i += 2;
      else if (ch === '"') { state = 'normal'; i += 1; }
      else i += 1;
      continue;
    }
    if (state === 'template') {
      if (ch === '\\') i += 2;
      else if (ch === '`') { state = 'normal'; i += 1; }
      else i += 1;
      continue;
    }

    if (ch === '\'') { state = 'single'; i += 1; continue; }
    if (ch === '"') { state = 'double'; i += 1; continue; }
    if (ch === '`') { state = 'template'; i += 1; continue; }
    if (ch === '/' && next === '*') {
      startIndex = i;
      state = 'block';
      i += 2;
      continue;
    }
    if (allowLineComments && ch === '/' && next === '/') {
      const prev = text[i - 1] || '';
      if (prev !== ':') {
        startIndex = i;
        state = 'line';
        i += 2;
        continue;
      }
    }
    i += 1;
  }

  if (state === 'line' && startIndex >= 0) {
    const raw = text.slice(startIndex);
    const relStart = getLineNumberForIndex(lineStarts, startIndex);
    const relEnd = getLineNumberForIndex(lineStarts, text.length ? text.length - 1 : 0);
    const startLine = sourceMeta.lineOffset + relStart - 1;
    const endLine = sourceMeta.lineOffset + relEnd - 1;
    comments.push({
      fileUrl: sourceMeta.fileUrl,
      rawUrl: sourceMeta.rawUrl || sourceMeta.fileUrl,
      fileLabel: sourceMeta.fileLabel,
      sourceType: sourceMeta.sourceType,
      syntax: 'line',
      text: stripCommentDecorators(raw, 'line'),
      line: startLine,
      endLine,
      context: buildContextSnippet(sourceMeta.fullLines || lines, startLine, endLine, 10)
    });
  }

  return comments.filter(comment => comment.text && comment.text.trim());
}

function extractInlineBlocksFromHtml(html, tagName) {
  const blocks = [];
  const regex = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let match;
  while ((match = regex.exec(html))) {
    const attrs = match[1] || '';
    if (/\bsrc\s*=|\bhref\s*=/i.test(attrs)) continue;
    const openTag = match[0].slice(0, match[0].indexOf('>') + 1);
    const content = match[2] || '';
    const contentStart = match.index + openTag.length;
    blocks.push({ content, contentStart });
  }
  return blocks;
}

async function fetchTextResource(url) {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function buildCommentInventory(sources) {
  const comments = [];
  const fileSet = new Set();
  const pageUrl = sources && sources.pageUrl ? sources.pageUrl : '';
  const pageTitle = sources && sources.pageTitle ? sources.pageTitle : '';

  if (pageUrl) {
    try {
      const html = await fetchTextResource(pageUrl);
      const pageLabel = getSourceFileLabel(pageUrl);
      const fullLines = html.split(/\r?\n/);
      comments.push(...extractHtmlComments(html, {
        fileUrl: pageUrl,
        rawUrl: pageUrl,
        fileLabel: pageLabel,
        sourceType: 'html',
        lineOffset: 1,
        fullLines
      }));

      const inlineScripts = extractInlineBlocksFromHtml(html, 'script');
      inlineScripts.forEach((block, index) => {
        const lineOffset = getLineNumberForIndex(buildLineStarts(html), block.contentStart);
        comments.push(...extractCodeComments(block.content, {
          fileUrl: pageUrl,
          rawUrl: pageUrl,
          fileLabel: `${pageLabel} (inline script #${index + 1})`,
          sourceType: 'inline-script',
          lineOffset,
          fullLines
        }, { allowLineComments: true }));
      });

      const inlineStyles = extractInlineBlocksFromHtml(html, 'style');
      inlineStyles.forEach((block, index) => {
        const lineOffset = getLineNumberForIndex(buildLineStarts(html), block.contentStart);
        comments.push(...extractCodeComments(block.content, {
          fileUrl: pageUrl,
          rawUrl: pageUrl,
          fileLabel: `${pageLabel} (inline style #${index + 1})`,
          sourceType: 'inline-style',
          lineOffset,
          fullLines
        }, { allowLineComments: false }));
      });

      fileSet.add(pageUrl);
    } catch (_) {}
  }

  const externalFiles = [
    ...((sources && Array.isArray(sources.scripts) ? sources.scripts : []).map(url => ({ url, type: 'script' }))),
    ...((sources && Array.isArray(sources.stylesheets) ? sources.stylesheets : []).map(url => ({ url, type: 'stylesheet' })))
  ];

  for (const entry of externalFiles) {
    if (!entry.url || fileSet.has(entry.url)) continue;
    fileSet.add(entry.url);
    try {
      const text = await fetchTextResource(entry.url);
      const fileLabel = getSourceFileLabel(entry.url);
      comments.push(...extractCodeComments(text, {
        fileUrl: entry.url,
        rawUrl: entry.url,
        fileLabel,
        sourceType: entry.type,
        lineOffset: 1,
        fullLines: text.split(/\r?\n/)
      }, { allowLineComments: entry.type === 'script' }));
    } catch (_) {}
  }

  comments.sort((a, b) => {
    if (a.fileUrl !== b.fileUrl) return a.fileUrl.localeCompare(b.fileUrl);
    return a.line - b.line;
  });

  return { pageUrl, pageTitle, comments };
}

function computeCommentsSignature(data) {
  const list = data && Array.isArray(data.comments) ? data.comments : [];
  return list.map(comment => [
    comment.fileUrl || '',
    comment.fileLabel || '',
    comment.syntax || '',
    comment.text || '',
    comment.line || ''
  ].join('|')).join('||');
}

function renderCommentsTab() {
  const container = document.getElementById('requestsContainer');
  if (!container) return;

  const comments = Array.isArray(pageCommentsData.comments) ? pageCommentsData.comments : [];
  const fileCount = new Set(comments.map(comment => comment.fileUrl).filter(Boolean)).size;

  if (!comments.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-text">
          No source comments detected for<br>
          <span style="color:var(--blue);font-weight:600">${escapeHtml(activeTabDomain || 'this page')}</span>
        </div>
      </div>`;
    return;
  }

  const cardsHtml = comments.map(comment => {
    const meta = [comment.sourceType || 'source', `${comment.syntax} comment`, `line ${comment.line}`];
    const preview = normalizeCommentPreview(comment.text).slice(0, 180) || '(empty comment)';
    return `
      <details class="comments-card">
        <summary class="comments-card-summary">
          <div class="comments-card-meta">${escapeHtml(meta.join(' · '))}</div>
          <div class="comments-card-text">${escapeHtml(preview)}</div>
        </summary>
        <div class="comments-card-body">
          <div class="comments-card-file">File: <a href="${escapeAttribute(comment.rawUrl || comment.fileUrl || '#')}" target="_blank" rel="noopener" class="comments-card-link">${escapeHtml(comment.fileLabel || comment.fileUrl || 'Unknown file')}</a></div>
          <div class="comments-card-file">Location: line ${escapeHtml(String(comment.line || ''))}${comment.endLine && comment.endLine !== comment.line ? `-${escapeHtml(String(comment.endLine))}` : ''}</div>
          <div class="comments-card-full">${escapeHtml(comment.text || '')}</div>
          <pre class="comments-card-context"><code>${escapeHtml(comment.context || '')}</code></pre>
        </div>
      </details>
    `;
  }).join('');

  container.innerHTML = `
    <div class="comments-panel">
      <div class="comments-summary">
        <div><strong>${comments.length}</strong> comment${comments.length === 1 ? '' : 's'} detected</div>
        <div>${fileCount} file${fileCount === 1 ? '' : 's'} scanned</div>
        ${pageCommentsData.pageTitle ? `<div>${escapeHtml(pageCommentsData.pageTitle)}</div>` : ''}
      </div>
      ${cardsHtml}
    </div>
  `;
}

function buildCommentsCardBody(comment) {
  if (!comment) return '';
  const lang = getCodeLanguage(comment);
  const contextHtml = highlightCode(comment.context || '', lang);
  return `
    <div class="comments-card-file">File: <a href="${escapeAttribute(comment.rawUrl || comment.fileUrl || '#')}" target="_blank" rel="noopener" class="comments-card-link">${escapeHtml(comment.fileLabel || comment.fileUrl || 'Unknown file')}</a></div>
    <div class="comments-card-file">Location: line ${escapeHtml(String(comment.line || ''))}${comment.endLine && comment.endLine !== comment.line ? `-${escapeHtml(String(comment.endLine))}` : ''}</div>
    <div class="comments-card-full">${escapeHtml(comment.text || '')}</div>
    <pre class="comments-card-context"><code>${contextHtml}</code></pre>
  `;
}

function attachCommentsHandlers() {
  document.querySelectorAll('.comments-card[data-comment-index]').forEach(card => {
    card.addEventListener('toggle', () => {
      if (!card.open) return;
      const index = Number(card.getAttribute('data-comment-index'));
      const body = card.querySelector('.comments-card-body');
      if (!body || body.getAttribute('data-rendered') === 'true') return;
      const comment = pageCommentsData.comments && pageCommentsData.comments[index];
      body.innerHTML = buildCommentsCardBody(comment);
      body.setAttribute('data-rendered', 'true');
    });
  });
}

function renderCommentsTabEnhanced() {
  const container = document.getElementById('requestsContainer');
  if (!container) return;

  const comments = Array.isArray(pageCommentsData.comments) ? pageCommentsData.comments : [];
  const fileCount = new Set(comments.map(comment => comment.fileUrl).filter(Boolean)).size;

  if (!comments.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-text">
          No source comments detected for<br>
          <span style="color:var(--blue);font-weight:600">${escapeHtml(activeTabDomain || 'this page')}</span>
        </div>
      </div>`;
    return;
  }

  const cardsHtml = comments.map((comment, index) => {
    const meta = [comment.sourceType || 'source', `${comment.syntax} comment`, `line ${comment.line}`];
    const preview = normalizeCommentPreview(comment.text).slice(0, 180) || '(empty comment)';
    return `
      <details class="comments-card" data-comment-index="${index}">
        <summary class="comments-card-summary">
          <div class="comments-card-summary-main">
            <div class="comments-card-meta">${escapeHtml(meta.join(' | '))}</div>
            <div class="comments-card-text">${escapeHtml(preview)}</div>
          </div>
          <div class="comments-card-chevron" aria-hidden="true">▾</div>
        </summary>
        <div class="comments-card-body" data-rendered="false"></div>
      </details>
    `;
  }).join('');

  container.innerHTML = `
    <div class="comments-panel">
      <div class="comments-summary">
        <div><strong>${comments.length}</strong> comment${comments.length === 1 ? '' : 's'} detected</div>
        <div>${fileCount} file${fileCount === 1 ? '' : 's'} scanned</div>
        ${pageCommentsData.pageTitle ? `<div>${escapeHtml(pageCommentsData.pageTitle)}</div>` : ''}
      </div>
      ${cardsHtml}
    </div>
  `;

  attachCommentsHandlers();
}

function renderCurrentTab(requests) {
  const container = document.getElementById('requestsContainer');

  let filteredRequests = requests.filter(req => {
    if (!activeTabDomain) return false;
    if (req.initiator) {
      try { if (new URL(req.initiator).hostname === activeTabDomain) return true; } catch {}
    }
    if (req.url) {
      try { if (new URL(req.url).hostname === activeTabDomain) return true; } catch {}
    }
    return false;
  });
  if (requestUrlSearchQuery.trim()) {
    filteredRequests = filteredRequests.filter(req => matchRequestSearch(req, requestUrlSearchQuery));
  }
  if (requestFilterMethods.size > 0) {
    filteredRequests = filteredRequests.filter(req => requestFilterMethods.has((req.method || '').toUpperCase()));
  }
  if (requestFilterTypes.size > 0) {
    filteredRequests = filteredRequests.filter(req => {
      const t = (req.type || 'fetch').toLowerCase();
      return requestFilterTypes.has(t);
    });
  }

  if (filteredRequests.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-text">
          No requests captured for<br>
          <span style="color:var(--blue);font-weight:600">${activeTabDomain || 'this tab'}</span>
        </div>
      </div>`;
    return;
  }

  let html = '';

  const groups = groupGraphQLRequests(filteredRequests);
  combinedRequestsCache = [];
  groups.forEach(group => {
    const combined = buildCombinedRequest(group);
    if (!combined) return;
    combinedRequestsCache.push(combined);
    let domain = '', pathname = '';
    try { const u = new URL(combined.url); domain = u.hostname; pathname = u.pathname; } catch { domain = combined.url; }
    const idx = combinedRequestsCache.length - 1;
    html += `
      <div class="request-card combined-card" data-combined-index="${idx}">
        <div class="combined-badge" style="margin-bottom: 0; padding: 1px 6px; font-size: 8px; flex-shrink: 0;">COMBINED</div>
        <div class="request-method method-post" style="margin-bottom: 0; min-width: 38px; padding: 1px 4px; font-size: 8px;">POST</div>
        <div class="request-url" style="font-size: 10px;">${domain}${pathname}</div>
        <div class="combined-info" style="margin-top: 0; font-size: 8px; flex-shrink: 0;">(${combined._combinedCount} queries)</div>
      </div>`;
  });

  html += filteredRequests.map((req) => {
    const mc = `method-${req.method.toLowerCase()}`;
    let displayUrl;
    try {
      const u = new URL(req.url);
      displayUrl = u.origin + u.pathname;
    } catch {
      displayUrl = req.url;
    }
    const originalIndex = currentRequests.findIndex(r => r.id === req.id);
    const typeLabel = (req.type || 'fetch').toLowerCase() === 'document' ? 'Document' : 'Fetch';
    const typeClass = typeLabel === 'Document' ? 'request-type-document' : 'request-type-fetch';
    return `
      <div class="request-card" data-index="${originalIndex}">
        <div class="request-method ${mc}">${req.method}</div>
        <div class="request-type ${typeClass}">${typeLabel}</div>
        <div class="request-url" title="${escapeHtml(req.url)}">${escapeHtml(displayUrl)}</div>
        <div class="request-time">${formatTime(req.timestamp)}</div>
      </div>`;
  }).join('');

  container.innerHTML = html;
  attachCardHandlers();
}

function renderHistoryTab(requests) {
  const container = document.getElementById('requestsContainer');

  let filteredRequests = requests;
  if (requestFilterMethods.size > 0) {
    filteredRequests = filteredRequests.filter(req => requestFilterMethods.has((req.method || '').toUpperCase()));
  }
  if (requestFilterTypes.size > 0) {
    filteredRequests = filteredRequests.filter(req => {
      const t = (req.type || 'fetch').toLowerCase();
      return requestFilterTypes.has(t);
    });
  }

  const groups = {};
  filteredRequests.forEach(req => {
    let domain;
    if (req.initiator) {
      try { domain = new URL(req.initiator).hostname; } catch { domain = req.initiator; }
    } else {
      try { domain = new URL(req.url).hostname; } catch { domain = 'Unknown'; }
    }
    if (!groups[domain]) groups[domain] = [];
    groups[domain].push(req);
  });

  const domains = Object.keys(groups).sort();
  
  if (domains.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-text">No history available</div></div>';
    return;
  }

  let html = domains.map(domain => {
    const domainRequests = groups[domain];
    const reqHtml = domainRequests.map(req => {
      const mc = `method-${req.method.toLowerCase()}`;
      const originalIndex = currentRequests.findIndex(r => r.id === req.id);
      let displayUrl;
      try {
        const u = new URL(req.url);
        displayUrl = u.origin + u.pathname;
      } catch {
        displayUrl = req.url;
      }
      const typeLabel = (req.type || 'fetch').toLowerCase() === 'document' ? 'Document' : 'Fetch';
      const typeClass = typeLabel === 'Document' ? 'request-type-document' : 'request-type-fetch';
      return `
        <div class="request-card" data-index="${originalIndex}" style="margin-bottom: 4px; padding: 4px 8px;">
          <div class="request-method ${mc}" style="min-width: 38px; padding: 1px 4px; font-size: 8px;">${req.method}</div>
          <div class="request-type ${typeClass}" style="font-size: 8px;">${typeLabel}</div>
          <div class="request-url" style="font-size: 10px;" title="${escapeHtml(req.url)}">${escapeHtml(displayUrl)}</div>
          <div class="request-time" style="font-size: 8px;">${formatTime(req.timestamp)}</div>
        </div>`;
    }).join('');

    return `
      <div class="history-domain-group">
        <div class="history-domain-header">
          <span class="history-domain-name">${domain}</span>
          <span class="history-domain-count">${domainRequests.length}</span>
        </div>
        <div class="history-requests">
          ${reqHtml}
        </div>
      </div>`;
  }).join('');

  container.innerHTML = html;
  attachHistoryHandlers();
}

function renderActiveInterceptionTab() {
  const container = document.getElementById('requestsContainer');
  let entries = Array.isArray(activeInterceptionEntries) ? activeInterceptionEntries.slice() : [];

  if (requestFilterMethods.size > 0) {
    entries = entries.filter(entry => requestFilterMethods.has((entry.method || '').toUpperCase()));
  }
  if (requestUrlSearchQuery.trim()) {
    const query = requestUrlSearchQuery.trim();
    entries = entries.filter(entry => {
      const sourceText = Array.isArray(entry.sourceScripts) ? entry.sourceScripts.join(' ') : '';
      const matcherText = Array.isArray(entry.matchers) ? entry.matchers.join(' ') : '';
      const searchable = `${entry.url || ''} ${entry.rawUrl || ''} ${sourceText} ${matcherText} ${entry.method || ''}`;
      return matchRequestSearch({ url: searchable, responseBody: searchable }, query);
    });
  }

  if (entries.length === 0) {
    const scriptsScanned = Number(activeInterceptionStats && activeInterceptionStats.scriptsScanned) || 0;
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-text">
          No active endpoint candidates yet.<br>
          JS files scanned: <span style="color:var(--blue);font-weight:600">${scriptsScanned}</span>
        </div>
      </div>`;
    return;
  }

  const dbEntries = entries.filter(e => e.isDb === true);
  const apiEntries = entries.filter(e => e.isDb !== true);
  const storageDbCount = Number(activeInterceptionStats && activeInterceptionStats.storageDbCount) ?? dbEntries.length;

  const summary = `Scripts scanned: ${Number(activeInterceptionStats.scriptsScanned) || 0} | ` +
    `Storage & DB: ${storageDbCount} | ` +
    `Endpoint candidates: ${entries.length} | ` +
    `Hits: ${Number(activeInterceptionStats.endpointHits) || 0}`;

  function buildEndpointCard(entry, idx, isDb) {
    const endpointRequest = buildActiveEndpointRequest(entry);
    const commandPs = generateCurlForMode('ps', endpointRequest);
    const sourceScripts = Array.isArray(entry.sourceScripts) ? entry.sourceScripts : [];
    const sourcePreview = sourceScripts.slice(0, 3).join('\n');
    const sourceMore = sourceScripts.length > 3 ? `\n+${sourceScripts.length - 3} more scripts` : '';
    const matchers = Array.isArray(entry.matchers) ? entry.matchers.join(', ') : (entry.matcher || 'unknown');
    const confidence = (entry.confidence || 'medium').toUpperCase();
    const seenText = formatLastSeen(entry.lastSeen);
    const dynamicNote = entry.dynamic ? '\nDynamic URL: this candidate may require runtime values.' : '';
    const cmdPreId = `activeEndpointCmd_${idx}`;

    const contextText = entry.contextSnippet || (entry.snippet ? `    1 | ${entry.snippet}` : '');
    const contextBlock = isDb && contextText
      ? `<div class="active-endpoint-context"><pre class="comments-card-context"><code>${highlightCode(contextText, 'javascript')}</code></pre></div>`
      : '';

    const shellBlock = !isDb
      ? `<div class="active-shell-container">
          <div class="active-shell-header-row">
            <div class="shell-toggle">
              <button class="shell-btn active" data-mode="ps" data-entry-index="${idx}" title="PowerShell">PS</button>
              <button class="shell-btn" data-mode="cmd" data-entry-index="${idx}" title="Command Prompt">CMD</button>
              <button class="shell-btn" data-mode="bash" data-entry-index="${idx}" title="Linux / macOS (curl)">Bash</button>
            </div>
            <button class="copy-btn active-shell-copy" data-entry-index="${idx}">Copy</button>
          </div>
          <pre class="active-shell-command curl-command" id="${cmdPreId}">${escapeHtml(commandPs)}</pre>
        </div>`
      : '';

    return `
      <div class="active-endpoint-card" data-entry-index="${idx}">
        <div class="active-endpoint-head">
          <span class="active-endpoint-method">${escapeHtml(entry.method || 'GET')}</span>
          <span class="active-endpoint-confidence active-endpoint-confidence-${escapeHtml((entry.confidence || 'medium').toLowerCase())}">${escapeHtml(confidence)} confidence</span>
        </div>
        <div class="active-endpoint-url">${escapeHtml(entry.url || entry.rawUrl || '')}</div>
        <div class="active-endpoint-meta">Seen ${escapeHtml(seenText)} | Matches: ${escapeHtml(String(entry.occurrences || 1))} | Detector(s): ${escapeHtml(matchers)}
Sources:
${escapeHtml(sourcePreview + sourceMore + dynamicNote)}</div>
        ${contextBlock}
        ${shellBlock}
      </div>
    `;
  }

  const dbCardsHtml = dbEntries.map(entry => {
    const idx = activeInterceptionEntries.findIndex(e => e.key === entry.key);
    return buildEndpointCard(entry, idx >= 0 ? idx : 0, true);
  }).join('');
  const apiCardsHtml = apiEntries.map(entry => {
    const idx = activeInterceptionEntries.findIndex(e => e.key === entry.key);
    return buildEndpointCard(entry, idx >= 0 ? idx : 0, false);
  }).join('');

  const storageDbSection = dbEntries.length > 0
    ? `<div class="active-interception-section">
        <div class="active-interception-section-title">Storage & DB</div>
        ${dbCardsHtml}
      </div>`
    : '';
  const apiSection = apiEntries.length > 0
    ? `<div class="active-interception-section">
        <div class="active-interception-section-title">API endpoints</div>
        ${apiCardsHtml}
      </div>`
    : '';

  container.innerHTML = `
    <div class="active-interception-panel">
      <div class="active-interception-summary">${escapeHtml(summary)}</div>
      ${storageDbSection}
      ${apiSection}
    </div>
  `;

  attachActiveInterceptionHandlers();
}

function attachActiveInterceptionHandlers() {
  document.querySelectorAll('.active-endpoint-card .shell-btn[data-mode][data-entry-index]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-entry-index'), 10);
      const mode = btn.getAttribute('data-mode');
      if (!Number.isFinite(idx) || !mode || !activeInterceptionEntries[idx]) return;
      const entry = activeInterceptionEntries[idx];
      const request = buildActiveEndpointRequest(entry);
      const command = generateCurlForMode(mode, request);
      const card = btn.closest('.active-endpoint-card');
      if (!card) return;
      const pre = card.querySelector('.active-shell-command');
      if (pre) pre.textContent = command;
      card.querySelectorAll('.shell-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.querySelectorAll('.active-shell-copy').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute('data-entry-index'), 10);
      if (!Number.isFinite(idx)) return;
      const card = btn.closest('.active-endpoint-card');
      if (!card) return;
      const pre = card.querySelector('.active-shell-command');
      if (!pre) return;
      copyTextWithButtonFeedback(pre.textContent || '', btn);
    });
  });
}

function attachCardHandlers() {
  document.querySelectorAll('.combined-card').forEach(c => {
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(c.dataset.combinedIndex);
      modalList = combinedRequestsCache;
      modalIndex = index;
      showRequestDetails(modalList[modalIndex]);
    });
  });
  document.querySelectorAll('.request-card:not(.combined-card)').forEach(c => {
    if (c.dataset.index === undefined) return;
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = parseInt(c.dataset.index);
      if (currentView === 'current') {
        const filtered = currentRequests.filter(req => {
          if (!activeTabDomain) return false;
          if (req.initiator) {
            try { if (new URL(req.initiator).hostname === activeTabDomain) return true; } catch {}
          }
          if (req.url) {
            try { if (new URL(req.url).hostname === activeTabDomain) return true; } catch {}
          }
          return false;
        });
        modalList = filtered;
        modalIndex = modalList.findIndex(r => r.id === currentRequests[index].id);
      } else {
        modalList = currentRequests;
        modalIndex = index;
      }
      showRequestDetails(modalList[modalIndex]);
    });
  });
}

function attachHistoryHandlers() {
  document.querySelectorAll('.history-domain-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('open');
    });
  });
  
  attachCardHandlers();
}

function showRequestDetails(request) {
  if (!request) return;
  
  const modal = document.getElementById('detailModal');
  const isCombined = request.type === 'combined';
  const suffix = isCombined ? ` (${request._combinedCount} queries → 1 request)` : '';

  const prevBtn = document.getElementById('prevRequest');
  const nextBtn = document.getElementById('nextRequest');
  const navInfo = document.getElementById('navInfo');

  if (prevBtn && nextBtn && navInfo) {
    prevBtn.disabled = modalIndex <= 0;
    nextBtn.disabled = modalIndex >= modalList.length - 1;
    navInfo.textContent = `${modalIndex + 1} / ${modalList.length}`;
  }

  document.getElementById('curlLabel').textContent = 'cURL Command' + suffix;
  document.getElementById('curlCommand').textContent = generateCurl(request);

  const infoSection = document.getElementById('combinedInfoSection');
  if (isCombined && request._descriptions) {
    infoSection.style.display = 'block';
    infoSection.querySelector('.info-content').innerHTML =
      `<strong>${request._combinedCount} queries merged using GraphQL aliases:</strong><br>` +
      request._descriptions.map(d => `&nbsp;&nbsp;• ${d}`).join('<br>') +
      '<br><br><em>Response data will be under keys q0, q1, q2, etc.</em>';
  } else {
    infoSection.style.display = 'none';
  }

  document.getElementById('detailUrl').innerHTML = '<pre class="code-block"><code>' + escapeHtml(request.url || '') + '</code></pre>';
  document.getElementById('detailMethod').innerHTML =
    `<strong>Method:</strong> ${request.method}<br>` +
    `<strong>Time:</strong> ${new Date(request.timestamp).toLocaleString()}<br>` +
    `<strong>Type:</strong> ${request.type}`;

  const dh = document.getElementById('detailHeaders');
  if (request.headers) {
    const hdrs = Array.isArray(request.headers) ? request.headers : Object.entries(request.headers);
    const filtered = hdrs.filter(h => { const v = h.value||h[1]; return v && String(v)!=='undefined' && String(v)!=='null'; });
    const headersText = filtered.length
      ? filtered.map(h => `${h.name||h[0]}: ${h.value||h[1]}`).join('\n')
      : 'No headers captured';
    dh.innerHTML = '<pre class="code-block"><code>' + escapeHtml(headersText) + '</code></pre>';
  } else {
    dh.innerHTML = '<pre class="code-block"><code>No headers captured</code></pre>';
  }

  const bs = document.getElementById('bodySection');
  const db = document.getElementById('detailBody');
  if (request.body && request.body !== 'null') {
    bs.style.display = 'block';
    let bodyStr;
    if (typeof request.body === 'string') {
      try { bodyStr = JSON.stringify(JSON.parse(request.body), null, 2); }
      catch { bodyStr = request.body; }
    } else if (typeof request.body === 'object') {
      bodyStr = JSON.stringify(request.body, null, 2);
    } else { bodyStr = String(request.body); }
    try {
      JSON.parse(bodyStr);
      db.innerHTML = '<pre class="json-display"><code>' + highlightJson(bodyStr) + '</code></pre>';
    } catch {
      db.textContent = bodyStr;
    }
  } else { bs.style.display = 'none'; }

  const rs = document.getElementById('responseSection');
  const dr = document.getElementById('detailResponse');
  const responseTitleEl = document.getElementById('responseSectionTitle');
  const isDocument = (request.type || '').toLowerCase() === 'document';
  const hasResponseBody = request.responseBody && request.responseBody !== 'null';

  if (isDocument || hasResponseBody) {
    rs.style.display = 'block';
    responseTitleEl.textContent = isDocument ? 'Document Contents' : 'Response Body';
    if (hasResponseBody) {
      let respStr;
      if (typeof request.responseBody === 'string') {
        const stripped = stripJsonXssiPrefix(request.responseBody);
        try { respStr = JSON.stringify(JSON.parse(stripped), null, 2); }
        catch { respStr = request.responseBody; }
      } else {
        respStr = String(request.responseBody);
      }
      if (isDocument) {
        dr.innerHTML = '<pre class="code-block html-code-block"><code>' + highlightCode(respStr, 'html') + '</code></pre>';
      } else {
        const toParse = stripJsonXssiPrefix(respStr);
        try {
          const parsed = JSON.parse(toParse);
          const formatted = JSON.stringify(parsed, null, 2);
          dr.innerHTML = '<pre class="json-display"><code>' + highlightJson(formatted) + '</code></pre>';
        } catch {
          dr.textContent = respStr;
        }
      }
    } else {
      dr.textContent = isDocument ? '(No document content captured. Main frame responses are not intercepted by the extension.)' : '(No response body)';
    }
  } else {
    rs.style.display = 'none';
    if (responseTitleEl) responseTitleEl.textContent = 'Response Body';
  }

  document.getElementById('detailModal').classList.add('active');
}

function copyElement(textId, btnId) {
  const el  = document.getElementById(textId);
  const btn = document.getElementById(btnId);
  navigator.clipboard.writeText(el.textContent).then(() => {
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
  });
}

function closeModal() { document.getElementById('detailModal').classList.remove('active'); }

function navigateModal(direction) {
  const newIndex = modalIndex + direction;
  if (newIndex >= 0 && newIndex < modalList.length) {
    modalIndex = newIndex;
    showRequestDetails(modalList[modalIndex]);
  }
}

function getActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      activeTabId = tabs[0].id;
      activeTabUrl = tabs[0].url || '';
      try { activeTabDomain = new URL(tabs[0].url).hostname; } catch { activeTabDomain = ''; }
      if (currentView === 'current' || currentView === 'history') {
        startCurrentHistoryRefresh();
      } else {
        stopCurrentHistoryRefresh();
      }
      if (currentView === 'comments') {
        loadPageComments(() => renderCommentsTabEnhanced());
      } else {
        loadRequests();
      }
    } else {
      activeTabId = -1;
      activeTabUrl = '';
      activeTabDomain = '';
    }
  });
}

function updateActiveInterceptionSummaryOnly() {
  const summaryEl = document.querySelector('.active-interception-summary');
  if (!summaryEl || currentView !== 'activeInterception') return;
  let entries = Array.isArray(activeInterceptionEntries) ? activeInterceptionEntries.slice() : [];
  if (requestFilterMethods.size > 0) entries = entries.filter(e => requestFilterMethods.has((e.method || '').toUpperCase()));
  if (requestUrlSearchQuery.trim()) {
    const q = requestUrlSearchQuery.trim();
    entries = entries.filter(e => {
      const t = `${e.url || ''} ${e.rawUrl || ''} ${(e.sourceScripts || []).join(' ')} ${(e.matchers || []).join(' ')}`;
      return matchRequestSearch({ url: t, responseBody: t }, q);
    });
  }
  const dbEntries = entries.filter(e => e.isDb === true);
  const storageDbCount = Number(activeInterceptionStats && activeInterceptionStats.storageDbCount) ?? dbEntries.length;
  const summary = `Scripts scanned: ${Number(activeInterceptionStats.scriptsScanned) || 0} | ` +
    `Storage & DB: ${storageDbCount} | ` +
    `Endpoint candidates: ${entries.length} | ` +
    `Hits: ${Number(activeInterceptionStats.endpointHits) || 0}`;
  summaryEl.textContent = summary;
}

function loadActiveInterceptionData(done) {
  chrome.runtime.sendMessage({ action: 'getActiveInterceptionData', tabId: activeTabId }, (response) => {
    if (response && Array.isArray(response.entries)) {
      const entries = response.entries;
      const stats = response.stats || { scriptsScanned: 0, storageDbCount: 0, endpointCount: entries.length, endpointHits: 0, updatedAt: null };
      const signature = entries.map(e => e.key || '').sort().join('|');
      if (signature && entries.length > 0 && signature === lastActiveInterceptionEntriesSignature && currentView === 'activeInterception') {
        activeInterceptionEntries = entries;
        activeInterceptionStats = stats;
        updateActiveInterceptionSummaryOnly();
        return;
      }
      lastActiveInterceptionEntriesSignature = signature;
      activeInterceptionEntries = entries;
      activeInterceptionStats = stats;
    } else {
      lastActiveInterceptionEntriesSignature = '';
      lastActiveInterceptionEntriesSignature = '';
      activeInterceptionEntries = [];
      activeInterceptionStats = { scriptsScanned: 0, storageDbCount: 0, endpointCount: 0, endpointHits: 0, updatedAt: null };
    }
    if (typeof done === 'function') done();
  });
}

function loadRequests() {
  if (currentView === 'comments') {
    loadPageComments(() => renderCommentsTabEnhanced());
    return;
  }
  const requestPayload = currentView === 'bugs'
    ? { action: 'getRequestsForBugAnalysis', tabId: activeTabId, hostname: activeTabDomain, pageUrl: activeTabUrl }
    : { action: 'getRequests' };
  chrome.runtime.sendMessage(requestPayload, r => {
    if (r && r.requests) {
      currentRequests = r.requests;
      if (currentView === 'activeInterception' || currentView === 'bugs') {
        loadActiveInterceptionData(() => renderRequests(currentRequests));
      } else {
        renderRequests(currentRequests);
      }
    }
  });
}

function stopCurrentHistoryRefresh() {
  if (currentHistoryRefreshInterval) {
    clearInterval(currentHistoryRefreshInterval);
    currentHistoryRefreshInterval = null;
  }
}

function startCurrentHistoryRefresh() {
  stopCurrentHistoryRefresh();
  currentHistoryRefreshInterval = setInterval(() => {
    if (currentView === 'current' || currentView === 'history') {
      loadRequests();
    } else {
      stopCurrentHistoryRefresh();
    }
  }, CURRENT_HISTORY_REFRESH_MS);
}

function stopTwitterRefresh() {
  if (twitterRefreshInterval) {
    clearInterval(twitterRefreshInterval);
    twitterRefreshInterval = null;
  }
}

function startTwitterRefresh() {
  stopTwitterRefresh();
  twitterRefreshInterval = setInterval(loadRequests, TWITTER_REFRESH_MS);
}

function stopTikTokRefresh() {
  if (tiktokRefreshInterval) {
    clearInterval(tiktokRefreshInterval);
    tiktokRefreshInterval = null;
  }
}

function startTikTokRefresh() {
  stopTikTokRefresh();
  tiktokRefreshInterval = setInterval(loadRequests, TIKTOK_REFRESH_MS);
}

function stopSoundCloudRefresh() {
  if (soundcloudRefreshInterval) {
    clearInterval(soundcloudRefreshInterval);
    soundcloudRefreshInterval = null;
  }
}

function startSoundCloudRefresh() {
  stopSoundCloudRefresh();
  soundcloudRefreshInterval = setInterval(loadRequests, SOUNDCLOUD_REFRESH_MS);
}

function stopDiscordRefresh() {
  if (discordRefreshInterval) {
    clearInterval(discordRefreshInterval);
    discordRefreshInterval = null;
  }
}

function startDiscordRefresh() {
  stopDiscordRefresh();
  discordRefreshInterval = setInterval(loadRequests, DISCORD_REFRESH_MS);
}

function stopFacebookRefresh() {
  if (facebookRefreshInterval) {
    clearInterval(facebookRefreshInterval);
    facebookRefreshInterval = null;
  }
}

function startFacebookRefresh() {
  stopFacebookRefresh();
  facebookRefreshInterval = setInterval(loadRequests, FACEBOOK_REFRESH_MS);
}

function stopInstagramRefresh() {
  if (instagramRefreshInterval) {
    clearInterval(instagramRefreshInterval);
    instagramRefreshInterval = null;
  }
}

function startInstagramRefresh() {
  stopInstagramRefresh();
  instagramRefreshInterval = setInterval(loadRequests, INSTAGRAM_REFRESH_MS);
}

function stopGitHubRefresh() {
  if (githubRefreshInterval) {
    clearInterval(githubRefreshInterval);
    githubRefreshInterval = null;
  }
}

function startGitHubRefresh() {
  stopGitHubRefresh();
  githubRefreshInterval = setInterval(loadRequests, GITHUB_REFRESH_MS);
}

function stopPinterestRefresh() {
  if (pinterestRefreshInterval) {
    clearInterval(pinterestRefreshInterval);
    pinterestRefreshInterval = null;
  }
}

function startPinterestRefresh() {
  stopPinterestRefresh();
  pinterestRefreshInterval = setInterval(loadRequests, PINTEREST_REFRESH_MS);
}

function stopCommentsRefresh() {
  if (commentsRefreshInterval) {
    clearInterval(commentsRefreshInterval);
    commentsRefreshInterval = null;
  }
}

function loadPageComments(done) {
  if (!Number.isFinite(activeTabId) || activeTabId < 0) {
    pageCommentsData = { pageUrl: '', pageTitle: '', comments: [] };
    if (typeof done === 'function') done();
    return;
  }
  const prevSignature = lastCommentsDataSignature;
  chrome.tabs.sendMessage(activeTabId, { action: 'getPageCommentSources' }, async (response) => {
    if (chrome.runtime.lastError || !response) {
      pageCommentsData = { pageUrl: '', pageTitle: '', comments: [] };
      lastCommentsDataSignature = '';
      if (typeof done === 'function') done();
      return;
    }
    try {
      pageCommentsData = await buildCommentInventory(response);
      lastCommentsDataSignature = computeCommentsSignature(pageCommentsData);
    } catch (_) {
      pageCommentsData = { pageUrl: response.pageUrl || '', pageTitle: response.pageTitle || '', comments: [] };
      lastCommentsDataSignature = '';
    }
    if (typeof done === 'function' && (lastCommentsDataSignature !== prevSignature || !(pageCommentsData.comments && pageCommentsData.comments.length))) done();
  });
}

function startCommentsRefresh() {
  stopCommentsRefresh();
  commentsRefreshInterval = setInterval(() => {
    loadPageComments(() => {
      if (currentView === 'comments') renderCommentsTabEnhanced();
    });
  }, COMMENTS_REFRESH_MS);
}

function stopActiveInterceptionRefresh() {
  if (activeInterceptionRefreshInterval) {
    clearInterval(activeInterceptionRefreshInterval);
    activeInterceptionRefreshInterval = null;
  }
}

function startActiveInterceptionRefresh() {
  stopActiveInterceptionRefresh();
  activeInterceptionRefreshInterval = setInterval(() => {
    loadRequests();
  }, ACTIVE_INTERCEPTION_REFRESH_MS);
}

function clearRequests() {
  chrome.runtime.sendMessage({ action: 'clearRequests' }, r => {
    if (r && r.success) {
      currentRequests = [];
      combinedRequestsCache = [];
      lastActiveInterceptionEntriesSignature = '';
      activeInterceptionEntries = [];
      activeInterceptionStats = { scriptsScanned: 0, storageDbCount: 0, endpointCount: 0, endpointHits: 0, updatedAt: null };
      pageCommentsData = { pageUrl: '', pageTitle: '', comments: [] };
      lastCommentsDataSignature = '';
      renderRequests(currentRequests);
    }
  });
}

function exportHistoryToFile() {
  chrome.runtime.sendMessage({ action: 'getRequestsForExport' }, (r) => {
    if (!r || !Array.isArray(r.requests)) return;
    const payload = { version: 1, exportedAt: new Date().toISOString(), requests: r.requests };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    if (typeof showSaveFilePicker !== 'undefined') {
      showSaveFilePicker({ suggestedName: 'requeststealer_history.json', types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }] })
        .then((handle) => handle.createWritable())
        .then((writable) => writable.write(blob).then(() => writable.close()))
        .catch(() => {});
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'requeststealer_history.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  });
}

function importHistoryFromFile() {
  if (typeof showOpenFilePicker !== 'undefined') {
    showOpenFilePicker({ types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }], multiple: false })
      .then(([fileHandle]) => fileHandle.getFile())
      .then((file) => file.text())
      .then((text) => {
        let list = [];
        try {
          const data = JSON.parse(text);
          list = Array.isArray(data) ? data : (data && Array.isArray(data.requests) ? data.requests : []);
        } catch (_) {}
        if (list.length === 0) return;
        chrome.runtime.sendMessage({ action: 'importHistory', requests: list }, (r) => {
          if (r && r.success) { loadRequests(); }
        });
      })
      .catch(() => {});
  } else {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        let list = [];
        try {
          const data = JSON.parse(reader.result);
          list = Array.isArray(data) ? data : (data && Array.isArray(data.requests) ? data.requests : []);
        } catch (_) {}
        if (list.length === 0) return;
        chrome.runtime.sendMessage({ action: 'importHistory', requests: list }, (r) => {
          if (r && r.success) { loadRequests(); }
        });
      };
      reader.readAsText(file);
    };
    input.click();
  }
}

function loadShellMode() {
  const saved = localStorage.getItem('shellMode');
  if (saved === 'cmd' || saved === 'ps' || saved === 'bash') shellMode = saved;
  updateShellToggle();
}

function updateShellToggle() {
  const psBtn = document.getElementById('shellPS');
  const cmdBtn = document.getElementById('shellCMD');
  const bashBtn = document.getElementById('shellBash');
  if (!psBtn || !cmdBtn || !bashBtn) return;
  psBtn.classList.toggle('active', shellMode === 'ps');
  cmdBtn.classList.toggle('active', shellMode === 'cmd');
  bashBtn.classList.toggle('active', shellMode === 'bash');
}

function switchShellMode(mode) {
  shellMode = mode;
  localStorage.setItem('shellMode', mode);
  chrome.storage.local.set({ shellMode: mode });
  updateShellToggle();
  if (modalList.length > 0 && modalIndex >= 0 && modalList[modalIndex]) {
    document.getElementById('curlCommand').textContent = generateCurl(modalList[modalIndex]);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateThemeIcon();
  loadShellMode();

  const requestsContainer = document.getElementById('requestsContainer');
  requestsContainer.addEventListener('wheel', (e) => {
    if (!e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const codeBlock = e.target.closest('.bug-code-wrap .comments-card-context, .comments-card-context');
    const scrollEl = (codeBlock && codeBlock.scrollWidth > codeBlock.clientWidth)
      ? codeBlock
      : (requestsContainer.scrollWidth > requestsContainer.clientWidth ? requestsContainer : null);
    if (scrollEl) {
      e.preventDefault();
      scrollEl.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  requestsContainer.addEventListener('click', (e) => {
    const img = e.target.closest('img');
    if (img && img.src) {
      e.preventDefault();
      const url = img.src;
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create)
          chrome.tabs.create({ url });
        else
          window.open(url, '_blank', 'noopener');
      } catch (_) {
        window.open(url, '_blank', 'noopener');
      }
      return;
    }
    const el = e.target.closest('.tiktok-download-captions');
    if (!el) return;
    e.preventDefault();
    const url = el.getAttribute('data-caption-url');
    const videoId = el.getAttribute('data-video-id');
    if (url) downloadTikTokCaptionsAsTxt(url, videoId);
  });

  document.getElementById('refreshBtn').addEventListener('click', () => {
    const container = document.getElementById('requestsContainer');
    if (container) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-text">
            Reloading page...<br>
            Waiting for page to finish loading
          </div>
        </div>`;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) return;
      const tabId = tabs[0].id;
      if (tabs[0].url) {
        try { activeTabDomain = new URL(tabs[0].url).hostname; } catch {}
      }

      const finishRefresh = () => {
        chrome.tabs.onUpdated.removeListener(onComplete);
        clearTimeout(timeoutId);
        lastTwitterDataSignature = '';
        lastTikTokDataSignature = '';
        lastSoundCloudDataSignature = '';
        lastDiscordDataSignature = '';
        lastFacebookDataSignature = '';
        lastInstagramDataSignature = '';
        lastGitHubDataSignature = '';
        lastPinterestDataSignature = '';
        lastCommentsDataSignature = '';
        loadRequests();
      };

      const onComplete = (id, changeInfo) => {
        if (id === tabId && changeInfo.status === 'complete') finishRefresh();
      };
      chrome.tabs.onUpdated.addListener(onComplete);
      const timeoutId = setTimeout(finishRefresh, 15000);

      chrome.tabs.reload(tabId);
    });
  });
  document.getElementById('clearBtn').addEventListener('click', clearRequests);
  document.getElementById('exportHistoryBtn').addEventListener('click', () => exportHistoryToFile());

  (function initRequestSearch() {
    const popup = document.getElementById('requestSearchPopup');
    const input = document.getElementById('requestSearchInput');
    const searchBtn = document.getElementById('searchRequestsBtn');
    if (!popup || !input || !searchBtn) return;
    searchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const visible = popup.classList.toggle('visible');
      if (visible) {
        input.value = requestUrlSearchQuery;
        input.focus();
      }
    });
    input.addEventListener('input', () => {
      requestUrlSearchQuery = input.value;
      renderRequests(currentRequests);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        popup.classList.remove('visible');
        searchBtn.focus();
      }
    });
    document.addEventListener('click', (e) => {
      if (popup.classList.contains('visible') && !popup.contains(e.target) && !searchBtn.contains(e.target)) {
        popup.classList.remove('visible');
      }
    });
  })();

  (function initRequestFilter() {
    const filterPopup = document.getElementById('requestFilterPopup');
    const filterBtn = document.getElementById('filterRequestsBtn');
    const methodsEl = document.getElementById('filterMethodsOptions');
    const typesEl = document.getElementById('filterTypesOptions');
    const hideStaticEl = document.getElementById('filterHideStatic');
    if (!filterPopup || !filterBtn || !methodsEl || !typesEl) return;

    methodsEl.innerHTML = FILTER_METHODS.map(m => {
      const id = 'filter-method-' + m;
      const checked = requestFilterMethods.has(m) ? ' checked' : '';
      return `<label><input type="checkbox" id="${id}" data-method="${m}"${checked}>${m}</label>`;
    }).join('');
    typesEl.innerHTML = FILTER_TYPES.map(t => {
      const id = 'filter-type-' + t;
      const label = t === 'document' ? 'Document' : 'Fetch';
      const checked = requestFilterTypes.has(t) ? ' checked' : '';
      return `<label><input type="checkbox" id="${id}" data-type="${t}"${checked}>${label}</label>`;
    }).join('');

    function syncHideStaticCheckbox() {
      if (hideStaticEl) hideStaticEl.checked = hideStaticResources;
    }

    filterPopup.querySelectorAll('input[data-method]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) requestFilterMethods.add(cb.dataset.method);
        else requestFilterMethods.delete(cb.dataset.method);
        renderRequests(currentRequests);
      });
    });
    filterPopup.querySelectorAll('input[data-type]').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) requestFilterTypes.add(cb.dataset.type);
        else requestFilterTypes.delete(cb.dataset.type);
        renderRequests(currentRequests);
      });
    });

    if (hideStaticEl) {
      syncHideStaticCheckbox();
      hideStaticEl.addEventListener('change', () => {
        hideStaticResources = hideStaticEl.checked;
        chrome.storage.local.set({ [STATIC_FILTER_STORAGE_KEY]: hideStaticResources });
        chrome.runtime.sendMessage({ action: 'setHideStaticResources', enabled: hideStaticResources }, () => {
          loadRequests();
        });
      });
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      const change = changes[STATIC_FILTER_STORAGE_KEY];
      if (!change || typeof change.newValue !== 'boolean' || change.newValue === hideStaticResources) return;
      hideStaticResources = change.newValue;
      syncHideStaticCheckbox();
      loadRequests();
    });

    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('requestSearchPopup').classList.remove('visible');
      filterPopup.classList.toggle('visible');
      if (filterPopup.classList.contains('visible')) syncHideStaticCheckbox();
    });
    document.addEventListener('click', (e) => {
      if (filterPopup.classList.contains('visible') && !filterPopup.contains(e.target) && !filterBtn.contains(e.target)) {
        filterPopup.classList.remove('visible');
      }
    });
  })();

  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('copyCurlBtn').addEventListener('click', () => copyElement('curlCommand', 'copyCurlBtn'));
  document.getElementById('copyResponseBtn').addEventListener('click', () => copyElement('detailResponse', 'copyResponseBtn'));

  document.getElementById('prevRequest').addEventListener('click', () => navigateModal(-1));
  document.getElementById('nextRequest').addEventListener('click', () => navigateModal(1));

  document.getElementById('shellPS').addEventListener('click', () => switchShellMode('ps'));
  document.getElementById('shellCMD').addEventListener('click', () => switchShellMode('cmd'));
  document.getElementById('shellBash').addEventListener('click', () => switchShellMode('bash'));

  const tabsRoot = document.querySelector('.tabs');
  if (tabsRoot) {
    tabsRoot.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      tabsRoot.querySelectorAll('.tab-btn').forEach(tabBtn => {
        tabBtn.classList.toggle('active', tabBtn === btn);
      });
      document.getElementById('settingsBtn')?.classList.remove('active');
      if (btn.id !== 'discordTabBtn') {
        document.getElementById('discordToolbar').style.display = 'none';
      }
      if (btn.id !== 'commentsTabBtn') {
        stopCommentsRefresh();
      }
      if (btn.id !== 'activeInterceptionTabBtn') {
        stopActiveInterceptionRefresh();
      }
      if (btn.id !== 'bugsTabBtn' && typeof stopBugRefresh === 'function') {
        stopBugRefresh();
      }
    });
  }

  tabVisibilityUiReady = true;
  applyTabVisibilitySettings();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const change = changes[TAB_VISIBILITY_STORAGE_KEY];
    if (!change) return;
    tabVisibilitySettings = normalizeTabVisibilitySettings(change.newValue);
    syncTabVisibilityUi();
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    currentView = 'settings';
    document.getElementById('requestSearchPopup').classList.remove('visible');
    document.getElementById('requestFilterPopup').classList.remove('visible');
    document.getElementById('discordToolbar').style.display = 'none';
    document.getElementById('settingsBtn').classList.add('active');
    document.querySelectorAll('.tabs .tab-btn').forEach(tabBtn => tabBtn.classList.remove('active'));
    stopAllViewRefreshes();
    resetAllPlatformDataSignatures();
    renderRequests(currentRequests);
  });

  document.getElementById('currentTabBtn').addEventListener('click', () => {
    currentView = 'current';
    document.getElementById('discordToolbar').style.display = 'none';
    document.getElementById('currentTabBtn').classList.add('active');
    document.getElementById('historyTabBtn').classList.remove('active');
    document.getElementById('twitterTabBtn').classList.remove('active');
    document.getElementById('tiktokTabBtn').classList.remove('active');
    document.getElementById('soundcloudTabBtn').classList.remove('active');
    document.getElementById('discordTabBtn').classList.remove('active');
    document.getElementById('facebookTabBtn').classList.remove('active');
    document.getElementById('instagramTabBtn').classList.remove('active');
    document.getElementById('githubTabBtn').classList.remove('active');
    document.getElementById('pinterestTabBtn').classList.remove('active');
    stopTwitterRefresh();
    stopTikTokRefresh();
    stopSoundCloudRefresh();
    stopDiscordRefresh();
    stopFacebookRefresh();
    stopInstagramRefresh();
    stopGitHubRefresh();
    stopPinterestRefresh();
    lastTwitterDataSignature = '';
    lastTikTokDataSignature = '';
    lastSoundCloudDataSignature = '';
    lastDiscordDataSignature = '';
    lastFacebookDataSignature = '';
    lastInstagramDataSignature = '';
    lastGitHubDataSignature = '';
    lastPinterestDataSignature = '';
    startCurrentHistoryRefresh();
    loadRequests();
  });

  document.getElementById('historyTabBtn').addEventListener('click', () => {
    currentView = 'history';
    document.getElementById('discordToolbar').style.display = 'none';
    document.getElementById('historyTabBtn').classList.add('active');
    document.getElementById('currentTabBtn').classList.remove('active');
    document.getElementById('twitterTabBtn').classList.remove('active');
    document.getElementById('tiktokTabBtn').classList.remove('active');
    document.getElementById('soundcloudTabBtn').classList.remove('active');
    document.getElementById('discordTabBtn').classList.remove('active');
    document.getElementById('facebookTabBtn').classList.remove('active');
    document.getElementById('instagramTabBtn').classList.remove('active');
    document.getElementById('githubTabBtn').classList.remove('active');
    document.getElementById('pinterestTabBtn').classList.remove('active');
    stopTwitterRefresh();
    stopTikTokRefresh();
    stopSoundCloudRefresh();
    stopDiscordRefresh();
    stopFacebookRefresh();
    stopInstagramRefresh();
    stopGitHubRefresh();
    stopPinterestRefresh();
    lastTwitterDataSignature = '';
    lastTikTokDataSignature = '';
    lastSoundCloudDataSignature = '';
    lastDiscordDataSignature = '';
    lastFacebookDataSignature = '';
    lastInstagramDataSignature = '';
    lastGitHubDataSignature = '';
    lastPinterestDataSignature = '';
    startCurrentHistoryRefresh();
    loadRequests();
  });

  document.getElementById('commentsTabBtn').addEventListener('click', () => {
    currentView = 'comments';
    document.getElementById('discordToolbar').style.display = 'none';
    stopCurrentHistoryRefresh();
    stopTwitterRefresh();
    stopTikTokRefresh();
    stopSoundCloudRefresh();
    stopDiscordRefresh();
    stopFacebookRefresh();
    stopInstagramRefresh();
    stopGitHubRefresh();
    stopPinterestRefresh();
    stopActiveInterceptionRefresh();
    startCommentsRefresh();
    renderRequests(currentRequests);
    loadPageComments(() => renderCommentsTabEnhanced());
  });

  document.getElementById('activeInterceptionTabBtn').addEventListener('click', () => {
    currentView = 'activeInterception';
    document.getElementById('discordToolbar').style.display = 'none';
    stopCurrentHistoryRefresh();
    stopTwitterRefresh();
    stopTikTokRefresh();
    stopSoundCloudRefresh();
    stopDiscordRefresh();
    stopFacebookRefresh();
    stopInstagramRefresh();
    stopGitHubRefresh();
    stopPinterestRefresh();
    lastTwitterDataSignature = '';
    lastTikTokDataSignature = '';
    lastSoundCloudDataSignature = '';
    lastDiscordDataSignature = '';
    lastFacebookDataSignature = '';
    lastInstagramDataSignature = '';
    lastGitHubDataSignature = '';
    lastPinterestDataSignature = '';
    startActiveInterceptionRefresh();
    renderRequests(currentRequests);
    loadActiveInterceptionData(() => renderRequests(currentRequests));
  });

  document.getElementById('bugsTabBtn').addEventListener('click', () => {
    currentView = 'bugs';
    document.getElementById('discordToolbar').style.display = 'none';
    stopCurrentHistoryRefresh();
    stopTwitterRefresh();
    stopTikTokRefresh();
    stopSoundCloudRefresh();
    stopDiscordRefresh();
    stopFacebookRefresh();
    stopInstagramRefresh();
    stopGitHubRefresh();
    stopPinterestRefresh();
    stopCommentsRefresh();
    stopActiveInterceptionRefresh();
    if (typeof startBugRefresh === 'function') startBugRefresh();
    loadRequests();
  });

  document.getElementById('twitterTabBtn').addEventListener('click', () => {
    currentView = 'twitter';
    document.getElementById('discordToolbar').style.display = 'none';
    document.getElementById('twitterTabBtn').classList.add('active');
    document.getElementById('currentTabBtn').classList.remove('active');
    document.getElementById('historyTabBtn').classList.remove('active');
    document.getElementById('tiktokTabBtn').classList.remove('active');
    document.getElementById('soundcloudTabBtn').classList.remove('active');
    document.getElementById('discordTabBtn').classList.remove('active');
    document.getElementById('facebookTabBtn').classList.remove('active');
    document.getElementById('instagramTabBtn').classList.remove('active');
    stopCurrentHistoryRefresh();
    stopTikTokRefresh();
    stopSoundCloudRefresh();
    stopDiscordRefresh();
    stopFacebookRefresh();
    stopInstagramRefresh();
    startTwitterRefresh();
    lastTikTokDataSignature = '';
    lastSoundCloudDataSignature = '';
    lastDiscordDataSignature = '';
    lastFacebookDataSignature = '';
    lastInstagramDataSignature = '';
    renderRequests(currentRequests);
  });

  document.getElementById('tiktokTabBtn').addEventListener('click', () => {
    currentView = 'tiktok';
    document.getElementById('discordToolbar').style.display = 'none';
    document.getElementById('tiktokTabBtn').classList.add('active');
    document.getElementById('currentTabBtn').classList.remove('active');
    document.getElementById('historyTabBtn').classList.remove('active');
    document.getElementById('twitterTabBtn').classList.remove('active');
    document.getElementById('soundcloudTabBtn').classList.remove('active');
    document.getElementById('discordTabBtn').classList.remove('active');
    document.getElementById('facebookTabBtn').classList.remove('active');
    document.getElementById('instagramTabBtn').classList.remove('active');
    document.getElementById('githubTabBtn').classList.remove('active');
    document.getElementById('pinterestTabBtn').classList.remove('active');
    stopCurrentHistoryRefresh();
    stopTwitterRefresh();
    stopSoundCloudRefresh();
    stopDiscordRefresh();
    stopFacebookRefresh();
    stopInstagramRefresh();
    startTikTokRefresh();
    lastTwitterDataSignature = '';
    lastSoundCloudDataSignature = '';
    lastDiscordDataSignature = '';
    lastFacebookDataSignature = '';
    lastInstagramDataSignature = '';
    renderRequests(currentRequests);
  });

  document.getElementById('soundcloudTabBtn').addEventListener('click', () => {
    currentView = 'soundcloud';
    document.getElementById('discordToolbar').style.display = 'none';
    document.getElementById('soundcloudTabBtn').classList.add('active');
    document.getElementById('currentTabBtn').classList.remove('active');
    document.getElementById('historyTabBtn').classList.remove('active');
    document.getElementById('twitterTabBtn').classList.remove('active');
    document.getElementById('tiktokTabBtn').classList.remove('active');
    document.getElementById('discordTabBtn').classList.remove('active');
    document.getElementById('facebookTabBtn').classList.remove('active');
    document.getElementById('instagramTabBtn').classList.remove('active');
    document.getElementById('githubTabBtn').classList.remove('active');
    document.getElementById('pinterestTabBtn').classList.remove('active');
    stopCurrentHistoryRefresh();
    stopTwitterRefresh();
    stopTikTokRefresh();
    stopDiscordRefresh();
    stopFacebookRefresh();
    stopInstagramRefresh();
    startSoundCloudRefresh();
    lastTwitterDataSignature = '';
    lastTikTokDataSignature = '';
    lastDiscordDataSignature = '';
    lastFacebookDataSignature = '';
    lastInstagramDataSignature = '';
    renderRequests(currentRequests);
  });

  document.getElementById('discordTabBtn').addEventListener('click', () => {
    currentView = 'discord';
    document.getElementById('discordToolbar').style.display = 'flex';
    document.getElementById('discordTabBtn').classList.add('active');
    document.getElementById('currentTabBtn').classList.remove('active');
    document.getElementById('historyTabBtn').classList.remove('active');
    document.getElementById('twitterTabBtn').classList.remove('active');
    document.getElementById('tiktokTabBtn').classList.remove('active');
    document.getElementById('soundcloudTabBtn').classList.remove('active');
    document.getElementById('facebookTabBtn').classList.remove('active');
    document.getElementById('instagramTabBtn').classList.remove('active');
    document.getElementById('githubTabBtn').classList.remove('active');
    document.getElementById('pinterestTabBtn').classList.remove('active');
    stopCurrentHistoryRefresh();
    stopTwitterRefresh();
    stopTikTokRefresh();
    stopSoundCloudRefresh();
    stopFacebookRefresh();
    stopInstagramRefresh();
    startDiscordRefresh();
    lastTwitterDataSignature = '';
    lastTikTokDataSignature = '';
    lastSoundCloudDataSignature = '';
    lastFacebookDataSignature = '';
    lastInstagramDataSignature = '';
    renderRequests(currentRequests);
  });

  document.getElementById('discordDownloadEverythingBtn').addEventListener('click', () => {
    if (typeof downloadDiscordAsHtml === 'function') downloadDiscordAsHtml();
  });

  document.getElementById('facebookTabBtn').addEventListener('click', () => {
    currentView = 'facebook';
    document.getElementById('discordToolbar').style.display = 'none';
    document.getElementById('facebookTabBtn').classList.add('active');
    document.getElementById('currentTabBtn').classList.remove('active');
    document.getElementById('historyTabBtn').classList.remove('active');
    document.getElementById('twitterTabBtn').classList.remove('active');
    document.getElementById('tiktokTabBtn').classList.remove('active');
    document.getElementById('soundcloudTabBtn').classList.remove('active');
    document.getElementById('discordTabBtn').classList.remove('active');
    document.getElementById('instagramTabBtn').classList.remove('active');
    document.getElementById('githubTabBtn').classList.remove('active');
    document.getElementById('pinterestTabBtn').classList.remove('active');
    stopCurrentHistoryRefresh();
    stopTwitterRefresh();
    stopTikTokRefresh();
    stopSoundCloudRefresh();
    stopDiscordRefresh();
    stopInstagramRefresh();
    stopPinterestRefresh();
    startFacebookRefresh();
    lastTwitterDataSignature = '';
    lastTikTokDataSignature = '';
    lastSoundCloudDataSignature = '';
    lastDiscordDataSignature = '';
    lastInstagramDataSignature = '';
    lastGitHubDataSignature = '';
    lastPinterestDataSignature = '';
    renderRequests(currentRequests);
  });

  document.getElementById('instagramTabBtn').addEventListener('click', () => {
    currentView = 'instagram';
    document.getElementById('discordToolbar').style.display = 'none';
    document.getElementById('instagramTabBtn').classList.add('active');
    document.getElementById('currentTabBtn').classList.remove('active');
    document.getElementById('historyTabBtn').classList.remove('active');
    document.getElementById('twitterTabBtn').classList.remove('active');
    document.getElementById('tiktokTabBtn').classList.remove('active');
    document.getElementById('soundcloudTabBtn').classList.remove('active');
    document.getElementById('discordTabBtn').classList.remove('active');
    document.getElementById('facebookTabBtn').classList.remove('active');
    document.getElementById('githubTabBtn').classList.remove('active');
    document.getElementById('pinterestTabBtn').classList.remove('active');
    stopCurrentHistoryRefresh();
    stopTwitterRefresh();
    stopTikTokRefresh();
    stopSoundCloudRefresh();
    stopDiscordRefresh();
    stopFacebookRefresh();
    stopGitHubRefresh();
    stopPinterestRefresh();
    startInstagramRefresh();
    lastTwitterDataSignature = '';
    lastTikTokDataSignature = '';
    lastSoundCloudDataSignature = '';
    lastDiscordDataSignature = '';
    lastFacebookDataSignature = '';
    lastGitHubDataSignature = '';
    lastPinterestDataSignature = '';
    renderRequests(currentRequests);
  });

  document.getElementById('githubTabBtn').addEventListener('click', () => {
    currentView = 'github';
    document.getElementById('discordToolbar').style.display = 'none';
    document.getElementById('githubTabBtn').classList.add('active');
    document.getElementById('currentTabBtn').classList.remove('active');
    document.getElementById('historyTabBtn').classList.remove('active');
    document.getElementById('twitterTabBtn').classList.remove('active');
    document.getElementById('tiktokTabBtn').classList.remove('active');
    document.getElementById('soundcloudTabBtn').classList.remove('active');
    document.getElementById('discordTabBtn').classList.remove('active');
    document.getElementById('facebookTabBtn').classList.remove('active');
    document.getElementById('instagramTabBtn').classList.remove('active');
    stopCurrentHistoryRefresh();
    stopTwitterRefresh();
    stopTikTokRefresh();
    stopSoundCloudRefresh();
    stopDiscordRefresh();
    stopFacebookRefresh();
    stopInstagramRefresh();
    startGitHubRefresh();
    lastTwitterDataSignature = '';
    lastTikTokDataSignature = '';
    lastSoundCloudDataSignature = '';
    lastDiscordDataSignature = '';
    lastFacebookDataSignature = '';
    lastInstagramDataSignature = '';
    lastPinterestDataSignature = '';
    renderRequests(currentRequests);
  });

  document.getElementById('pinterestTabBtn').addEventListener('click', () => {
    currentView = 'pinterest';
    document.getElementById('discordToolbar').style.display = 'none';
    document.getElementById('pinterestTabBtn').classList.add('active');
    document.getElementById('currentTabBtn').classList.remove('active');
    document.getElementById('historyTabBtn').classList.remove('active');
    document.getElementById('twitterTabBtn').classList.remove('active');
    document.getElementById('tiktokTabBtn').classList.remove('active');
    document.getElementById('soundcloudTabBtn').classList.remove('active');
    document.getElementById('discordTabBtn').classList.remove('active');
    document.getElementById('facebookTabBtn').classList.remove('active');
    document.getElementById('instagramTabBtn').classList.remove('active');
    document.getElementById('githubTabBtn').classList.remove('active');
    stopCurrentHistoryRefresh();
    stopTwitterRefresh();
    stopTikTokRefresh();
    stopSoundCloudRefresh();
    stopDiscordRefresh();
    stopFacebookRefresh();
    stopInstagramRefresh();
    stopGitHubRefresh();
    startPinterestRefresh();
    lastTwitterDataSignature = '';
    lastTikTokDataSignature = '';
    lastSoundCloudDataSignature = '';
    lastDiscordDataSignature = '';
    lastFacebookDataSignature = '';
    lastInstagramDataSignature = '';
    lastGitHubDataSignature = '';
    lastPinterestDataSignature = '';
    renderRequests(currentRequests);
  });

  document.getElementById('detailModal').addEventListener('click', e => {
    if (e.target.id === 'detailModal') closeModal();
  });

  getActiveTab();
});

chrome.tabs.onActivated.addListener(getActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTabId && changeInfo.url) {
    getActiveTab();
  }
});

window.addEventListener('pagehide', () => {
  stopAllViewRefreshes();
});
