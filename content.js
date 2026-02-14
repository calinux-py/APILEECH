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
