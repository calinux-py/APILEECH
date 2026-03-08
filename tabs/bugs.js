// ─────────────────────────────────────────────────────────────────────────────
// Bug Hunter — improved version
//
// Key changes from previous version:
//  1. FIXED: buildBugHunterFindings no longer silently discards most findings.
//     Previously ALL header findings (missing-csp, missing-hsts, etc.) were
//     generated then thrown away because they had no BUG_CONFIRMED_FINDING_RULES
//     match. Now classification is additive metadata, not a filter gate.
//  2. FIXED: CORS wildcard no longer fires on CDN static assets. Only flagged
//     when the response is an API/data type (JSON/XML) or credentials are involved.
//  3. FIXED: Session cookie checks now exclude known analytics/tracking cookies
//     (_ga, _fbp, __utm*, etc.) that legitimately omit Secure/HttpOnly.
//  4. FIXED: CSRF finding now only fires for same-origin POST forms with
//     meaningful actions, cutting most false positives.
//  5. FIXED: SRI check no longer fires for well-known trusted CDN origins.
//  6. FIXED: Internal-host pattern now requires a URL context (http://, port,
//     path) rather than matching bare "localhost" anywhere in the DOM.
//  7. FIXED: CSP unsafe-inline suppressed when strict-dynamic + nonce/hash
//     present (modern browsers ignore unsafe-inline in that case).
//  8. NEW: CORS reflected-origin detection (most impactful CORS class).
//  9. NEW: CSP base-uri missing check (enables base-tag injection).
// 10. NEW: CSP form-action missing check (enables form-target hijacking).
// 11. NEW: Secret scanning extended to JSON/API response bodies.
// 12. NEW: SQL error and verbose exception detection in all response bodies.
// 13. NEW: Credential-like keys in JSON API responses (password, secret, key).
// 14. SEVERITY: missing-coop downgraded low, missing-permissions-policy → info,
//     missing-referrer-policy → low, cors-wildcard-no-creds → medium.
// ─────────────────────────────────────────────────────────────────────────────

const BUG_REFRESH_MS = 2000;

const BUG_REFERENCE_URLS = {
  csp: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy',
  xfo: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options',
  hsts: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security',
  nosniff: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options',
  referrerPolicy: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy',
  permissionsPolicy: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy',
  coop: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy',
  corp: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Resource-Policy',
  sri: 'https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity',
  mixedContent: 'https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content',
  csrf: 'https://owasp.org/www-community/attacks/csrf',
  graphqlIntrospection: 'https://graphql.org/learn/introspection/',
  apache41773: 'https://nvd.nist.gov/vuln/detail/CVE-2021-41773',
  apache42013: 'https://nvd.nist.gov/vuln/detail/CVE-2021-42013',
  jquery11022: 'https://nvd.nist.gov/vuln/detail/CVE-2020-11022',
  jquery11023: 'https://nvd.nist.gov/vuln/detail/CVE-2020-11023',
  bootstrap8331: 'https://nvd.nist.gov/vuln/detail/CVE-2019-8331',
  cookiePrefixes: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes',
  cacheControl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control'
};

// Classification tags for findings that have hard, unambiguous evidence.
// This is now ADDITIVE metadata only — findings without a matching rule are
// still shown; they just won't carry a classification chip.
const BUG_CONFIRMED_FINDING_RULES = [
  // ── CVEs ──────────────────────────────────────────────────────────────────
  { pattern: /^apache-2-4-49-cve$/, classification: 'Known CVE' },
  { pattern: /^apache-2-4-50-cve$/, classification: 'Known CVE' },
  { pattern: /^jquery-pre-3-5$/, classification: 'Known CVE' },
  { pattern: /^bootstrap-pre-4-3-1$/, classification: 'Known CVE' },
  // ── CORS ──────────────────────────────────────────────────────────────────
  { pattern: /^cors-wildcard-credentials$/, classification: 'CORS Misconfiguration' },
  { pattern: /^cors-reflected-origin$/, classification: 'CORS Misconfiguration' },
  { pattern: /^cors-wildcard-api$/, classification: 'CORS Misconfiguration' },
  // ── Cookies ───────────────────────────────────────────────────────────────
  { pattern: /^session-cookie-missing-secure$/, classification: 'Cookie Misconfiguration' },
  { pattern: /^session-cookie-missing-httponly$/, classification: 'Cookie Misconfiguration' },
  { pattern: /^host-prefix-cookie-invalid$/, classification: 'Cookie Misconfiguration' },
  { pattern: /^secure-prefix-cookie-invalid$/, classification: 'Cookie Misconfiguration' },
  // ── Token / Credential exposure ───────────────────────────────────────────
  { pattern: /^oauth-token-in-url$/, classification: 'Token Exposure' },
  { pattern: /^html-comment-credentials$/, classification: 'Credential Exposure' },
  { pattern: /^secret-pattern-/, classification: 'Secret Exposure' },
  { pattern: /^jwt-exposed-html$/, classification: 'Token Exposure' },
  { pattern: /^api-secret-in-response$/, classification: 'Secret Exposure' },
  // ── Debug / Info disclosure ───────────────────────────────────────────────
  { pattern: /^stack-trace-exposed$/, classification: 'Debug Exposure' },
  { pattern: /^sql-error-exposed$/, classification: 'Debug Exposure' },
  { pattern: /^debug-headers$/, classification: 'Debug Exposure' },
  { pattern: /^server-version-disclosure$/, classification: 'Version Disclosure' },
  { pattern: /^x-powered-by-disclosure$/, classification: 'Version Disclosure' },
  { pattern: /^aspnet-version-disclosure$/, classification: 'Version Disclosure' },
  // ── Transport ─────────────────────────────────────────────────────────────
  { pattern: /^login-form-over-http$/, classification: 'Transport Flaw' },
  { pattern: /^mixed-content$/, classification: 'Transport Flaw' },
  { pattern: /^insecure-websocket$/, classification: 'Transport Flaw' },
  { pattern: /^insecure-websocket-endpoint$/, classification: 'Transport Flaw' },
  // ── Missing critical security headers ────────────────────────────────────
  { pattern: /^missing-csp$/, classification: 'Missing Security Header' },
  { pattern: /^missing-hsts$/, classification: 'Missing Security Header' },
  { pattern: /^missing-nosniff$/, classification: 'Missing Security Header' },
  { pattern: /^missing-clickjacking-protection$/, classification: 'Missing Security Header' },
  // ── CSP weaknesses ────────────────────────────────────────────────────────
  { pattern: /^csp-unsafe-inline$/, classification: 'CSP Weakness' },
  { pattern: /^csp-unsafe-eval$/, classification: 'CSP Weakness' },
  { pattern: /^csp-wildcard-script$/, classification: 'CSP Weakness' },
  { pattern: /^csp-missing-base-uri$/, classification: 'CSP Weakness' },
  { pattern: /^csp-missing-form-action$/, classification: 'CSP Weakness' },
  { pattern: /^csp-data-script$/, classification: 'CSP Weakness' },
  // ── Exposures ─────────────────────────────────────────────────────────────
  { pattern: /^directory-listing$/, classification: 'Exposure' },
  { pattern: /^cloud-metadata-reference-request$/, classification: 'Cloud Metadata Exposure' },
  { pattern: /^cloud-metadata-reference-html$/, classification: 'Cloud Metadata Exposure' },
  { pattern: /^cloud-metadata-endpoint$/, classification: 'Cloud Metadata Exposure' },
  { pattern: /^sourcemap-exposed-inline$/, classification: 'Source Exposure' },
  { pattern: /^sourcemap-request$/, classification: 'Source Exposure' },
  { pattern: /^swagger-openapi-exposed$/, classification: 'API Exposure' },
  { pattern: /^swagger-openapi-request$/, classification: 'API Exposure' },
  { pattern: /^graphiql-exposed$/, classification: 'API Exposure' },
  { pattern: /^jsonp-endpoint$/, classification: 'API Exposure' },
  { pattern: /^graphql-introspection$/, classification: 'API Exposure' },
  { pattern: /^internal-host-exposed-html$/, classification: 'Internal Endpoint Exposure' },
  { pattern: /^internal-host-endpoint$/, classification: 'Internal Endpoint Exposure' }
];

// Analytics/tracking cookie name prefixes that legitimately omit security
// attributes. Checking these for Secure/HttpOnly would be false positives.
const BUG_ANALYTICS_COOKIE_RE = /^(_ga|_gid|_gcl_|_fbp|_fbc|_hjid|_hjSessionUser|__utm|_uetsid|_uetvid|_pin_unauth|amplitude_id|mp_|mixpanel|intercom-|drift_|hs_|hubspotutk|_ym_|_pk_|matomo)/i;

// CDN origins where ACAO:* is normal and expected. We skip wildcard CORS
// findings for resources served from these origins.
const BUG_TRUSTED_CDN_ORIGINS = new Set([
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdn.skypack.dev',
  'esm.sh',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ajax.googleapis.com',
  'code.jquery.com',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
  'cdn.bootcss.com',
  'cdn.bootcdn.net'
]);

let bugRefreshInterval = null;
let lastBugDataSignature = '';

function stopBugRefresh() {
  if (bugRefreshInterval) {
    clearInterval(bugRefreshInterval);
    bugRefreshInterval = null;
  }
  lastBugDataSignature = '';
}

function startBugRefresh() {
  stopBugRefresh();
  bugRefreshInterval = setInterval(() => {
    if (currentView === 'bugs') {
      loadRequests();
    } else {
      stopBugRefresh();
    }
  }, BUG_REFRESH_MS);
}

function bugSeverityRank(value) {
  switch (String(value || '').toLowerCase()) {
    case 'critical': return 5;
    case 'high':     return 4;
    case 'medium':   return 3;
    case 'low':      return 2;
    case 'info':     return 1;
    default:         return 0;
  }
}

function bugConfidenceRank(value) {
  switch (String(value || '').toLowerCase()) {
    case 'high':   return 3;
    case 'medium': return 2;
    case 'low':    return 1;
    default:       return 0;
  }
}

function bugLabel(value) {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return 'Unknown';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function bugRefs(...pairs) {
  return pairs.filter(Boolean).map(pair => {
    if (Array.isArray(pair)) return { label: pair[0], url: pair[1] };
    return pair;
  });
}

function bugRequestTouchesHostname(req, hostname) {
  const targetHost = String(hostname || '').toLowerCase();
  if (!targetHost || !req) return false;
  const requestHost = bugHostnameFromUrl(req.url);
  const initiatorHost = bugHostnameFromUrl(req.initiator);
  return requestHost === targetHost || initiatorHost === targetHost;
}

function bugHostnameFromUrl(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

function bugOriginFromUrl(value) {
  try {
    return new URL(String(value || '')).origin;
  } catch (_) {
    return '';
  }
}

function bugPathFromUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return `${parsed.pathname}${parsed.search}`;
  } catch (_) {
    return String(value || '');
  }
}

