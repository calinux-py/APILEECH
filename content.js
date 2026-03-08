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

  function isHiddenElement(el) {
    if (!el || el.nodeType !== 1) return false;
    try {
      if (el.hidden) return true;
      var ariaHidden = el.getAttribute('aria-hidden');
      if (ariaHidden && ariaHidden.toLowerCase() === 'true') return true;
      var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (!style) return false;
      return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
    } catch (e) {
      return false;
    }
  }

  function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getElementHintText(el) {
    if (!el || el.nodeType !== 1) return '';
    var parts = [];
    try {
      if (el.id) parts.push(el.id);
      if (el.className && typeof el.className === 'string') parts.push(el.className);
      var attrs = ['role', 'aria-label', 'data-testid', 'data-testid', 'data-e2e', 'itemprop'];
      for (var i = 0; i < attrs.length; i++) {
        var val = el.getAttribute(attrs[i]);
        if (val) parts.push(val);
      }
    } catch (e) {}
    return parts.join(' ').toLowerCase();
  }

  function collectElementText(node, state) {
    if (!node || !state) return;
    if (state.parts.length >= 200) return;
    if (node.nodeType === 3) {
      var text = normalizeWhitespace(node.nodeValue);
      if (text) state.parts.push(text);
      return;
    }
    if (node.nodeType !== 1) return;
    var el = node;
    var tag = (el.tagName || '').toLowerCase();
    if (!tag) return;
    if (isHiddenElement(el)) return;
    if (/^(script|style|noscript|svg|path|iframe|canvas|template|form|input|button|select|option|textarea|nav|header|footer)$/i.test(tag)) return;
    if (tag === 'a') {
      var anchorText = normalizeWhitespace(el.textContent || '');
      var href = normalizeWhitespace(el.getAttribute('href') || '');
      if (!anchorText) return;
      if (href && (anchorText === href || /^https?:\/\//i.test(anchorText) || /^www\./i.test(anchorText))) return;
      if (/^(read more|more|reply|share|like|view|open)$/i.test(anchorText)) return;
      return;
    }
    for (var i = 0; i < el.childNodes.length; i++) {
      collectElementText(el.childNodes[i], state);
      if (state.parts.length >= 200) break;
    }
  }

  function getReadableElementText(el) {
    var state = { parts: [] };
    collectElementText(el, state);
    return normalizeWhitespace(state.parts.join(' '));
  }

  function findFirstText(el, selectors) {
    if (!el || !selectors || !selectors.length || !el.querySelector) return '';
    for (var i = 0; i < selectors.length; i++) {
      try {
        var match = el.querySelector(selectors[i]);
        if (match) {
          var text = getReadableElementText(match) || normalizeWhitespace(match.textContent || '');
          if (text) return text;
        }
      } catch (e) {}
    }
    return '';
  }

  function findTimeText(el) {
    if (!el || !el.querySelectorAll) return '';
    try {
      var nodes = el.querySelectorAll('time, [datetime], [data-time], [data-timestamp], [class*="time"], [class*="date"], [aria-label*="ago"], [title]');
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        var text = normalizeWhitespace(node.getAttribute('datetime') || node.getAttribute('title') || node.textContent || '');
        if (!text) continue;
        if (/\b(\d{4}-\d{2}-\d{2}|yesterday|today|ago|just now|min|hour|day|week|month|year)\b/i.test(text)) return text;
      }
    } catch (e) {}
    return '';
  }

  function scoreCommentCandidate(el, text) {
    var hintText = getElementHintText(el);
    var score = 0;
    if (/\b(comment|comments|reply|replies|discussion|review|testimonial|thread|message-body)\b/.test(hintText)) score += 4;
    if (/\b(author|username|user-name|display-name|avatar|profile)\b/.test(hintText)) score += 1;
    if (findTimeText(el)) score += 1;
    if (el.querySelector) {
      try {
        if (el.querySelector('time, [datetime], [class*="author"], [class*="user"], [class*="name"], [itemprop*="author"], [rel="author"], [data-testid*="author"], [data-testid*="comment"]')) score += 2;
        if (el.querySelector('[class*="reply"], [aria-label*="Reply"], [data-testid*="reply"], [class*="like"], [aria-label*="Like"]')) score += 1;
      } catch (e) {}
    }
    if (text.length >= 20) score += 1;
    if (text.length >= 60) score += 1;
    return score;
  }

  function looksLikeNonCommentText(text) {
    if (!text) return true;
    if (text.length < 8) return true;
    if (text.length > 4000) return true;
    var urlMatches = text.match(/https?:\/\/|www\./gi);
    if (urlMatches && urlMatches.length >= 2) return true;
    if (/^(home|about|contact|privacy|terms|sign in|sign up|menu)$/i.test(text)) return true;
    if (/^[\W_]+$/.test(text)) return true;
    var wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 2) return true;
    return false;
  }

  function collectHtmlComments() {
    var out = [];
    try {
      var walker = document.createTreeWalker(document.documentElement || document, NodeFilter.SHOW_COMMENT, null);
      var current;
      while ((current = walker.nextNode()) && out.length < 100) {
        var text = normalizeWhitespace(current.nodeValue || '');
        if (!text || text.length < 4) continue;
        if (/^\[if\b/i.test(text)) continue;
        out.push({
          kind: 'html',
          text: text,
          author: '',
          time: '',
          selector: '',
          tag: '#comment'
        });
      }
    } catch (e) {}
    return out;
  }

  function collectPageComments() {
    var results = [];
    var seen = Object.create(null);
    var selector = [
      '[role="comment"]',
      '[class*="comment"]',
      '[id*="comment"]',
      '[data-testid*="comment"]',
      '[data-testid*="comment"]',
      '[aria-label*="comment"]',
      '[class*="reply"]',
      '[id*="reply"]',
      '[data-testid*="reply"]',
      '[class*="review"]',
      '[id*="review"]',
      '[data-testid*="review"]',
      'article'
    ].join(',');
    var nodes = [];
    try {
      nodes = document.querySelectorAll(selector);
    } catch (e) {}

    for (var i = 0; i < nodes.length && results.length < 200; i++) {
      var el = nodes[i];
      if (!el || el.nodeType !== 1) continue;
      if (isHiddenElement(el)) continue;
      var tag = (el.tagName || '').toLowerCase();
      if (/^(a|button|input|select|option|textarea|nav|header|footer)$/i.test(tag)) continue;
      var hintText = getElementHintText(el);
      var positiveHint = /\b(comment|comments|reply|replies|review|discussion|testimonial)\b/.test(hintText);
      if (!positiveHint) continue;

      try {
        var nestedCandidates = el.querySelectorAll('[role="comment"], [class*="comment"], [data-testid*="comment"], [class*="reply"], [data-testid*="reply"]');
        if (nestedCandidates && nestedCandidates.length > 2) continue;
      } catch (e) {}

      var text = getReadableElementText(el);
      if (looksLikeNonCommentText(text)) continue;

      var score = scoreCommentCandidate(el, text);
      if (score < 4) continue;

      var textKey = text.toLowerCase();
      if (seen[textKey]) continue;

      var parent = el.parentElement;
      if (parent) {
        var parentText = getReadableElementText(parent);
        if (parentText && parentText === text && scoreCommentCandidate(parent, parentText) >= score) continue;
      }

      var author = findFirstText(el, [
        '[rel="author"]',
        '[itemprop="author"]',
        '[itemprop*="author"]',
        '[class*="author"]',
        '[class*="user"]',
        '[class*="username"]',
        '[class*="display-name"]',
        '[class*="name"]',
        '[data-testid*="author"]',
        '[data-testid*="user"]'
      ]);
      var timeText = findTimeText(el);
      var permalink = '';
      try {
        var linkNodes = el.querySelectorAll ? el.querySelectorAll('a[href]') : [];
        for (var j = 0; j < linkNodes.length; j++) {
          var href = linkNodes[j].href || linkNodes[j].getAttribute('href') || '';
          if (!href) continue;
          var linkText = normalizeWhitespace(linkNodes[j].textContent || '');
          if (linkText && linkText === text) continue;
          if (/comment|reply|permalink|\/status\/|#comment/i.test(href)) {
            permalink = href;
            break;
          }
        }
      } catch (e) {}

      seen[textKey] = true;
      results.push({
        kind: 'page',
        text: text,
        author: author,
        time: timeText,
        permalink: permalink,
        selector: hintText,
        tag: tag
      });
    }

    var htmlComments = collectHtmlComments();
    for (var k = 0; k < htmlComments.length && results.length < 250; k++) {
      var htmlComment = htmlComments[k];
      var htmlKey = 'html:' + htmlComment.text.toLowerCase();
      if (seen[htmlKey]) continue;
      seen[htmlKey] = true;
      results.push(htmlComment);
    }

    return {
      pageUrl: window.location.href,
      pageTitle: document.title || '',
      comments: results
    };
  }

  function collectPageCommentSources() {
    var scripts = [];
    var stylesheets = [];
    var seenScripts = Object.create(null);
    var seenStyles = Object.create(null);

    try {
      var scriptNodes = document.querySelectorAll('script[src]');
      for (var i = 0; i < scriptNodes.length; i++) {
        var scriptUrl = resolveScriptSrc(scriptNodes[i].getAttribute('src'));
        if (!scriptUrl || seenScripts[scriptUrl]) continue;
        seenScripts[scriptUrl] = true;
        scripts.push(scriptUrl);
      }
    } catch (e) {}

    try {
      var styleNodes = document.querySelectorAll('link[rel~="stylesheet"][href], link[as="style"][href]');
      for (var j = 0; j < styleNodes.length; j++) {
        var href = styleNodes[j].getAttribute('href');
        if (!href) continue;
        var styleUrl = '';
        try { styleUrl = new URL(href, window.location.href).href; } catch (e) { styleUrl = String(href || ''); }
        if (!styleUrl || seenStyles[styleUrl]) continue;
        seenStyles[styleUrl] = true;
        stylesheets.push(styleUrl);
      }
    } catch (e) {}

    return {
      pageUrl: window.location.href,
      pageTitle: document.title || '',
      scripts: scripts,
      stylesheets: stylesheets
    };
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

  function isExtensionUrl(u) {
    return (u || '').trim().toLowerCase().startsWith('chrome-extension://');
  }

  window.addEventListener('message', function(event) {
    try {
      if (event.source !== window) return;
      if (event.data.type !== 'API_LEECH_BODY' && event.data.type !== 'API_LEECH_RESPONSE') return;
      var payload = { type: event.data.type, data: event.data.data };
      if (payload.data && payload.data.url && isExtensionUrl(payload.data.url)) return;
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

  var MAX_DOCUMENT_CHARS = 500000;
  if (window === window.top) {
    window.addEventListener('load', function() {
      try {
        var url = window.location.href;
        if (isExtensionUrl(url)) return;
        var html = document.documentElement.outerHTML;
        if (!html || html.length === 0) return;
        if (html.length > MAX_DOCUMENT_CHARS) {
          html = html.slice(0, MAX_DOCUMENT_CHARS) + '\n\n/* truncated ' + (html.length - MAX_DOCUMENT_CHARS) + ' chars */';
        }
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
        if (msg.action === 'getPageCommentSources') {
          safeSend(collectPageCommentSources());
          return false;
        }
        if (msg.action === 'scanPageComments') {
          safeSend(collectPageComments());
          return false;
        }
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
