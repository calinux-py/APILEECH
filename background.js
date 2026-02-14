const pendingRequests = {};
const bodyBuffer = [];
const responseBuffer = [];
let capturedRequests = [];
let currentTabId = null;
let currentTabHostname = null;
const MAX_REQUESTS = 2000;
const MAX_BODY_BUFFER = 200;
const FALLBACK_WAIT_MS = 1500;
const MAX_CAPTURED_BODY_CHARS = 120000;
const MAX_CAPTURED_RESPONSE_CHARS = 1200000;
const MAX_POPUP_MESSAGE_BYTES = 56 * 1024 * 1024;

function safeStringify(value) {
  try { return JSON.stringify(value); } catch (_) {}
  try { return String(value); } catch (_) {}
  return '';
}

function normalizePayloadText(value, maxChars) {
  if (value === undefined || value === null || value === '') return null;
  let out = typeof value === 'string' ? value : safeStringify(value);
  if (!out) return null;
  if (out.length > maxChars) {
    const omitted = out.length - maxChars;
    out = out.slice(0, maxChars) + `\n\n/* truncated ${omitted} chars */`;
  }
  return out;
}

function sanitizeRequestForMemory(req) {
  if (!req || typeof req !== 'object') return null;
  return {
    id: req.id != null ? req.id : (Date.now() + Math.random()),
    url: req.url || '',
    method: req.method || 'GET',
    headers: Array.isArray(req.headers) ? req.headers : [],
    body: normalizePayloadText(req.body, MAX_CAPTURED_BODY_CHARS),
    responseBody: normalizePayloadText(req.responseBody, MAX_CAPTURED_RESPONSE_CHARS),
    timestamp: req.timestamp || new Date().toISOString(),
    type: req.type || 'fetch',
    tabId: req.tabId != null ? req.tabId : -1,
    initiator: req.initiator || '',
  };
}

function buildRequestsForPopup() {
  const encoder = new TextEncoder();
  const sizeOf = (arr) => {
    try { return encoder.encode(JSON.stringify({ requests: arr })).length; } catch (_) { return Number.MAX_SAFE_INTEGER; }
  };

  let payload = capturedRequests.map(r => sanitizeRequestForMemory(r)).filter(Boolean);
  if (sizeOf(payload) <= MAX_POPUP_MESSAGE_BYTES) return payload;

  const prioritized = payload.map((r, idx) => {
    const u = (r.url || '').toLowerCase();
    const keepResponse =
      idx < 20 ||
      u.includes('hometimeline') ||
      u.includes('home_timeline_urt') ||
      u.includes('threaded_conversation_with_injections_v2');
    return keepResponse ? r : { ...r, responseBody: null };
  });
  if (sizeOf(prioritized) <= MAX_POPUP_MESSAGE_BYTES) return prioritized;

  payload = payload.map(r => ({ ...r, responseBody: null }));
  if (sizeOf(payload) <= MAX_POPUP_MESSAGE_BYTES) return payload;

  payload = payload.map(r => ({ ...r, body: null, headers: Array.isArray(r.headers) ? r.headers.slice(0, 30) : [] }));
  if (sizeOf(payload) <= MAX_POPUP_MESSAGE_BYTES) return payload;

  let end = payload.length;
  while (end > 1) {
    end = Math.floor(end * 0.75);
    const sliced = payload.slice(0, end);
    if (sizeOf(sliced) <= MAX_POPUP_MESSAGE_BYTES) return sliced;
  }
  return payload.length ? [payload[0]] : [];
}

function countRequestsForCurrentSite() {
  if (!currentTabHostname) return 0;
  return capturedRequests.filter(req => {
    if (req.initiator) {
      try { if (new URL(req.initiator).hostname === currentTabHostname) return true; } catch {}
    }
    if (req.url) {
      try { if (new URL(req.url).hostname === currentTabHostname) return true; } catch {}
    }
    return false;
  }).length;
}

function updateBadge() {
  const set = (count) => {
    chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#8EA4D8' });
  };
  if (currentTabHostname != null || currentTabId != null) {
    set(countRequestsForCurrentSite());
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) {
      currentTabId = tabs[0].id;
      try { currentTabHostname = new URL(tabs[0].url).hostname; } catch { currentTabHostname = ''; }
    } else { currentTabHostname = ''; currentTabId = null; }
    set(countRequestsForCurrentSite());
  });
}

function debouncedSave() {
  // History is kept in memory only; use Export to file in popup to save. No browser storage.
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  currentTabId = activeInfo.tabId;
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) {
      currentTabHostname = '';
      updateBadge();
      return;
    }
    try { currentTabHostname = new URL(tab.url).hostname; } catch { currentTabHostname = ''; }
    updateBadge();
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId !== currentTabId) return;
  if (changeInfo.url) {
    try { currentTabHostname = new URL(changeInfo.url).hostname; } catch { currentTabHostname = ''; }
    updateBadge();
  }
});