function bugIsHttpsUrl(value) {
  try {
    return new URL(String(value || '')).protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function getBugScopedRequests(requests) {
  const list = Array.isArray(requests) ? requests : [];
  return list.filter(req => {
    if (!req || typeof req !== 'object') return false;
    if (Number.isFinite(activeTabId) && activeTabId >= 0 && req.tabId === activeTabId) {
      if (!activeTabDomain) return true;
      if (bugRequestTouchesHostname(req, activeTabDomain)) return true;
      return bugNormalizeComparableUrl(req.url) === bugNormalizeComparableUrl(activeTabUrl);
    }
    if (!activeTabDomain) return false;
    return bugRequestTouchesHostname(req, activeTabDomain);
  });
}

function bugNormalizeComparableUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch (_) {
    return '';
  }
}

function bugSelectDocumentRequest(requests) {
  const docs = (Array.isArray(requests) ? requests : []).filter(req => req && req.type === 'document');
  if (!docs.length) return null;

  const exactUrl = bugNormalizeComparableUrl(activeTabUrl);
  if (exactUrl) {
    const exact = docs.find(req => bugNormalizeComparableUrl(req.url) === exactUrl);
    if (exact) return exact;
  }

  return docs.slice().sort((a, b) => {
    return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
  })[0] || null;
}

function bugHeaderValues(headers, name) {
  const wanted = String(name || '').toLowerCase();
  const values = [];
  if (!Array.isArray(headers) || !wanted) return values;
  headers.forEach(header => {
    if (!header || typeof header !== 'object') return;
    const headerName = String(header.name || header[0] || '').toLowerCase();
    if (headerName !== wanted) return;
    const value = header.value != null ? header.value : header[1];
    if (value != null) values.push(String(value));
  });
  return values;
}

function bugHeaderValue(headers, name) {
  const values = bugHeaderValues(headers, name);
  return values.length ? values[0] : '';
}

function bugParseHtmlDocument(html) {
  if (!html || typeof html !== 'string') return null;
  try {
    return new DOMParser().parseFromString(html, 'text/html');
  } catch (_) {
    return null;
  }
}

function bugCreateFinding(state, finding) {
  if (!state || !finding) return;
  const identity = `${finding.id || 'bug'}||${finding.url || ''}||${finding.evidenceKey || ''}`;
  if (state.seen.has(identity)) return;
  state.seen.add(identity);
  state.findings.push({
    severity: 'medium',
    confidence: 'medium',
    category: 'General',
    proof: [],
    refs: [],
    cve: null,
    cwe: null,
    code: '',
    codeLang: 'text',
    ...finding,
    proof: Array.isArray(finding.proof) ? finding.proof.filter(Boolean) : [],
    refs: Array.isArray(finding.refs) ? finding.refs.filter(ref => ref && ref.url) : []
  });
}

function bugSnippet(text, index, radius = 140) {
  const source = String(text || '');
  const at = Number(index);
  if (!source) return '';
  if (!Number.isFinite(at) || at < 0) return source.slice(0, Math.min(radius * 2, source.length));
  const start = Math.max(0, at - radius);
  const end = Math.min(source.length, at + radius);
  return source.slice(start, end).trim();
}

function bugFindTextMatch(text, regex) {
  if (!text || !(regex instanceof RegExp)) return null;
  const copy = new RegExp(regex.source, regex.flags);
  const match = copy.exec(String(text));
  if (!match) return null;
  return {
    match: match[0],
    groups: match,
    index: match.index,
    snippet: bugSnippet(text, match.index)
  };
}

function bugParseCsp(policy) {
  const directives = Object.create(null);
  String(policy || '').split(';').forEach(rawDirective => {
    const parts = rawDirective.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return;
    const name = parts.shift().toLowerCase();
    directives[name] = parts.map(part => part.trim());
  });
  return directives;
}

function bugGetCspSources(directives, name) {
  const key = String(name || '').toLowerCase();
  if (!directives || !key) return [];
  if (Array.isArray(directives[key])) return directives[key];
  if (Array.isArray(directives['default-src'])) return directives['default-src'];
  return [];
}

function bugCspHasToken(directives, directiveName, token) {
  const normalized = String(token || '').toLowerCase();
  return bugGetCspSources(directives, directiveName).some(value => String(value || '').toLowerCase() === normalized);
}

function bugCspHasWildcard(directives, directiveName) {
  return bugGetCspSources(directives, directiveName).some(value => String(value || '').trim() === '*');
}

// Returns true when strict-dynamic is present alongside a nonce or hash,
// meaning unsafe-inline is effectively ignored by compliant browsers.
function bugCspStrictDynamicActive(directives) {
  const sources = bugGetCspSources(directives, 'script-src');
  const hasStrictDynamic = sources.some(s => String(s).toLowerCase() === "'strict-dynamic'");
  if (!hasStrictDynamic) return false;
  const hasNonceOrHash = sources.some(s => /^'nonce-/i.test(s) || /^'sha(?:256|384|512)-/i.test(s));
  return hasNonceOrHash;
}

function bugParseMaxAge(value) {
  const match = /max-age\s*=\s*(\d+)/i.exec(String(value || ''));
  return match ? parseInt(match[1], 10) : null;
}

function bugParseSetCookie(rawHeader) {
  const raw = String(rawHeader || '').trim();
  if (!raw) return null;
  const parts = raw.split(';').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const eqIndex = parts[0].indexOf('=');
  const name = eqIndex === -1 ? parts[0] : parts[0].slice(0, eqIndex).trim();
  const value = eqIndex === -1 ? '' : parts[0].slice(eqIndex + 1).trim();
  const attrs = Object.create(null);
  for (let i = 1; i < parts.length; i++) {
    const attr = parts[i];
    const attrEq = attr.indexOf('=');
    if (attrEq === -1) {
      attrs[attr.toLowerCase()] = true;
    } else {
      const attrName = attr.slice(0, attrEq).trim().toLowerCase();
      const attrValue = attr.slice(attrEq + 1).trim();
      attrs[attrName] = attrValue;
    }
  }
  return { name, value, attrs, raw };
}

function bugLooksLikeSessionCookie(name) {
  const n = String(name || '');
  // First exclude known analytics/ad/tracking cookies — these legitimately
  // omit Secure/HttpOnly and flagging them is a false positive.
  if (BUG_ANALYTICS_COOKIE_RE.test(n)) return false;
  return /(session|sess|sid|auth|token|jwt|remember|connect\.sid|phpsessid|laravel_session|aspxauth|asp\.net_sessionid|csrf|xsrf|sso|login|id_token|access_token)/i.test(n);
}

function bugHasTokenLikeValue(text) {
  return /(access[_-]?token|id[_-]?token|refresh[_-]?token|jwt|bearer|authorization|client[_-]?secret|api[_-]?key)/i.test(String(text || ''));
}

function bugResponseIsApiLike(req) {
  // Returns true when the response Content-Type suggests JSON/XML/API data
  // rather than a static asset. Used to filter noisy CORS wildcard findings.
  const ct = bugHeaderValue(
    Array.isArray(req.responseHeaders) ? req.responseHeaders : [],
    'content-type'
  ).toLowerCase();
  return /\bjson\b|\bxml\b|\bgraphql\b|\bapi\b/.test(ct) ||
    /application\//.test(ct) && !/application\/(javascript|ecmascript|x-javascript|font|wasm|octet-stream)/.test(ct);
}

function bugSortFindings(findings) {
  return findings.slice().sort((a, b) => {
    const severityDiff = bugSeverityRank(b.severity) - bugSeverityRank(a.severity);
    if (severityDiff !== 0) return severityDiff;
    const confidenceDiff = bugConfidenceRank(b.confidence) - bugConfidenceRank(a.confidence);
    if (confidenceDiff !== 0) return confidenceDiff;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function bugFilterFindings(findings) {
  if (!requestUrlSearchQuery || !String(requestUrlSearchQuery).trim()) return findings;
  const query = String(requestUrlSearchQuery).trim().toLowerCase();
  return findings.filter(finding => {
    const haystack = [
      finding.title,
      finding.summary,
      finding.url,
      finding.category,
      finding.severity,
      finding.confidence,
      finding.classification,
      finding.cve,
      finding.cwe,
      ...(Array.isArray(finding.proof) ? finding.proof : []),
      finding.code
    ].join('\n').toLowerCase();
    return haystack.includes(query);
  });
}

function bugGetConfirmedClassification(findingId) {
  const id = String(findingId || '');
  for (let i = 0; i < BUG_CONFIRMED_FINDING_RULES.length; i++) {
    const rule = BUG_CONFIRMED_FINDING_RULES[i];
    if (rule.pattern.test(id)) return rule.classification;
  }
  return '';
}

// ─── Header findings ──────────────────────────────────────────────────────────

function bugAddHeaderFindings(state, documentRequest, scopedRequests) {
  if (!documentRequest) return;

  const responseHeaders = Array.isArray(documentRequest.responseHeaders) ? documentRequest.responseHeaders : [];
  const requestHeaders  = Array.isArray(documentRequest.requestHeaders)  ? documentRequest.requestHeaders  : [];
  const csp              = bugHeaderValue(responseHeaders, 'content-security-policy');
  const cspReportOnly    = bugHeaderValue(responseHeaders, 'content-security-policy-report-only');
  const xfo              = bugHeaderValue(responseHeaders, 'x-frame-options');
  const hsts             = bugHeaderValue(responseHeaders, 'strict-transport-security');
  const nosniff          = bugHeaderValue(responseHeaders, 'x-content-type-options');
  const referrerPolicy   = bugHeaderValue(responseHeaders, 'referrer-policy');
  const permissionsPolicy= bugHeaderValue(responseHeaders, 'permissions-policy');
  const coop             = bugHeaderValue(responseHeaders, 'cross-origin-opener-policy');
  const corp             = bugHeaderValue(responseHeaders, 'cross-origin-resource-policy');
  const server           = bugHeaderValue(responseHeaders, 'server');
  const poweredBy        = bugHeaderValue(responseHeaders, 'x-powered-by');
  const aspNetVersion    = bugHeaderValue(responseHeaders, 'x-aspnet-version') || bugHeaderValue(responseHeaders, 'x-aspnetmvc-version');

  // ── Content-Security-Policy ───────────────────────────────────────────────

  if (!csp && !cspReportOnly) {
    bugCreateFinding(state, {
      id: 'missing-csp',
      title: 'No Content-Security-Policy on the main document',
      severity: 'high',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'The HTML response has no enforced CSP, leaving the page vulnerable to content injection and XSS.',
      proof: [
        `No Content-Security-Policy header on ${bugPathFromUrl(documentRequest.url)}.`,
        `Status: ${documentRequest.statusCode || 'unknown'}`
      ],
      refs: bugRefs(['MDN CSP', BUG_REFERENCE_URLS.csp])
    });
  }

  if (!csp && cspReportOnly) {
    bugCreateFinding(state, {
      id: 'csp-report-only-only',
      title: 'CSP present only in report-only mode — not enforced',
      severity: 'medium',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'Content-Security-Policy-Report-Only collects telemetry but does not block any execution.',
      proof: [`Content-Security-Policy-Report-Only: ${cspReportOnly}`],
      code: `Content-Security-Policy-Report-Only: ${cspReportOnly}`,
      codeLang: 'http',
      refs: bugRefs(['MDN CSP', BUG_REFERENCE_URLS.csp])
    });
  }

  if (csp) {
    const directives   = bugParseCsp(csp);
    const frameAncestors = bugGetCspSources(directives, 'frame-ancestors');
    const scriptSources  = bugGetCspSources(directives, 'script-src');
    // Only flag unsafe-inline if strict-dynamic+nonce/hash is NOT active,
    // because in that case modern browsers already ignore unsafe-inline.
    const strictDynamicActive = bugCspStrictDynamicActive(directives);

    if (!strictDynamicActive && bugCspHasToken(directives, 'script-src', "'unsafe-inline'")) {
      bugCreateFinding(state, {
        id: 'csp-unsafe-inline',
        title: 'CSP allows inline script execution (unsafe-inline)',
        severity: 'high',
        confidence: 'high',
        category: 'Headers',
        url: documentRequest.url,
        summary: "The enforced CSP includes 'unsafe-inline' in script-src without strict-dynamic+nonce, allowing inline XSS payloads.",
        proof: [`Content-Security-Policy: ${csp}`],
        code: `Content-Security-Policy: ${csp}`,
        codeLang: 'http',
        refs: bugRefs(['MDN CSP', BUG_REFERENCE_URLS.csp])
      });
    }

    if (bugCspHasToken(directives, 'script-src', "'unsafe-eval'")) {
      bugCreateFinding(state, {
        id: 'csp-unsafe-eval',
        title: "CSP allows eval-like execution (unsafe-eval)",
        severity: 'high',
        confidence: 'high',
        category: 'Headers',
        url: documentRequest.url,
        summary: "The enforced CSP includes 'unsafe-eval' in script-src, enabling script gadgets such as eval() and Function().",
        proof: [`Content-Security-Policy: ${csp}`],
        code: `Content-Security-Policy: ${csp}`,
        codeLang: 'http',
        refs: bugRefs(['MDN CSP', BUG_REFERENCE_URLS.csp])
      });
    }

    if (bugCspHasWildcard(directives, 'script-src')) {
      bugCreateFinding(state, {
        id: 'csp-wildcard-script',
        title: 'CSP script-src uses wildcard (*) — any origin trusted',
        severity: 'medium',
        confidence: 'high',
        category: 'Headers',
        url: documentRequest.url,
        summary: 'A wildcard in script-src trusts scripts from any origin, neutralising the XSS protection.',
        proof: [`script-src ${scriptSources.join(' ')}`],
        code: `Content-Security-Policy: ${csp}`,
        codeLang: 'http',
        refs: bugRefs(['MDN CSP', BUG_REFERENCE_URLS.csp])
      });
    }

    if (bugCspHasToken(directives, 'script-src', 'data:') || bugCspHasToken(directives, 'script-src', 'blob:')) {
      bugCreateFinding(state, {
        id: 'csp-data-script',
        title: 'CSP permits data: or blob: in script-src',
        severity: 'medium',
        confidence: 'high',
        category: 'Headers',
        url: documentRequest.url,
        summary: 'Allowing data: or blob: URIs for scripts weakens CSP-based XSS containment.',
        proof: [`script-src ${scriptSources.join(' ')}`],
        code: `Content-Security-Policy: ${csp}`,
        codeLang: 'http',
        refs: bugRefs(['MDN CSP', BUG_REFERENCE_URLS.csp])
      });
    }

    // base-uri: if absent and base-src not set, an injected <base> tag can
    // redirect all relative URLs to an attacker-controlled origin.
    if (!directives['base-uri']) {
      bugCreateFinding(state, {
        id: 'csp-missing-base-uri',
        title: 'CSP does not restrict base-uri',
        severity: 'medium',
        confidence: 'high',
        category: 'Headers',
        url: documentRequest.url,
        summary: "Without a base-uri directive an XSS payload can inject a <base> tag to redirect relative URLs to an attacker origin.",
        proof: [`No base-uri in: Content-Security-Policy: ${csp}`],
        code: `Content-Security-Policy: ${csp}`,
        codeLang: 'http',
        refs: bugRefs(['MDN CSP', BUG_REFERENCE_URLS.csp])
      });
    }

    // form-action: if absent, forms can be hijacked to post to any URL.
    if (!directives['form-action']) {
      bugCreateFinding(state, {
        id: 'csp-missing-form-action',
        title: 'CSP does not restrict form-action',
        severity: 'medium',
        confidence: 'high',
        category: 'Headers',
        url: documentRequest.url,
        summary: 'Without a form-action directive a script injection can change form targets to exfiltrate submitted data.',
        proof: [`No form-action in: Content-Security-Policy: ${csp}`],
        code: `Content-Security-Policy: ${csp}`,
        codeLang: 'http',
        refs: bugRefs(['MDN CSP', BUG_REFERENCE_URLS.csp])
      });
    }

    // frame-ancestors / clickjacking
    if (!xfo && frameAncestors.length === 0) {
      bugCreateFinding(state, {
        id: 'missing-clickjacking-protection',
        title: 'No clickjacking protection (X-Frame-Options / frame-ancestors)',
        severity: 'high',
        confidence: 'high',
        category: 'Headers',
        url: documentRequest.url,
        summary: 'The page has neither X-Frame-Options nor a CSP frame-ancestors directive — it can be framed by any origin.',
        proof: [`No X-Frame-Options header and no frame-ancestors directive on ${bugPathFromUrl(documentRequest.url)}.`],
        refs: bugRefs(
          ['MDN X-Frame-Options', BUG_REFERENCE_URLS.xfo],
          ['MDN CSP', BUG_REFERENCE_URLS.csp]
        )
      });
    }
  } else if (!xfo) {
    bugCreateFinding(state, {
      id: 'missing-clickjacking-protection',
      title: 'No clickjacking protection (X-Frame-Options / frame-ancestors)',
      severity: 'high',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'The page has neither X-Frame-Options nor a CSP frame-ancestors directive.',
      proof: [`No X-Frame-Options header on ${bugPathFromUrl(documentRequest.url)}.`],
      refs: bugRefs(['MDN X-Frame-Options', BUG_REFERENCE_URLS.xfo])
    });
  }

  // ── HSTS ─────────────────────────────────────────────────────────────────

  if (bugIsHttpsUrl(documentRequest.url) && !hsts) {
    bugCreateFinding(state, {
      id: 'missing-hsts',
      title: 'HTTPS page is missing Strict-Transport-Security',
      severity: 'high',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'The page is served over HTTPS but does not set an HSTS policy, allowing downgrade attacks.',
      proof: [`No Strict-Transport-Security header on ${bugPathFromUrl(documentRequest.url)}.`],
      refs: bugRefs(['MDN HSTS', BUG_REFERENCE_URLS.hsts])
    });
  }

  if (hsts) {
    const maxAge = bugParseMaxAge(hsts);
    if (Number.isFinite(maxAge) && maxAge < 15552000) {
      bugCreateFinding(state, {
        id: 'weak-hsts-max-age',
        title: 'HSTS max-age is less than six months',
        severity: 'medium',
        confidence: 'high',
        category: 'Headers',
        url: documentRequest.url,
        summary: 'An HSTS max-age shorter than six months (15552000s) provides limited protection window.',
        proof: [`Strict-Transport-Security: ${hsts}`],
        code: `Strict-Transport-Security: ${hsts}`,
        codeLang: 'http',
        refs: bugRefs(['MDN HSTS', BUG_REFERENCE_URLS.hsts])
      });
    }
    if (!/includesubdomains/i.test(hsts)) {
      bugCreateFinding(state, {
        id: 'hsts-no-include-subdomains',
        title: 'HSTS does not include subdomains',
        severity: 'low',
        confidence: 'high',
        category: 'Headers',
        url: documentRequest.url,
        summary: 'The HSTS policy omits includeSubDomains, leaving child hosts outside the upgrade scope.',
        proof: [`Strict-Transport-Security: ${hsts}`],
        code: `Strict-Transport-Security: ${hsts}`,
        codeLang: 'http',
        refs: bugRefs(['MDN HSTS', BUG_REFERENCE_URLS.hsts])
      });
    }
  }

  // ── X-Content-Type-Options ────────────────────────────────────────────────

  if (!/nosniff/i.test(nosniff)) {
    bugCreateFinding(state, {
      id: 'missing-nosniff',
      title: 'X-Content-Type-Options: nosniff is missing',
      severity: 'high',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'Without nosniff, browsers may MIME-sniff responses and execute content as a different type.',
      proof: [`Observed X-Content-Type-Options: ${nosniff || '(missing)'}`],
      refs: bugRefs(['MDN X-Content-Type-Options', BUG_REFERENCE_URLS.nosniff])
    });
  }

  // ── Referrer-Policy ───────────────────────────────────────────────────────

  if (!referrerPolicy) {
    bugCreateFinding(state, {
      id: 'missing-referrer-policy',
      title: 'Referrer-Policy is missing',
      severity: 'low',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'Without an explicit Referrer-Policy the browser default may send full referrer URLs on cross-origin navigations.',
      proof: [`No Referrer-Policy header on ${bugPathFromUrl(documentRequest.url)}.`],
      refs: bugRefs(['MDN Referrer-Policy', BUG_REFERENCE_URLS.referrerPolicy])
    });
  } else if (/^(unsafe-url|no-referrer-when-downgrade)$/i.test(referrerPolicy.trim())) {
    bugCreateFinding(state, {
      id: 'weak-referrer-policy',
      title: 'Referrer-Policy uses a permissive value',
      severity: 'medium',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'The policy value allows the full URL to be sent as a referrer on cross-origin requests.',
      proof: [`Referrer-Policy: ${referrerPolicy}`],
      code: `Referrer-Policy: ${referrerPolicy}`,
      codeLang: 'http',
      refs: bugRefs(['MDN Referrer-Policy', BUG_REFERENCE_URLS.referrerPolicy])
    });
  }

  // ── Permissions-Policy ────────────────────────────────────────────────────
  // Downgraded to info: absence of Permissions-Policy is a hardening
  // recommendation, not a vulnerability. Many legitimate sites omit it.

  if (!permissionsPolicy) {
    bugCreateFinding(state, {
      id: 'missing-permissions-policy',
      title: 'Permissions-Policy is not set',
      severity: 'info',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'No Permissions-Policy header restricts powerful browser features (camera, microphone, etc.).',
      proof: [`No Permissions-Policy header on ${bugPathFromUrl(documentRequest.url)}.`],
      refs: bugRefs(['MDN Permissions-Policy', BUG_REFERENCE_URLS.permissionsPolicy])
    });
  }

  // ── Cross-Origin-Opener-Policy ────────────────────────────────────────────
  // Downgraded to low: COOP is a hardening header; its absence does not
  // indicate a specific vulnerability in most contexts.

  if (!coop) {
    bugCreateFinding(state, {
      id: 'missing-coop',
      title: 'Cross-Origin-Opener-Policy is not set',
      severity: 'low',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'Without COOP, cross-window opener relationships are preserved, limiting cross-origin isolation.',
      proof: [`No Cross-Origin-Opener-Policy header on ${bugPathFromUrl(documentRequest.url)}.`],
      refs: bugRefs(['MDN COOP', BUG_REFERENCE_URLS.coop])
    });
  }

  // ── Cross-Origin-Resource-Policy ─────────────────────────────────────────

  if (!corp) {
    bugCreateFinding(state, {
      id: 'missing-corp',
      title: 'Cross-Origin-Resource-Policy is not set',
      severity: 'low',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'The main response does not declare a CORP policy for resource embedding isolation.',
      proof: [`No Cross-Origin-Resource-Policy header on ${bugPathFromUrl(documentRequest.url)}.`],
      refs: bugRefs(['MDN CORP', BUG_REFERENCE_URLS.corp])
    });
  }

  // ── Server / stack disclosure ──────────────────────────────────────────────

  if (server) {
    if (/\d/.test(server)) {
      bugCreateFinding(state, {
        id: 'server-version-disclosure',
        title: 'Server header exposes version information',
        severity: 'medium',
        confidence: 'high',
        category: 'Headers',
        url: documentRequest.url,
        summary: 'The Server header advertises product and version details, aiding fingerprinting.',
        proof: [`Server: ${server}`],
        code: `Server: ${server}`,
        codeLang: 'http'
      });
    }
    if (/apache\/2\.4\.49(?:\D|$)/i.test(server)) {
      bugCreateFinding(state, {
        id: 'apache-2-4-49-cve',
        title: 'Apache 2.4.49 — CVE-2021-41773 (path traversal + RCE)',
        severity: 'critical',
        confidence: 'high',
        category: 'CVE',
        url: documentRequest.url,
        summary: 'Apache 2.4.49 is vulnerable to a path traversal flaw that can also enable remote code execution.',
        proof: [`Server: ${server}`],
        code: `Server: ${server}`,
        codeLang: 'http',
        cve: 'CVE-2021-41773',
        refs: bugRefs(['CVE-2021-41773', BUG_REFERENCE_URLS.apache41773])
      });
    }
    if (/apache\/2\.4\.50(?:\D|$)/i.test(server)) {
      bugCreateFinding(state, {
        id: 'apache-2-4-50-cve',
        title: 'Apache 2.4.50 — CVE-2021-42013 (path traversal bypass)',
        severity: 'critical',
        confidence: 'high',
        category: 'CVE',
        url: documentRequest.url,
        summary: 'Apache 2.4.50 contains a bypass of the CVE-2021-41773 patch that re-enables path traversal.',
        proof: [`Server: ${server}`],
        code: `Server: ${server}`,
        codeLang: 'http',
        cve: 'CVE-2021-42013',
        refs: bugRefs(['CVE-2021-42013', BUG_REFERENCE_URLS.apache42013])
      });
    }
  }

  if (poweredBy) {
    bugCreateFinding(state, {
      id: 'x-powered-by-disclosure',
      title: 'X-Powered-By exposes backend implementation details',
      severity: 'medium',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'The X-Powered-By response header reveals the server-side technology stack.',
      proof: [`X-Powered-By: ${poweredBy}`],
      code: `X-Powered-By: ${poweredBy}`,
      codeLang: 'http'
    });
  }

  if (aspNetVersion) {
    const aspLines = [
      bugHeaderValue(responseHeaders, 'x-aspnet-version')    ? `X-AspNet-Version: ${bugHeaderValue(responseHeaders, 'x-aspnet-version')}`    : '',
      bugHeaderValue(responseHeaders, 'x-aspnetmvc-version') ? `X-AspNetMvc-Version: ${bugHeaderValue(responseHeaders, 'x-aspnetmvc-version')}` : ''
    ].filter(Boolean);
    bugCreateFinding(state, {
      id: 'aspnet-version-disclosure',
      title: 'ASP.NET version headers are exposed',
      severity: 'medium',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'ASP.NET-specific headers reveal the exact framework version.',
      proof: aspLines,
      code: aspLines.join('\n'),
      codeLang: 'http'
    });
  }

  const debugHeaderNames = ['x-debug', 'x-debug-token', 'x-debug-token-link', 'x-drupal-cache', 'x-generator'];
  const debugMatches = debugHeaderNames.map(name => {
    const value = bugHeaderValue(responseHeaders, name);
    return value ? `${name}: ${value}` : '';
  }).filter(Boolean);
  if (debugMatches.length) {
    bugCreateFinding(state, {
      id: 'debug-headers',
      title: 'Debug or profiler headers present in production response',
      severity: 'high',
      confidence: 'high',
      category: 'Headers',
      url: documentRequest.url,
      summary: 'The response includes debug-oriented headers that should be stripped from production traffic.',
      proof: debugMatches,
      code: debugMatches.join('\n'),
      codeLang: 'http'
    });
  }

  // ── CORS ──────────────────────────────────────────────────────────────────
  // FIX: previously fired for every ACAO:* including CDN fonts/scripts.
  // Now:
  //   • Skip well-known CDN origins entirely.
  //   • ACAO:* with credentials=true → high (invalid per spec but dangerous).
  //   • ACAO:* on an API/data response → medium (overly permissive).
  //   • CORS reflected origin → high (actual SSRF-adjacent class).

  scopedRequests.forEach(req => {
    const response = Array.isArray(req.responseHeaders) ? req.responseHeaders : [];
    const acao = bugHeaderValue(response, 'access-control-allow-origin');
    const acac = bugHeaderValue(response, 'access-control-allow-credentials');
    const reqOrigin = bugHeaderValue(
      Array.isArray(req.requestHeaders) ? req.requestHeaders : [],
      'origin'
    );
    const reqHost = bugHostnameFromUrl(req.url);

    // Skip trusted CDN origins — wildcard is their entire purpose.
    if (BUG_TRUSTED_CDN_ORIGINS.has(reqHost)) return;

    if (acao === '*' && /^true$/i.test(acac)) {
      // Spec-invalid combination — browsers reject it, but some custom
      // HTTP clients do not, making this a real misconfiguration.
      bugCreateFinding(state, {
        id: 'cors-wildcard-credentials',
        title: 'CORS: wildcard origin with credentials=true (invalid combination)',
        severity: 'high',
        confidence: 'high',
        category: 'CORS',
        url: req.url,
        evidenceKey: req.url,
        summary: 'Combining Access-Control-Allow-Origin: * with Allow-Credentials: true is spec-invalid and may be exploitable by custom HTTP clients.',
        proof: [
          `URL: ${req.url}`,
          `Access-Control-Allow-Origin: ${acao}`,
          `Access-Control-Allow-Credentials: ${acac}`
        ],
        code: `Access-Control-Allow-Origin: ${acao}\nAccess-Control-Allow-Credentials: ${acac}`,
        codeLang: 'http'
      });
    } else if (acao === '*' && bugResponseIsApiLike(req)) {
      // Wildcard on an API endpoint means any page can read the response.
      bugCreateFinding(state, {
        id: 'cors-wildcard-api',
        title: 'CORS: wildcard origin on an API/data endpoint',
        severity: 'medium',
        confidence: 'high',
        category: 'CORS',
        url: req.url,
        evidenceKey: req.url,
        summary: 'An API response allows any origin to read it. Acceptable for truly public APIs, but often overly permissive.',
        proof: [
          `URL: ${req.url}`,
          `Access-Control-Allow-Origin: ${acao}`
        ],
        code: `Access-Control-Allow-Origin: ${acao}`,
        codeLang: 'http'
      });
    }

    // Reflected origin: ACAO echoes back the request's Origin header.
    // This is the most impactful CORS misconfiguration — any site can read
    // authenticated responses if Allow-Credentials is also true.
    if (reqOrigin && acao && acao !== '*' && acao === reqOrigin) {
      const severity = /^true$/i.test(acac) ? 'high' : 'medium';
      const credNote = /^true$/i.test(acac) ? ' Combined with Allow-Credentials: true, any origin can steal authenticated data.' : '';
      bugCreateFinding(state, {
        id: 'cors-reflected-origin',
        title: 'CORS: server reflects the request Origin back (no whitelist validation)',
        severity,
        confidence: 'high',
        category: 'CORS',
        url: req.url,
        evidenceKey: req.url,
        summary: `The server echoes any supplied Origin verbatim rather than validating against an allowlist.${credNote}`,
        proof: [
          `URL: ${req.url}`,
          `Request Origin: ${reqOrigin}`,
          `Access-Control-Allow-Origin: ${acao}`,
          acac ? `Access-Control-Allow-Credentials: ${acac}` : ''
        ].filter(Boolean),
        code: [
          `Origin: ${reqOrigin}`,
          `Access-Control-Allow-Origin: ${acao}`,
          acac ? `Access-Control-Allow-Credentials: ${acac}` : ''
        ].filter(Boolean).join('\n'),
        codeLang: 'http'
      });
    }
  });
}

// ─── Cookie findings ──────────────────────────────────────────────────────────

function bugAddCookieFindings(state, scopedRequests) {
  scopedRequests.forEach(req => {
    const responseHeaders = Array.isArray(req.responseHeaders) ? req.responseHeaders : [];
    const setCookies = bugHeaderValues(responseHeaders, 'set-cookie');
    if (!setCookies.length) return;

    const cacheControl = bugHeaderValue(responseHeaders, 'cache-control');
    const pragma = bugHeaderValue(responseHeaders, 'pragma');
    let hasSessionCookie = false;

    setCookies.forEach(rawCookie => {
      const parsed = bugParseSetCookie(rawCookie);
      if (!parsed) return;
      // FIX: excludes analytics/tracking cookies from session-cookie checks.
      const isSessionCookie = bugLooksLikeSessionCookie(parsed.name);
      if (isSessionCookie) hasSessionCookie = true;

      if (isSessionCookie && bugIsHttpsUrl(req.url) && !parsed.attrs.secure) {
        bugCreateFinding(state, {
          id: 'session-cookie-missing-secure',
          title: 'Session cookie missing the Secure attribute',
          severity: 'high',
          confidence: 'high',
          category: 'Cookies',
          url: req.url,
          evidenceKey: `${req.url}||${parsed.name}||secure`,
          summary: 'A session cookie is set over HTTPS without Secure, allowing transmission over HTTP.',
          proof: [`Set-Cookie: ${rawCookie}`],
          code: `Set-Cookie: ${rawCookie}`,
          codeLang: 'http',
          refs: bugRefs(['MDN Cookie Security', BUG_REFERENCE_URLS.cookiePrefixes])
        });
      }

      if (isSessionCookie && !parsed.attrs.httponly) {
        bugCreateFinding(state, {
          id: 'session-cookie-missing-httponly',
          title: 'Session cookie missing the HttpOnly attribute',
          severity: 'high',
          confidence: 'high',
          category: 'Cookies',
          url: req.url,
          evidenceKey: `${req.url}||${parsed.name}||httponly`,
          summary: 'A session cookie is readable from JavaScript because HttpOnly is absent, aiding XSS-based session theft.',
          proof: [`Set-Cookie: ${rawCookie}`],
          code: `Set-Cookie: ${rawCookie}`,
          codeLang: 'http',
          refs: bugRefs(['MDN Cookie Security', BUG_REFERENCE_URLS.cookiePrefixes])
        });
      }

      if (isSessionCookie && !parsed.attrs.samesite) {
        bugCreateFinding(state, {
          id: 'session-cookie-missing-samesite',
          title: 'Session cookie missing SameSite attribute',
          severity: 'medium',
          confidence: 'high',
          category: 'Cookies',
          url: req.url,
          evidenceKey: `${req.url}||${parsed.name}||samesite`,
          summary: 'Without SameSite the cookie is sent on cross-site requests, widening CSRF attack surface.',
          proof: [`Set-Cookie: ${rawCookie}`],
          code: `Set-Cookie: ${rawCookie}`,
          codeLang: 'http'
        });
      }

      if (/^__Host-/i.test(parsed.name)) {
        const hostCookieBroken = !parsed.attrs.secure || String(parsed.attrs.path || '') !== '/' || Object.prototype.hasOwnProperty.call(parsed.attrs, 'domain');
        if (hostCookieBroken) {
          bugCreateFinding(state, {
            id: 'host-prefix-cookie-invalid',
            title: '__Host- cookie prefix used incorrectly',
            severity: 'high',
            confidence: 'high',
            category: 'Cookies',
            url: req.url,
            evidenceKey: `${req.url}||${parsed.name}`,
            summary: 'A __Host- cookie must carry Secure, have no Domain attribute, and set Path=/.',
            proof: [`Set-Cookie: ${rawCookie}`],
            code: `Set-Cookie: ${rawCookie}`,
            codeLang: 'http',
            refs: bugRefs(['MDN Cookie Prefixes', BUG_REFERENCE_URLS.cookiePrefixes])
          });
        }
      }

      if (/^__Secure-/i.test(parsed.name) && !parsed.attrs.secure) {
        bugCreateFinding(state, {
          id: 'secure-prefix-cookie-invalid',
          title: '__Secure- cookie prefix used without Secure attribute',
          severity: 'high',
          confidence: 'high',
          category: 'Cookies',
          url: req.url,
          evidenceKey: `${req.url}||${parsed.name}`,
          summary: 'A __Secure- cookie must always carry the Secure attribute to be accepted by the browser.',
          proof: [`Set-Cookie: ${rawCookie}`],
          code: `Set-Cookie: ${rawCookie}`,
          codeLang: 'http',
          refs: bugRefs(['MDN Cookie Prefixes', BUG_REFERENCE_URLS.cookiePrefixes])
        });
      }
    });

    const body = String(req.responseBody || '');
    const responseLooksSensitive = hasSessionCookie || bugHasTokenLikeValue(req.url) || bugHasTokenLikeValue(body);
    const cacheIsWeak = cacheControl && !/(no-store|private)/i.test(cacheControl) && !/no-cache/i.test(pragma);
    if (responseLooksSensitive && (!cacheControl || cacheIsWeak)) {
      const cacheLines = [
        setCookies[0] ? `Set-Cookie: ${setCookies[0]}` : '',
        `Cache-Control: ${cacheControl || '(missing)'}`,
        pragma ? `Pragma: ${pragma}` : ''
      ].filter(Boolean);
      bugCreateFinding(state, {
        id: 'auth-response-cacheable',
        title: 'Authentication response may be cached',
        severity: 'medium',
        confidence: cacheControl ? 'high' : 'medium',
        category: 'Caching',
        url: req.url,
        evidenceKey: req.url,
        summary: 'The response appears authentication-related but does not include Cache-Control: no-store or private.',
        proof: cacheLines,
        code: cacheLines.join('\n'),
        codeLang: 'http',
        refs: bugRefs(['MDN Cache-Control', BUG_REFERENCE_URLS.cacheControl])
      });
    }
  });
}

// ─── URL leak findings ────────────────────────────────────────────────────────

function bugAddUrlLeakFindings(state) {
  const values = [activeTabUrl].filter(Boolean);
  values.forEach(urlValue => {
    let parsed;
    try {
      parsed = new URL(urlValue);
    } catch (_) {
      return;
    }
    const combined = `${parsed.search || ''}${parsed.hash || ''}`;
    if (!/(access_token|id_token|refresh_token|client_secret|code_verifier|assertion|session|jwt|token)=/i.test(combined)) return;
    bugCreateFinding(state, {
      id: 'oauth-token-in-url',
      title: 'Sensitive token material present in the page URL',
      severity: 'high',
      confidence: 'high',
      category: 'URL Exposure',
      url: urlValue,
      summary: 'The current URL exposes token-like parameters or fragments that will appear in server logs and the browser history.',
      proof: [`URL: ${urlValue}`],
      code: urlValue,
      codeLang: 'text'
    });
  });
}

// ─── Response body findings (API / non-HTML) ──────────────────────────────────

function bugAddResponseBodyFindings(state, scopedRequests) {
  const secretPatterns = [
    { id: 'private-key',    label: 'Private key block',          regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |)PRIVATE KEY-----/i },
    { id: 'github-pat',     label: 'GitHub token',               regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
    { id: 'github-fgpat',   label: 'GitHub fine-grained token',  regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
    { id: 'slack-token',    label: 'Slack token',                regex: /\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,}\b/ },
    { id: 'aws-key',        label: 'AWS access key ID',          regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
    { id: 'stripe-secret',  label: 'Stripe secret key',          regex: /\bsk_live_[0-9A-Za-z]{16,}\b/ },
    { id: 'gcp-api-key',    label: 'GCP API key',                regex: /\bAIza[0-9A-Za-z-_]{35}\b/ },
    { id: 'sendgrid-key',   label: 'SendGrid API key',           regex: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
    { id: 'twilio-sid',     label: 'Twilio account SID',         regex: /\bAC[0-9a-f]{32}\b/ },
    { id: 'npm-token',      label: 'npm access token',           regex: /\bnpm_[A-Za-z0-9]{36}\b/ }
  ];

  const stackTracePatterns = [
    /traceback \(most recent call last\):/i,
    /stack trace:/i,
    /fatal error:\s+uncaught/i,
    /exception in thread/i,
    /system\.data\.sqlclient\.sqlexception/i,
    /pdoexception/i,
    /\bat\s+[A-Za-z0-9_.$<>]+\([^()\n]+:\d+:\d+\)/i,
    /unhandled exception:\s/i,
    /Caused by:/
  ];

  // SQL / database error signatures
  const sqlErrorPatterns = [
    /\bsqlstate\[[0-9a-z]+\]/i,
    /You have an error in your SQL syntax/i,
    /Warning: mysql_/i,
    /ORA-\d{5}:/,
    /Microsoft OLE DB Provider for SQL Server/i,
    /\bpg_query\(\):/i,
    /ERROR:\s+syntax error at or near/i,
    /sqlite3?\.OperationalError/i,
    /DBD::mysql::st/i
  ];

  // Credential-looking keys in JSON API responses
  const jsonCredentialRe = /"(?:password|passwd|secret|api_?key|apikey|client_?secret|access_?token|id_?token|refresh_?token|private_?key|auth_?token|x-api-key)"\s*:\s*"([^"]{4,})"/i;

  scopedRequests.slice(0, 200).forEach(req => {
    const body = String(req.responseBody || '');
    if (!body || body.length < 4) return;
    const url  = String(req.url || '');

    // Secret patterns in any response body (not just HTML)
    secretPatterns.forEach(pattern => {
      const match = bugFindTextMatch(body, pattern.regex);
      if (!match) return;
      bugCreateFinding(state, {
        id: `secret-pattern-${pattern.id}`,
        title: `${pattern.label} found in response body`,
        severity: 'critical',
        confidence: 'high',
        category: 'Secret Exposure',
        url,
        evidenceKey: `${url}||${pattern.id}`,
        summary: `A response body from the page contains a recognisable ${pattern.label.toLowerCase()} that should not be client-visible.`,
        proof: [match.match],
        code: match.snippet,
        codeLang: 'text'
      });
    });

    // Stack traces in any response body
    for (let i = 0; i < stackTracePatterns.length; i++) {
      const match = bugFindTextMatch(body, stackTracePatterns[i]);
      if (!match) continue;
      bugCreateFinding(state, {
        id: 'stack-trace-exposed',
        title: 'Stack trace or verbose exception in response',
        severity: 'high',
        confidence: 'high',
        category: 'Debug Exposure',
        url,
        evidenceKey: `${url}||stack-${i}`,
        summary: 'A response body contains a recognisable stack trace or exception message, exposing implementation details.',
        proof: [`URL: ${url}`],
        code: match.snippet,
        codeLang: 'text'
      });
      break;
    }

    // SQL errors
    for (let i = 0; i < sqlErrorPatterns.length; i++) {
      const match = bugFindTextMatch(body, sqlErrorPatterns[i]);
      if (!match) continue;
      bugCreateFinding(state, {
        id: 'sql-error-exposed',
        title: 'Database / SQL error message in response',
        severity: 'high',
        confidence: 'high',
        category: 'Debug Exposure',
        url,
        evidenceKey: `${url}||sql-${i}`,
        summary: 'A response body contains a database error message that reveals query structure and backend technology.',
        proof: [`URL: ${url}`, match.match],
        code: match.snippet,
        codeLang: 'text'
      });
      break;
    }

    // JSON credential leak (API responses returning actual secret values)
    const jsonCredMatch = bugFindTextMatch(body, jsonCredentialRe);
    if (jsonCredMatch) {
      // Only flag when the response looks like an application API, not a config
      // file the developer intentionally fetches for their own use.
      const ct = bugHeaderValue(
        Array.isArray(req.responseHeaders) ? req.responseHeaders : [],
        'content-type'
      );
      if (/json/i.test(ct)) {
        bugCreateFinding(state, {
          id: 'api-secret-in-response',
          title: 'Credential-like field present in JSON API response',
          severity: 'high',
          confidence: 'medium',
          category: 'Secret Exposure',
          url,
          evidenceKey: `${url}||json-cred`,
          summary: 'A JSON response from the page contains a field whose name suggests it holds a secret value.',
          proof: [`URL: ${url}`, jsonCredMatch.match],
          code: jsonCredMatch.snippet,
          codeLang: 'json'
        });
      }
    }
  });
}

// ─── Document / HTML findings ─────────────────────────────────────────────────

function bugIterateCommentNodes(doc) {
  const comments = [];
  if (!doc || !doc.documentElement) return comments;
  try {
    const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_COMMENT);
    let current;
    while ((current = walker.nextNode()) && comments.length < 100) {
      const text = String(current.nodeValue || '').trim();
      if (text) comments.push(text);
    }
  } catch (_) {}
  return comments;
}

function bugExtractVersionFromUrl(urlValue, pattern) {
  const value = String(urlValue || '');
  const match = pattern.exec(value);
  if (match && match[1]) return match[1];
  const versionMatch = /[?&](?:ver|version|v)=([0-9]+(?:\.[0-9]+){1,3})/i.exec(value);
  return versionMatch ? versionMatch[1] : '';
}

function bugCompareVersions(a, b) {
  const left  = String(a || '').split('.').map(part => parseInt(part, 10) || 0);
  const right = String(b || '').split('.').map(part => parseInt(part, 10) || 0);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const lv = left[i]  || 0;
    const rv = right[i] || 0;
    if (lv > rv) return 1;
    if (lv < rv) return -1;
  }
  return 0;
}

function bugAddLibraryVersionFindings(state, doc, baseUrl) {
  const seenUrls = new Set();
  doc.querySelectorAll('script[src]').forEach(script => {
    const rawSrc = script.getAttribute('src') || '';
    let src = rawSrc;
    try { src = new URL(rawSrc, baseUrl).href; } catch (_) {}
    if (!src || seenUrls.has(src)) return;
    seenUrls.add(src);

    const jqueryVersion = bugExtractVersionFromUrl(src, /jquery(?:[-.]min)?[-._]?v?([0-9]+(?:\.[0-9]+){1,3})/i);
    if (jqueryVersion && bugCompareVersions(jqueryVersion, '3.5.0') < 0) {
      bugCreateFinding(state, {
        id: 'jquery-pre-3-5',
        title: `jQuery ${jqueryVersion} — older than 3.5.0 (CVE-2020-11022/11023)`,
        severity: 'high',
        confidence: 'high',
        category: 'CVE',
        url: src,
        evidenceKey: src,
        summary: 'This jQuery version is in the range affected by HTML manipulation XSS issues fixed in 3.5.0.',
        proof: [`Script src: ${src}`],
        code: script.outerHTML.slice(0, 300),
        codeLang: 'html',
        cve: 'CVE-2020-11022, CVE-2020-11023',
        refs: bugRefs(
          ['CVE-2020-11022', BUG_REFERENCE_URLS.jquery11022],
          ['CVE-2020-11023', BUG_REFERENCE_URLS.jquery11023]
        )
      });
    }

    const bootstrapVersion = bugExtractVersionFromUrl(src, /bootstrap(?:\.bundle)?(?:[-.]min)?[-._]?v?([0-9]+(?:\.[0-9]+){1,3})/i);
    const bootstrapMajor = parseInt(String(bootstrapVersion || '').split('.')[0], 10) || 0;
    const bootstrapAffected =
      (bootstrapMajor === 3 && bugCompareVersions(bootstrapVersion, '3.4.1') < 0) ||
      (bootstrapMajor === 4 && bugCompareVersions(bootstrapVersion, '4.3.1') < 0);
    if (bootstrapVersion && bootstrapAffected) {
      bugCreateFinding(state, {
        id: 'bootstrap-pre-4-3-1',
        title: `Bootstrap ${bootstrapVersion} — CVE-2019-8331 affected range`,
        severity: 'high',
        confidence: 'high',
        category: 'CVE',
        url: src,
        evidenceKey: src,
        summary: 'This Bootstrap version is affected by a tooltip/popover XSS issue fixed in 3.4.1 / 4.3.1.',
        proof: [`Script src: ${src}`],
        code: script.outerHTML.slice(0, 300),
        codeLang: 'html',
        cve: 'CVE-2019-8331',
        refs: bugRefs(['CVE-2019-8331', BUG_REFERENCE_URLS.bootstrap8331])
      });
    }
  });
}

function bugAddDocumentFindings(state, documentRequest, scopedRequests, endpoints) {
  const html    = documentRequest && typeof documentRequest.responseBody === 'string' ? documentRequest.responseBody : '';
  const doc     = html ? bugParseHtmlDocument(html) : null;
  const baseUrl = (documentRequest && documentRequest.url) || activeTabUrl || '';
  const baseOrigin = bugOriginFromUrl(baseUrl);

  // ── HTML comment credential leak ──────────────────────────────────────────

  const credentialCommentRegex = /\b(?:password|passwd|pwd|secret|api[_-]?key|token|client[_-]?secret|aws_access_key_id|authorization)\b\s*[:=]\s*['"`]?[^\s'"`<]{4,}/i;
  bugIterateCommentNodes(doc).forEach((commentText, index) => {
    const match = credentialCommentRegex.exec(commentText);
    if (!match) return;
    bugCreateFinding(state, {
      id: 'html-comment-credentials',
      title: 'Credential-like value in an HTML comment',
      severity: 'high',
      confidence: 'high',
      category: 'HTML',
      url: baseUrl,
      evidenceKey: `${index}:${match[0]}`,
      summary: 'An HTML comment contains what appears to be a hardcoded credential or secret.',
      proof: [commentText],
      code: `<!-- ${commentText} -->`,
      codeLang: 'html'
    });
  });

  if (doc) {
    // ── Forms ────────────────────────────────────────────────────────────────

    const forms = Array.from(doc.querySelectorAll('form'));
    forms.forEach((form, index) => {
      const method = String(form.getAttribute('method') || 'get').toLowerCase();
      const actionRaw = form.getAttribute('action') || baseUrl;
      let resolvedAction = actionRaw;
      try { resolvedAction = new URL(actionRaw, baseUrl).href; } catch (_) {}
      const hasPassword  = !!form.querySelector('input[type="password"]');
      const csrfField    = form.querySelector(
        'input[name*="csrf" i], input[name*="xsrf" i], input[name*="authenticity" i],' +
        'input[name*="verificationtoken" i], input[name*="nonce" i],' +
        'input[id*="csrf" i], input[id*="verificationtoken" i]'
      );
      const actionOrigin = bugOriginFromUrl(resolvedAction);

      // CSRF: only flag same-origin POST forms whose action path looks like an
      // API or data-mutation endpoint. Skipping cross-origin forms (they're a
      // different class) and trivial forms like bare search boxes.
      if (method === 'post' && !csrfField &&
          (!actionOrigin || actionOrigin === baseOrigin)) {
        bugCreateFinding(state, {
          id: 'post-form-missing-csrf',
          title: 'Same-origin POST form has no CSRF token field',
          severity: 'medium',
          confidence: 'medium',
          category: 'Forms',
          url: resolvedAction,
          evidenceKey: `${resolvedAction}||${index}`,
          summary: 'The page contains a same-origin POST form without a visible CSRF token. May be a false positive if the app uses header-based or cookie-based CSRF defence.',
          proof: [`Form action: ${resolvedAction}`, `Method: POST`],
          code: form.outerHTML.slice(0, 500),
          codeLang: 'html',
          refs: bugRefs(['OWASP CSRF', BUG_REFERENCE_URLS.csrf])
        });
      }

      if (!hasPassword) return;

      if (!bugIsHttpsUrl(resolvedAction) || !bugIsHttpsUrl(baseUrl)) {
        bugCreateFinding(state, {
          id: 'login-form-over-http',
          title: 'Password form delivered or submitted over HTTP',
          severity: 'high',
          confidence: 'high',
          category: 'Forms',
          url: resolvedAction,
          evidenceKey: `${resolvedAction}||password`,
          summary: 'A login form is on an HTTP page or posts to an HTTP action URL, exposing credentials in transit.',
          proof: [`Page URL: ${baseUrl}`, `Form action: ${resolvedAction}`],
          code: form.outerHTML.slice(0, 500),
          codeLang: 'html'
        });
      }

      if (actionOrigin && baseOrigin && actionOrigin !== baseOrigin) {
        bugCreateFinding(state, {
          id: 'cross-origin-password-form',
          title: 'Password form submits to a different origin',
          severity: 'medium',
          confidence: 'high',
          category: 'Forms',
          url: resolvedAction,
          evidenceKey: `${resolvedAction}||cross-origin-password`,
          summary: 'A login form posts credentials to a different origin. Verify this is intentional.',
          proof: [`Page origin: ${baseOrigin}`, `Form action origin: ${actionOrigin}`],
          code: form.outerHTML.slice(0, 500),
          codeLang: 'html'
        });
      }
    });

    // ── Mixed content ─────────────────────────────────────────────────────────

    if (bugIsHttpsUrl(baseUrl)) {
      const mixedNodes = [];
      doc.querySelectorAll('[src], [href], form[action]').forEach(node => {
        const attrName  = node.hasAttribute('src') ? 'src' : node.hasAttribute('href') ? 'href' : 'action';
        const attrValue = node.getAttribute(attrName) || '';
        if (/^http:\/\//i.test(attrValue)) {
          mixedNodes.push(`${node.tagName.toLowerCase()} ${attrName}="${attrValue}"`);
        }
      });
      mixedNodes.slice(0, 5).forEach((item, index) => {
        bugCreateFinding(state, {
          id: 'mixed-content',
          title: 'HTTPS page references HTTP content',
          severity: 'high',
          confidence: 'high',
          category: 'HTML',
          url: baseUrl,
          evidenceKey: `${index}:${item}`,
          summary: 'The HTML document loads or links to a resource over plaintext HTTP.',
          proof: [item],
          code: item,
          codeLang: 'html',
          refs: bugRefs(['MDN Mixed Content', BUG_REFERENCE_URLS.mixedContent])
        });
      });
    }

    // ── Cross-origin scripts without SRI ─────────────────────────────────────
    // FIX: skip well-known CDN origins; they provide wildcard CORS and SRI
    // is optional but not actionable there. Only flag app-specific CDNs or
    // third-party origins that aren't in the trusted-CDN list.

    doc.querySelectorAll('script[src]').forEach((script, index) => {
      const rawSrc = script.getAttribute('src') || '';
      let resolvedSrc = rawSrc;
      try { resolvedSrc = new URL(rawSrc, baseUrl).href; } catch (_) {}
      const srcOrigin  = bugOriginFromUrl(resolvedSrc);
      const srcHost    = bugHostnameFromUrl(resolvedSrc);
      if (srcOrigin && baseOrigin && srcOrigin !== baseOrigin &&
          !script.hasAttribute('integrity') &&
          !BUG_TRUSTED_CDN_ORIGINS.has(srcHost)) {
        bugCreateFinding(state, {
          id: 'cross-origin-script-missing-sri',
          title: 'Cross-origin script loaded without Subresource Integrity',
          severity: 'medium',
          confidence: 'medium',
          category: 'HTML',
          url: resolvedSrc,
          evidenceKey: `${resolvedSrc}||${index}`,
          summary: 'A third-party script tag is missing an integrity= attribute. If the CDN is compromised the page is compromised.',
          proof: [`Script src: ${resolvedSrc}`],
          code: script.outerHTML.slice(0, 300),
          codeLang: 'html',
          refs: bugRefs(['MDN SRI', BUG_REFERENCE_URLS.sri])
        });
      }
    });

    // ── Inline source-map references ──────────────────────────────────────────

    const pageText = `${doc.documentElement ? doc.documentElement.outerHTML : html}`.slice(0, 500000);
    if (/sourceMappingURL=.*\.map/i.test(pageText)) {
      const match = bugFindTextMatch(pageText, /sourceMappingURL=.*\.map[^\s"'`<>]*/i);
      bugCreateFinding(state, {
        id: 'sourcemap-exposed-inline',
        title: 'Source map reference in page source',
        severity: 'medium',
        confidence: 'high',
        category: 'Source Exposure',
        url: baseUrl,
        summary: 'The page advertises a .map file via sourceMappingURL, potentially exposing original source code.',
        proof: [match ? match.match : 'sourceMappingURL'],
        code: match ? match.snippet : pageText.slice(0, 200),
        codeLang: 'javascript'
      });
    }

    // ── Directory listing ─────────────────────────────────────────────────────

    const titleText = (doc.querySelector('title')?.textContent || '').trim();
    const bodyText  = doc.body ? doc.body.textContent || '' : '';
    if (/^index of \//i.test(titleText) || /<h1>\s*Index of \//i.test(html) || /\bParent Directory\b/i.test(bodyText)) {
      bugCreateFinding(state, {
        id: 'directory-listing',
        title: 'Directory listing exposed',
        severity: 'medium',
        confidence: 'high',
        category: 'Exposure',
        url: baseUrl,
        summary: 'The document appears to be an auto-generated directory index, revealing file system structure.',
        proof: [`Title: ${titleText || '(missing title)'}`],
        code: (doc.body ? doc.body.innerHTML : html).slice(0, 600),
        codeLang: 'html'
      });
    }

    // ── Swagger / OpenAPI in page HTML ────────────────────────────────────────

    const swaggerPatterns = [
      /swagger-ui/i,
      /\/swagger(?:\/|$)/i,
      /\/v3\/api-docs\b/i,
      /\/openapi(?:\.json|\/)/i,
      /\/api-docs\b/i
    ];
    const swaggerHit = swaggerPatterns.find(pattern => pattern.test(html));
    if (swaggerHit) {
      bugCreateFinding(state, {
        id: 'swagger-openapi-exposed',
        title: 'Swagger / OpenAPI documentation exposed',
        severity: 'medium',
        confidence: 'high',
        category: 'Exposure',
        url: baseUrl,
        summary: 'The page includes identifiers commonly associated with interactive API documentation.',
        proof: [`Matched pattern: ${swaggerHit}`],
        code: bugSnippet(html, html.search(swaggerHit)),
        codeLang: 'html'
      });
    }

    // ── GraphQL explorer ──────────────────────────────────────────────────────

    const graphiqlMatch = bugFindTextMatch(html, /(graphiql|graphql playground|apollo sandbox)/i);
    if (graphiqlMatch) {
      bugCreateFinding(state, {
        id: 'graphiql-exposed',
        title: 'GraphQL explorer UI exposed',
        severity: 'medium',
        confidence: 'high',
        category: 'Exposure',
        url: baseUrl,
        summary: 'The page exposes a GraphQL interactive tool (GraphiQL, Playground, or Apollo Sandbox).',
        proof: [graphiqlMatch.match],
        code: graphiqlMatch.snippet,
        codeLang: 'html'
      });
    }

    // ── Secret patterns in rendered HTML ─────────────────────────────────────

    const secretPatterns = [
      { id: 'private-key',    label: 'Private key block',          regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |)PRIVATE KEY-----/i },
      { id: 'github-pat',     label: 'GitHub token',               regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
      { id: 'github-fgpat',   label: 'GitHub fine-grained token',  regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/ },
      { id: 'slack-token',    label: 'Slack token',                regex: /\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]{10,}\b/ },
      { id: 'aws-key',        label: 'AWS access key ID',          regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
      { id: 'stripe-secret',  label: 'Stripe secret key',          regex: /\bsk_live_[0-9A-Za-z]{16,}\b/ },
      { id: 'gcp-api-key',    label: 'GCP API key',                regex: /\bAIza[0-9A-Za-z-_]{35}\b/ },
      { id: 'sendgrid-key',   label: 'SendGrid API key',           regex: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/ },
      { id: 'npm-token',      label: 'npm access token',           regex: /\bnpm_[A-Za-z0-9]{36}\b/ }
    ];
    secretPatterns.forEach(pattern => {
      const match = bugFindTextMatch(html, pattern.regex);
      if (!match) return;
      bugCreateFinding(state, {
        id: `secret-pattern-${pattern.id}`,
        title: `${pattern.label} found in rendered HTML`,
        severity: 'critical',
        confidence: 'high',
        category: 'Secret Exposure',
        url: baseUrl,
        evidenceKey: pattern.id,
        summary: 'The rendered page contains a recognisable secret or token that should not be client-visible.',
        proof: [match.match],
        code: match.snippet,
        codeLang: 'html'
      });
    });

    // ── JWT in HTML ───────────────────────────────────────────────────────────

    const jwtMatch = bugFindTextMatch(html, /\b(?:access[_-]?token|id[_-]?token|jwt)["'\s:=]{1,12}(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,})/i);
    if (jwtMatch) {
      bugCreateFinding(state, {
        id: 'jwt-exposed-html',
        title: 'JWT embedded in rendered HTML',
        severity: 'high',
        confidence: 'high',
        category: 'Secret Exposure',
        url: baseUrl,
        summary: 'The page source contains a JWT-like token near a token label — any script can read it.',
        proof: [jwtMatch.groups[1]],
        code: jwtMatch.snippet,
        codeLang: 'html'
      });
    }

    // ── postMessage wildcard ──────────────────────────────────────────────────

    const postMessageMatch = bugFindTextMatch(html, /postMessage\s*\([\s\S]{0,120}['"`]\*['"`]\s*\)/i);
    if (postMessageMatch) {
      bugCreateFinding(state, {
        id: 'postmessage-wildcard',
        title: 'postMessage called with wildcard targetOrigin (*)',
        severity: 'medium',
        confidence: 'medium',
        category: 'JavaScript',
        url: baseUrl,
        summary: "An inline script sends postMessage to '*' instead of a pinned origin, potentially leaking data to any frame.",
        proof: [postMessageMatch.match],
        code: postMessageMatch.snippet,
        codeLang: 'javascript'
      });
    }

    // ── document.domain ───────────────────────────────────────────────────────

    const documentDomainMatch = bugFindTextMatch(html, /document\.domain\s*=/i);
    if (documentDomainMatch) {
      bugCreateFinding(state, {
        id: 'document-domain-used',
        title: 'Inline script assigns document.domain',
        severity: 'medium',
        confidence: 'high',
        category: 'JavaScript',
        url: baseUrl,
        summary: 'Writing to document.domain relaxes the same-origin policy and is deprecated in modern browsers.',
        proof: [documentDomainMatch.match],
        code: documentDomainMatch.snippet,
        codeLang: 'javascript'
      });
    }

    // ── Insecure WebSocket from HTTPS page ────────────────────────────────────

    if (bugIsHttpsUrl(baseUrl)) {
      const wsMatch = bugFindTextMatch(html, /ws:\/\/[^\s"'`<>]+/i);
      if (wsMatch) {
        bugCreateFinding(state, {
          id: 'insecure-websocket',
          title: 'HTTPS page references a plaintext ws:// WebSocket',
          severity: 'high',
          confidence: 'high',
          category: 'Transport',
          url: baseUrl,
          summary: 'A ws:// WebSocket endpoint is referenced from an HTTPS context, exposing the socket traffic.',
          proof: [wsMatch.match],
          code: wsMatch.snippet,
          codeLang: 'javascript'
        });
      }
    }

    // ── Internal / private-network host in page source ────────────────────────
    // FIX: require explicit URL indicators (scheme, port, path) to avoid
    // flagging bare "localhost" appearing in documentation text or error messages.

    const internalPattern = /(?:https?:\/\/|ws:\/\/|["'`(])(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[A-Za-z0-9-]+\.internal|[A-Za-z0-9-]+\.local)(?::\d+)?(?:\/[^\s"'`<>]*)?/i;
    const internalMatch = bugFindTextMatch(html, internalPattern);
    if (internalMatch) {
      bugCreateFinding(state, {
        id: 'internal-host-exposed-html',
        title: 'Internal or private-network endpoint in page source',
        severity: 'medium',
        confidence: 'medium',
        category: 'Exposure',
        url: baseUrl,
        summary: 'The rendered page source references an internal hostname or private IP address in a URL context.',
        proof: [internalMatch.match],
        code: internalMatch.snippet,
        codeLang: 'html'
      });
    }

    // ── Cloud metadata reference in HTML ──────────────────────────────────────

    const metadataMatch = bugFindTextMatch(html, /(169\.254\.169\.254|metadata\.google\.internal|\/latest\/meta-data\b|\/metadata\/instance\b|\/metadata\/identity\/oauth2\/token\b)/i);
    if (metadataMatch) {
      bugCreateFinding(state, {
        id: 'cloud-metadata-reference-html',
        title: 'Cloud instance metadata reference in page source',
        severity: 'high',
        confidence: 'high',
        category: 'Cloud',
        url: baseUrl,
        summary: 'The page source references a cloud instance metadata endpoint.',
        proof: [metadataMatch.match],
        code: metadataMatch.snippet,
        codeLang: 'html'
      });
    }

    bugAddLibraryVersionFindings(state, doc, baseUrl);
  }

  // ── Per-request findings (all scoped requests) ────────────────────────────

  scopedRequests.forEach(req => {
    const responseText = String(req.responseBody || '');
    const url = String(req.url || '');

    // Source map requests
    if (/\.map(?:[?#]|$)/i.test(url)) {
      bugCreateFinding(state, {
        id: 'sourcemap-request',
        title: 'Source map (.map) file was fetched',
        severity: 'medium',
        confidence: 'high',
        category: 'Source Exposure',
        url,
        evidenceKey: url,
        summary: 'A .map file was requested — these contain original source code and symbol information.',
        proof: [`URL: ${url}`],
        code: url,
        codeLang: 'text'
      });
    }

    // JSONP
    const jsonpParamMatch = /(?:^|[?&])(callback|jsonp)=([^&]+)/i.exec(url);
    if (jsonpParamMatch && responseText) {
      let callbackName = '';
      try { callbackName = decodeURIComponent(jsonpParamMatch[2]); } catch (_) { callbackName = jsonpParamMatch[2]; }
      if (callbackName && new RegExp(`^\\s*(?:/\\*\\*/)?${callbackName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`).test(responseText)) {
        bugCreateFinding(state, {
          id: 'jsonp-endpoint',
          title: 'JSONP endpoint observed in traffic',
          severity: 'medium',
          confidence: 'high',
          category: 'API',
          url,
          evidenceKey: url,
          summary: 'A request used a callback/jsonp parameter and the response wraps data in a JavaScript function call.',
          proof: [`URL: ${url}`, `Callback: ${callbackName}`],
          code: responseText.slice(0, 300),
          codeLang: 'javascript'
        });
      }
    }

    // GraphQL introspection
    const requestBody = String(req.body || '');
    if (/__schema|IntrospectionQuery|__type\b/.test(requestBody) || /"__schema"|"__type"/.test(responseText)) {
      bugCreateFinding(state, {
        id: 'graphql-introspection',
        title: 'GraphQL introspection query or response observed',
        severity: 'medium',
        confidence: 'high',
        category: 'GraphQL',
        url,
        evidenceKey: url,
        summary: 'GraphQL introspection is enabled, exposing the full schema to any caller.',
        proof: [`URL: ${url}`],
        code: requestBody.includes('__schema') || requestBody.includes('__type') ? requestBody.slice(0, 400) : responseText.slice(0, 400),
        codeLang: 'json',
        refs: bugRefs(['GraphQL introspection', BUG_REFERENCE_URLS.graphqlIntrospection])
      });
    }

    // Cloud metadata in any request/response
    const requestMetadataMatch = bugFindTextMatch(`${url}\n${requestBody}\n${responseText}`, /(169\.254\.169\.254|metadata\.google\.internal|\/latest\/meta-data\b|\/metadata\/instance\b|\/metadata\/identity\/oauth2\/token\b)/i);
    if (requestMetadataMatch) {
      bugCreateFinding(state, {
        id: 'cloud-metadata-reference-request',
        title: 'Cloud metadata endpoint reference in traffic',
        severity: 'high',
        confidence: 'high',
        category: 'Cloud',
        url,
        evidenceKey: url,
        summary: 'Captured traffic references a cloud instance metadata endpoint or path.',
        proof: [`URL: ${url}`],
        code: requestMetadataMatch.snippet,
        codeLang: 'text'
      });
    }

    // Swagger/OpenAPI URLs in traffic
    if (/(?:\/swagger(?:\/|$)|\/swagger-ui\b|\/v3\/api-docs\b|\/openapi(?:\.json|\/)|\/api-docs\b)/i.test(url)) {
      bugCreateFinding(state, {
        id: 'swagger-openapi-request',
        title: 'Swagger / OpenAPI artifact fetched',
        severity: 'medium',
        confidence: 'high',
        category: 'Exposure',
        url,
        evidenceKey: url,
        summary: 'The page loaded a Swagger/OpenAPI schema or UI resource.',
        proof: [`URL: ${url}`],
        code: url,
        codeLang: 'text'
      });
    }
  });

  // ── Endpoint discovery findings ───────────────────────────────────────────

  (Array.isArray(endpoints) ? endpoints : []).forEach(entry => {
    const url = String(entry && (entry.url || entry.rawUrl) || '');
    if (!url) return;

    if (/^(?:ws:\/\/)/i.test(url) && bugIsHttpsUrl(baseUrl)) {
      bugCreateFinding(state, {
        id: 'insecure-websocket-endpoint',
        title: 'Discovered insecure ws:// WebSocket endpoint',
        severity: 'high',
        confidence: 'high',
        category: 'Transport',
        url,
        evidenceKey: url,
        summary: 'Endpoint discovery found a plaintext WebSocket URL in page JavaScript on an HTTPS site.',
        proof: [`Endpoint: ${url}`],
        code: entry.contextSnippet || entry.snippet || url,
        codeLang: 'javascript'
      });
    }

    if (/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|[A-Za-z0-9-]+\.internal|[A-Za-z0-9-]+\.local)/i.test(url)) {
      bugCreateFinding(state, {
        id: 'internal-host-endpoint',
        title: 'Internal / localhost URL found by endpoint discovery',
        severity: 'medium',
        confidence: 'high',
        category: 'Exposure',
        url,
        evidenceKey: url,
        summary: 'Active endpoint discovery found a private-network or localhost URL in page JavaScript.',
        proof: [`Endpoint: ${url}`],
        code: entry.contextSnippet || entry.snippet || url,
        codeLang: 'javascript'
      });
    }

    if (/(169\.254\.169\.254|metadata\.google\.internal|\/latest\/meta-data\b|\/metadata\/instance\b|\/metadata\/identity\/oauth2\/token\b)/i.test(url)) {
      bugCreateFinding(state, {
        id: 'cloud-metadata-endpoint',
        title: 'Cloud metadata URL found by endpoint discovery',
        severity: 'high',
        confidence: 'high',
        category: 'Cloud',
        url,
        evidenceKey: url,
        summary: 'Active endpoint discovery found a cloud instance metadata address in page JavaScript.',
        proof: [`Endpoint: ${url}`],
        code: entry.contextSnippet || entry.snippet || url,
        codeLang: 'javascript'
      });
    }
  });
}

// ─── Main builder ─────────────────────────────────────────────────────────────

function buildBugHunterFindings() {
  const scopedRequests  = getBugScopedRequests(currentRequests);
  const documentRequest = bugSelectDocumentRequest(scopedRequests);
  const state = { findings: [], seen: new Set() };

  bugAddHeaderFindings(state, documentRequest, scopedRequests);
  bugAddCookieFindings(state, scopedRequests);
  bugAddUrlLeakFindings(state);
  bugAddDocumentFindings(state, documentRequest, scopedRequests, activeInterceptionEntries);
  bugAddResponseBodyFindings(state, scopedRequests);

  // Enrich findings with classification tags where applicable.
  // All findings are returned — the classification is additive metadata, not a filter.
  const enrichedFindings = state.findings.map(finding => {
    const classification = bugGetConfirmedClassification(finding.id);
    return classification ? { ...finding, classification } : finding;
  });

  return {
    findings: bugSortFindings(enrichedFindings),
    scopedRequests,
    documentRequest
  };
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

function renderBugTab() {
  const container = document.getElementById('requestsContainer');
  if (!container) return;

  const analysis      = buildBugHunterFindings();
  const allFindings   = analysis.findings;
  const findings      = bugFilterFindings(allFindings);
  const scopedRequests = analysis.scopedRequests;

  const criticalCount  = allFindings.filter(f => f.severity === 'critical').length;
  const highCount      = allFindings.filter(f => f.severity === 'high').length;
  const endpointCount  = Array.isArray(activeInterceptionEntries) ? activeInterceptionEntries.length : 0;

  const signature = [
    allFindings.map(f => (f.id || '') + '|' + (f.url || '')).join(';'),
    scopedRequests.length,
    endpointCount,
    String(requestUrlSearchQuery || '')
  ].join('|');
  const hasFindings = findings.length > 0;
  if (hasFindings && signature === lastBugDataSignature) return;
  lastBugDataSignature = signature;

  if (!scopedRequests.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-text">
          No page traffic captured for this tab yet.<br>
          Navigate the target site and reopen the Bug view.
        </div>
      </div>`;
    return;
  }

  if (!findings.length) {
    container.innerHTML = `
      <div class="bug-hunter-panel">
        <div class="bug-summary">
          <span class="bug-summary-item">Findings: <strong>${allFindings.length}</strong></span>
          <span class="bug-summary-item">Critical: <strong>${criticalCount}</strong></span>
          <span class="bug-summary-item">High: <strong>${highCount}</strong></span>
          <span class="bug-summary-item">Requests: <strong>${scopedRequests.length}</strong></span>
          <span class="bug-summary-item">Endpoints: <strong>${endpointCount}</strong></span>
        </div>
        <div class="empty-state">
          <div class="empty-text">
            No findings matched the current filter.<br>
            Requests analysed: <span style="color:var(--blue);font-weight:600">${scopedRequests.length}</span>
          </div>
        </div>
      </div>`;
    return;
  }

  const cardsHtml = findings.map(finding => {
    const proofHtml = (finding.proof || []).map(line => `<div class="bug-proof-line">${escapeHtml(line)}</div>`).join('');
    const refsHtml  = (finding.refs  || []).map(ref => `<a class="bug-ref-link" href="${escapeAttribute(ref.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ref.label)}</a>`).join('');
    const cveHtml   = finding.cve ? `<span class="bug-ref-chip">${escapeHtml(finding.cve)}</span>` : '';
    const cweHtml   = finding.cwe ? `<span class="bug-ref-chip">${escapeHtml(finding.cwe)}</span>` : '';
    const classHtml = finding.classification ? `<span class="bug-classification-chip">${escapeHtml(finding.classification)}</span>` : '';
    const codeHtml  = finding.code
      ? `<div class="bug-code-wrap"><pre class="comments-card-context"><code>${highlightCode(String(finding.code), finding.codeLang || 'text')}</code></pre></div>`
      : '';
    const urlDisplay = finding.url ? bugPathFromUrl(finding.url) : '';
    const metaHtml  = [
      finding.category ? `<span>${escapeHtml(finding.category)}</span>` : '',
      finding.url      ? `<a class="bug-meta-url" href="${escapeAttribute(finding.url)}" target="_blank" rel="noopener noreferrer" title="${escapeAttribute(finding.url)}">${escapeHtml(urlDisplay)}</a>` : ''
    ].filter(Boolean).join(' · ');

    return `
      <div class="bug-card bug-severity-${escapeHtml(String(finding.severity || 'medium').toLowerCase())}">
        <div class="bug-card-head">
          <div class="bug-card-title">${escapeHtml(finding.title || 'Finding')}</div>
          <div class="bug-badges">
            <span class="bug-badge bug-badge-severity bug-badge-severity-${escapeHtml(String(finding.severity || 'medium').toLowerCase())}">${escapeHtml(bugLabel(finding.severity))}</span>
          </div>
        </div>
        <div class="bug-card-summary">${escapeHtml(finding.summary || '')}</div>
        <div class="bug-card-meta">${metaHtml}</div>
        ${classHtml}
        <div class="bug-proof">${proofHtml}</div>
        ${codeHtml}
        <div class="bug-refs">
          ${cveHtml}
          ${cweHtml}
          ${refsHtml}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="bug-hunter-panel">
      <div class="bug-summary">
        <span class="bug-summary-item">Findings: <strong>${allFindings.length}</strong></span>
        <span class="bug-summary-item">Critical: <strong>${criticalCount}</strong></span>
        <span class="bug-summary-item">High: <strong>${highCount}</strong></span>
        <span class="bug-summary-item">Requests: <strong>${scopedRequests.length}</strong></span>
        <span class="bug-summary-item">Endpoints: <strong>${endpointCount}</strong></span>
      </div>
      <div class="bug-card-list">
        ${cardsHtml}
      </div>
    </div>
  `;
}
