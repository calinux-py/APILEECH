(function() {
  'use strict';
  try {
  var contextDead = false;

  function getRuntime() {
    if (contextDead) return null;
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return null;
      return chrome.runtime;
    } catch (e) {
      contextDead = true;
      return null;
    }
  }

  function sendToBackground(message) {
    var rt = getRuntime();
    if (!rt) return;
    try {
      rt.sendMessage(message, function() {
        try {
          if (chrome.runtime && chrome.runtime.lastError) {}
        } catch (e) {
          contextDead = true;
        }
      });
    } catch (e) {
      contextDead = true;
    }
  }

  var scannedScriptKeys = Object.create(null);
  var MAX_INLINE_SCRIPT_CHARS = 250000;

  function hashText(str) {
    var input = String(str || '');
    var hash = 2166136261;
    for (var i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  function resolveScriptSrc(src) {
    try { return new URL(src, window.location.href).href; } catch (e) { return String(src || ''); }
  }

  function queueScriptForEndpointScan(payload) {
    if (!payload) return;
    setTimeout(function() {
      sendToBackground({ action: 'scanScriptForEndpoints', data: payload });
    }, 0);
  }

  function markScriptKey(scriptKey) {
    if (!scriptKey) return false;
    if (scannedScriptKeys[scriptKey]) return false;
    scannedScriptKeys[scriptKey] = true;
    return true;
  }

  function scanSingleScriptNode(scriptEl) {
    if (!scriptEl || scriptEl.tagName !== 'SCRIPT') return;
    var srcAttr = scriptEl.getAttribute('src');
    if (srcAttr) {
      var resolvedSrc = resolveScriptSrc(srcAttr);
      if (!resolvedSrc) return;
      if (!/^https?:\/\//i.test(resolvedSrc)) return;
      var srcKey = 'src:' + resolvedSrc;
      if (!markScriptKey(srcKey)) return;
      queueScriptForEndpointScan({
        scriptKey: srcKey,
        scriptUrl: resolvedSrc,
        pageUrl: window.location.href,
        sourceType: 'external'
      });
      return;
    }

    var inlineText = scriptEl.textContent || '';
    if (!inlineText || !inlineText.trim()) return;
    if (inlineText.length < 12) return;
    var trimmed = inlineText.trim();
    var inlineHash = hashText(trimmed);
    var inlineKey = 'inline:' + inlineHash;
    if (!markScriptKey(inlineKey)) return;
    queueScriptForEndpointScan({
      scriptKey: inlineKey,
      scriptUrl: window.location.href + '#inline-' + inlineHash,
      pageUrl: window.location.href,
      sourceType: 'inline',
      sourceText: trimmed.slice(0, MAX_INLINE_SCRIPT_CHARS)
    });
  }

  function scanScriptsUnderNode(node) {
    if (!node || !node.nodeType) return;
    if (node.nodeType !== 1) return;
    var el = node;
    if (el.tagName === 'SCRIPT') {
      scanSingleScriptNode(el);
      return;
    }
    var scripts = el.querySelectorAll ? el.querySelectorAll('script') : [];
    for (var i = 0; i < scripts.length; i++) {
      scanSingleScriptNode(scripts[i]);
    }
  }

  function scanExistingScripts() {
    try {
      var scripts = document.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        scanSingleScriptNode(scripts[i]);
      }
    } catch (e) {}
  }

  function watchForScriptChanges() {
    try {
      var target = document.documentElement || document;
      if (!target || typeof MutationObserver === 'undefined') return;
      var observer = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var mutation = mutations[i];
          if (!mutation.addedNodes || mutation.addedNodes.length === 0) continue;
          for (var j = 0; j < mutation.addedNodes.length; j++) {
            scanScriptsUnderNode(mutation.addedNodes[j]);
          }
        }
      });
      observer.observe(target, { childList: true, subtree: true });
    } catch (e) {}
  }

  try {
    var injectRt = getRuntime();
    if (!injectRt) return;
    const script = document.createElement('script');
    script.src = injectRt.getURL('injected.js');
    script.onload = function() { try { this.remove(); } catch (e) {} };
    (document.head || document.documentElement).appendChild(script);
  } catch (e) {
    return;
  }

  scanExistingScripts();
  watchForScriptChanges();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      scanExistingScripts();
    }, { once: true });
  } else {
    setTimeout(scanExistingScripts, 400);
  }

  window.addEventListener('message', function(event) {
    try {
      if (event.source !== window) return;
      if (event.data.type !== 'API_LEECH_BODY' && event.data.type !== 'API_LEECH_RESPONSE') return;
      var payload = { type: event.data.type, data: event.data.data };
      setTimeout(function() {
        try {
          if (!getRuntime()) return;
          if (payload.type === 'API_LEECH_BODY') {
            sendToBackground({ action: 'captureBody', data: payload.data });
          } else {
            sendToBackground({ action: 'captureResponse', data: payload.data });
          }
        } catch (e) {}
      }, 0);
    } catch (e) {}
  });

  if (window === window.top) {
    window.addEventListener('load', function() {
      try {
        var url = window.location.href;
        var html = document.documentElement.outerHTML;
        if (!html || html.length === 0) return;
        setTimeout(function() {
          try {
            if (!getRuntime()) return;
            sendToBackground({
              action: 'captureDocumentContent',
              data: { url: url, responseBody: html }
            });
          } catch (e) {}
        }, 0);
      } catch (e) {}
    }, { once: true });
  }

  try {
    var onMsgRt = getRuntime();
    if (!onMsgRt) return;
    onMsgRt.onMessage.addListener(function(msg, sender, sendResponse) {
      function safeSend(obj) {
        try { sendResponse(obj); } catch (e) {}
      }
      try {
        if (!getRuntime()) { safeSend({ dataUrl: null }); return false; }
        if (msg.action !== 'fetchImageInPageContext' || !msg.url) return;
        var el = document.documentElement;
        el.setAttribute('data-ig-fetch-url', msg.url);
        var deadline = Date.now() + 8000;
        function poll() {
          try {
            if (!getRuntime()) { safeSend({ dataUrl: null }); return; }
            var result = el.getAttribute('data-ig-fetch-result');
            var resultUrl = el.getAttribute('data-ig-fetch-result-url');
            if (result !== null && resultUrl === msg.url) {
              el.removeAttribute('data-ig-fetch-result');
              el.removeAttribute('data-ig-fetch-result-url');
              safeSend({ dataUrl: result || null });
              return;
            }
            if (Date.now() < deadline) setTimeout(poll, 80);
            else safeSend({ dataUrl: null });
          } catch (e) { safeSend({ dataUrl: null }); }
        }
        setTimeout(poll, 200);
        return true;
      } catch (e) {
        safeSend({ dataUrl: null });
        return false;
      }
    });
  } catch (e) {}

  } catch (e) {}
})();