function decodeRequestBody(requestBody) {
  if (!requestBody) return null;

  if (requestBody.raw && requestBody.raw.length > 0) {
    try {
      const decoder = new TextDecoder('utf-8');
      return requestBody.raw
        .filter(p => p.bytes)
        .map(p => decoder.decode(new Uint8Array(p.bytes)))
        .join('');
    } catch { return null; }
  }

  if (requestBody.formData) {
    const params = new URLSearchParams();
    for (const [key, values] of Object.entries(requestBody.formData)) {
      for (const value of values) {
        params.append(key, value);
      }
    }
    return params.toString();
  }

  return null;
}

const REQUEST_TYPES = ["main_frame", "xmlhttprequest", "other"];
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.initiator && details.initiator.startsWith('chrome-extension://')) return;

    pendingRequests[details.requestId] = {
      url: details.url,
      method: details.method,
      tabId: details.tabId,
      resourceType: details.type || 'other',
      timestamp: new Date(details.timeStamp).toISOString(),
      headers: [],
      body: normalizePayloadText(decodeRequestBody(details.requestBody), MAX_CAPTURED_BODY_CHARS),
      responseBody: null,
      initiator: details.initiator || '',
    };
  },
  { urls: ["<all_urls>"], types: REQUEST_TYPES },
  ["requestBody"]
);

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    const pending = pendingRequests[details.requestId];
    if (pending) {
      pending.headers = details.requestHeaders || [];
    }
  },
  { urls: ["<all_urls>"], types: REQUEST_TYPES },
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const pending = pendingRequests[details.requestId];
    if (!pending) return;

    const resBody = findBufferedData(responseBuffer, pending.url, pending.method);
    if (resBody !== null) {
      pending.responseBody = resBody;
    }

    const needsBody = ['POST', 'PUT', 'PATCH'].includes(pending.method);

    if (!needsBody || pending.body !== null) {
      finalizeRequest(details.requestId);
    } else {
      const bufBody = findBufferedData(bodyBuffer, pending.url, pending.method);
      if (bufBody !== null) {
        pending.body = bufBody;
        finalizeRequest(details.requestId);
      } else {
        setTimeout(() => {
          const p = pendingRequests[details.requestId];
          if (p && p.body === null) {
            const late = findBufferedData(bodyBuffer, p.url, p.method);
            if (late !== null) p.body = late;
          }
          finalizeRequest(details.requestId);
        }, FALLBACK_WAIT_MS);
      }
    }
  },
  { urls: ["<all_urls>"], types: REQUEST_TYPES }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => { delete pendingRequests[details.requestId]; },
  { urls: ["<all_urls>"], types: REQUEST_TYPES }
);

function finalizeRequest(requestId) {
  const pending = pendingRequests[requestId];
  if (!pending) return;
  delete pendingRequests[requestId];

  const isDuplicate = capturedRequests.some(r =>
    r.url === pending.url &&
    r.method === pending.method &&
    r.body === pending.body &&
    Math.abs(new Date(r.timestamp).getTime() - new Date(pending.timestamp).getTime()) < 1000
  );
  if (isDuplicate) return;

  const displayType = pending.resourceType === 'main_frame' ? 'document' : 'fetch';
  capturedRequests.unshift({
    id: Date.now() + Math.random(),
    url: pending.url,
    method: pending.method,
    headers: pending.headers,
    body: normalizePayloadText(pending.body, MAX_CAPTURED_BODY_CHARS),
    responseBody: normalizePayloadText(pending.responseBody, MAX_CAPTURED_RESPONSE_CHARS),
    timestamp: pending.timestamp,
    type: displayType,
    tabId: pending.tabId,
    initiator: pending.initiator,
  });

  if (capturedRequests.length > MAX_REQUESTS) {
    capturedRequests = capturedRequests.slice(0, MAX_REQUESTS);
  }

  updateBadge();
  debouncedSave();
}

function findBufferedData(buffer, url, method) {
  const now = Date.now();
  for (let i = buffer.length - 1; i >= 0; i--) {
    const b = buffer[i];
    if (now - b.ts > 15000) continue;
    if (b.method === method && b.url === url) {
      buffer.splice(i, 1);
      return b.data;
    }
  }
  return null;
}

