(function() {
  'use strict';

  function serializeBody(body) {
    if (body === null || body === undefined) return null;
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) {
      const parts = [];
      body.forEach((value, key) => { parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value)); });
      return parts.join('&');
    }
    if (body instanceof ArrayBuffer || body instanceof Uint8Array) return '[Binary Data]';
    if (body instanceof Blob) return '[Blob]';
    if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return '[Stream]';
    try { return JSON.stringify(body); } catch { return String(body); }
  }

  function resolveUrl(url) {
    try { return new URL(url, window.location.href).href; } catch { return String(url); }
  }

  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    try {
      let url, method, body;

      if (args[0] instanceof Request) {
        const req = args[0];
        url = req.url;
        method = (req.method || 'GET').toUpperCase();
        const opts = args[1] || {};
        body = opts.body !== undefined ? serializeBody(opts.body) : null;
      } else {
        url = resolveUrl(args[0]);
        const opts = args[1] || {};
        method = (opts.method || 'GET').toUpperCase();
        body = opts.body !== undefined ? serializeBody(opts.body) : null;
      }

      window.postMessage({
        type: 'API_LEECH_BODY',
        data: { url, method, body, timestamp: new Date().toISOString() }
      }, '*');

      const promise = originalFetch.apply(this, args);
      promise.then(async (response) => {
        try {
          const cloned = response.clone();
          const responseBody = await cloned.text();
          window.postMessage({
            type: 'API_LEECH_RESPONSE',
            data: { url, method, responseBody, timestamp: new Date().toISOString() }
          }, '*');
        } catch (e) {}
      }).catch(() => {});

      return promise;
    } catch (e) {
      return originalFetch.apply(this, args);
    }
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._erpData = {
      method: (method || 'GET').toUpperCase(),
      url: resolveUrl(url),
      timestamp: new Date().toISOString()
    };
    
    this.addEventListener('load', function() {
      if (!this._erpData) return;
      var responseBody = null;
      try {
        if (this.responseType === '' || this.responseType === 'text') {
          responseBody = this.responseText;
        }
      } catch (e) {}
      if (responseBody !== null) {
        window.postMessage({
          type: 'API_LEECH_RESPONSE',
          data: {
            url: this._erpData.url,
            method: this._erpData.method,
            responseBody: responseBody,
            timestamp: new Date().toISOString()
          }
        }, '*');
      }
    });

    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(body) {
    if (this._erpData) {
      this._erpData.body = serializeBody(body);
      window.postMessage({
        type: 'API_LEECH_BODY',
        data: this._erpData
      }, '*');
    }
    return originalSend.apply(this, arguments);
  };

  (function() {
    setInterval(function() {
      var el = document.documentElement;
      var url = el.getAttribute('data-ig-fetch-url');
      if (!url) return;
      el.removeAttribute('data-ig-fetch-url');
      originalFetch(url, { credentials: 'include' })
        .then(function(r) { return r.ok ? r.blob() : Promise.reject(); })
        .then(function(blob) {
          return new Promise(function(resolve) {
            var fr = new FileReader();
            fr.onload = function() { resolve(fr.result); };
            fr.readAsDataURL(blob);
          });
        })
        .then(function(dataUrl) {
          el.setAttribute('data-ig-fetch-result', dataUrl);
          el.setAttribute('data-ig-fetch-result-url', url);
        })
        .catch(function() {
          el.setAttribute('data-ig-fetch-result', '');
          el.setAttribute('data-ig-fetch-result-url', url);
        });
    }, 150);
  })();
})();