function tryFallbackFetch(url, sendResponse) {
  fetch(url, { method: 'GET', credentials: 'omit', mode: 'cors' })
    .then(res => res.ok ? res.blob() : Promise.reject(new Error('not ok')))
    .then(blob => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    }))
    .then(dataUrl => sendResponse({ dataUrl }))
    .catch(() => sendResponse({ dataUrl: null }));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'captureBody') {
    const data = message.data;
    if (data && data.url) {
      const upperMethod = (data.method || '').toUpperCase();
      const matchId = Object.keys(pendingRequests).reverse().find(id => {
        const r = pendingRequests[id];
        return r.body === null && r.method === upperMethod && r.url === data.url;
      });
      if (matchId) {
        pendingRequests[matchId].body = normalizePayloadText(data.body, MAX_CAPTURED_BODY_CHARS);
      } else {
        bodyBuffer.push({ url: data.url, method: upperMethod, data: normalizePayloadText(data.body, MAX_CAPTURED_BODY_CHARS), ts: Date.now() });
        if (bodyBuffer.length > MAX_BODY_BUFFER) bodyBuffer.shift();
      }
    }
    sendResponse({ success: true });

  } else if (message.action === 'captureResponse') {
    const data = message.data;
    if (data && data.url) {
      const upperMethod = (data.method || '').toUpperCase();
      
      const matchId = Object.keys(pendingRequests).reverse().find(id => {
        const r = pendingRequests[id];
        return r.responseBody === null && r.method === upperMethod && r.url === data.url;
      });

      if (matchId) {
        pendingRequests[matchId].responseBody = normalizePayloadText(data.responseBody, MAX_CAPTURED_RESPONSE_CHARS);
      } else {
        const recentRequest = capturedRequests.find(r => 
          r.responseBody === null && r.method === upperMethod && r.url === data.url &&
          (Date.now() - new Date(r.timestamp).getTime()) < 5000
        );
        if (recentRequest) {
          recentRequest.responseBody = normalizePayloadText(data.responseBody, MAX_CAPTURED_RESPONSE_CHARS);
          debouncedSave();
        } else {
          responseBuffer.push({ url: data.url, method: upperMethod, data: normalizePayloadText(data.responseBody, MAX_CAPTURED_RESPONSE_CHARS), ts: Date.now() });
          if (responseBuffer.length > MAX_BODY_BUFFER) responseBuffer.shift();
        }
      }
    }
    sendResponse({ success: true });

  } else if (message.action === 'captureDocumentContent') {
    const data = message.data;
    if (data && data.url && data.responseBody != null) {
      const normalized = normalizePayloadText(data.responseBody, MAX_CAPTURED_RESPONSE_CHARS);
      const docRequest = capturedRequests.find(r =>
        r.type === 'document' && r.url === data.url && r.responseBody == null
      );
      if (docRequest) {
        docRequest.responseBody = normalized;
        debouncedSave();
      }
    }
    sendResponse({ success: true });

  } else if (message.action === 'getRequests') {
    sendResponse({ requests: buildRequestsForPopup() });

  } else if (message.action === 'clearRequests') {
    capturedRequests = [];
    updateBadge();
    sendResponse({ success: true });

  } else if (message.action === 'getRequestsForExport') {
    sendResponse({ requests: capturedRequests.map(r => sanitizeRequestForMemory(r)).filter(Boolean) });

  } else if (message.action === 'importHistory') {
    const list = message.requests;
    if (Array.isArray(list) && list.length > 0) {
      capturedRequests = list
        .map(r => sanitizeRequestForMemory(r))
        .filter(Boolean)
        .slice(0, MAX_REQUESTS);
    } else {
      capturedRequests = [];
    }
    updateBadge();
    sendResponse({ success: true, count: capturedRequests.length });

  } else if (message.action === 'resolveInstagramProfilePic' && message.url) {
    chrome.tabs.query({ url: '*://www.instagram.com/*' }, (tabs) => {
      if (tabs && tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'fetchImageInPageContext', url: message.url }, (r) => {
          if (chrome.runtime.lastError || !r) {
            tryFallbackFetch(message.url, sendResponse);
          } else {
            sendResponse(r.dataUrl != null ? { dataUrl: r.dataUrl } : { dataUrl: null });
          }
        });
      } else {
        tryFallbackFetch(message.url, sendResponse);
      }
    });
    return true;
  }

  return true;
});

setInterval(() => {
  const now = Date.now();
  for (const id of Object.keys(pendingRequests)) {
    if (now - new Date(pendingRequests[id].timestamp).getTime() > 30000) {
      delete pendingRequests[id];
    }
  }
  while (bodyBuffer.length > 0 && Date.now() - bodyBuffer[0].ts > 30000) bodyBuffer.shift();
  while (responseBuffer.length > 0 && Date.now() - responseBuffer[0].ts > 30000) responseBuffer.shift();
}, 30000);

updateBadge();
