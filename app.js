/* Folio Library — vanilla JavaScript. Configure deployment only in config.js. */
'use strict';
// BEGIN SHARED CONVERTER v1.0.0 — byte-identical in Code.gs and app.js.
// Change BOTH copies together; GAS does not provide the browser URL class.
var CONVERTER_VERSION = '1.0.0';
function decodeEntities_(value) {
  return String(value).replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&#(x[0-9a-f]+|\d+);/gi, function (_, n) {
      var code = n.charAt(0).toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
}
function parseHttps_(value) {
  var match = /^https:\/\/([a-z0-9.-]+)(?::443)?([/?#][\s\S]*)?$/i.exec(value);
  if (!match || /[\s\\<>"'\u0000-\u001f\u007f]/.test(value)) throw new Error('Use a complete HTTPS link.');
  var host = match[1].toLowerCase();
  if (host.indexOf('..') >= 0 || host.charAt(0) === '.' || host.slice(-1) === '.') throw new Error('Invalid hostname.');
  var tail = match[2] || '/';
  if (tail.charAt(0) !== '/') tail = '/' + tail;
  var hashAt = tail.indexOf('#');
  var hash = hashAt >= 0 ? tail.slice(hashAt) : '';
  if (hashAt >= 0) tail = tail.slice(0, hashAt);
  var qAt = tail.indexOf('?');
  var path = qAt >= 0 ? tail.slice(0, qAt) : tail;
  var query = qAt >= 0 ? tail.slice(qAt + 1) : '';
  var params = Object.create(null);
  query.split('&').forEach(function (part) {
    if (!part) return;
    var at = part.indexOf('=');
    try {
      var key = decodeURIComponent(at >= 0 ? part.slice(0, at) : part);
      params[key.toLowerCase()] = decodeURIComponent((at >= 0 ? part.slice(at + 1) : '').replace(/\+/g, ' '));
    } catch (_e) { throw new Error('The link contains invalid URL encoding.'); }
  });
  return { host: host, path: path, query: query, hash: hash, params: params, origin: 'https://' + host };
}
function setQuery_(url, changes) {
  var u = parseHttps_(url);
  var p = u.params;
  Object.keys(changes).forEach(function (key) {
    if (changes[key] === null) delete p[key.toLowerCase()];
    else p[key.toLowerCase()] = String(changes[key]);
  });
  var query = Object.keys(p).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); }).join('&');
  return u.origin + u.path + (query ? '?' + query : '') + u.hash;
}
function isHost_(host, root) { return host === root || host.slice(-(root.length + 1)) === '.' + root; }
function convertLink_(input, extraHosts) {
  var text = String(input || '').trim();
  if (!text || text.length > 10000) throw new Error('Paste a link or an iframe embed code (maximum 10,000 characters).');
  if (/<iframe\b/i.test(text)) {
    var iframe = /<iframe\b[^>]*\bsrc\s*=\s*(["'])([\s\S]*?)\1/i.exec(text);
    if (!iframe) throw new Error('The iframe needs a quoted HTTPS src attribute.');
    text = decodeEntities_(iframe[2]).trim();
  } else if (/[<>]/.test(text)) throw new Error('Only links or iframe embed codes are supported.');
  var u = parseHttps_(text);
  var p = u.params;
  var result = { url: text, embedUrl: text, source: '', needsResolve: false, warning: '' };
  var id;
  var m;
  var resource = p.resourcekey ? '?resourcekey=' + encodeURIComponent(p.resourcekey) : '';
  if (u.host === '1drv.ms' || u.host === 'forms.gle') {
    result.source = u.host === '1drv.ms' ? 'OneDrive' : 'Google Forms';
    result.needsResolve = true; result.embedUrl = '';
    result.warning = 'This short link needs server-side resolution.';
  } else if (u.host === 'docs.google.com') {
    m = /^\/(presentation|document|spreadsheets|forms|drawings)(?:\/u\/\d+)?\/d\/(e\/)?([a-zA-Z0-9_-]+)(?:\/|$)/.exec(u.path);
    if (!m) throw new Error('Use the document’s sharing link or published embed code.');
    var kind = m[1];
    var published = !!m[2];
    id = m[3];
    var base = u.origin + '/' + kind + '/d/' + (published ? 'e/' : '') + id;
    if (kind === 'presentation') {
      result.source = 'Google Slides';
      result.embedUrl = base + (published ? '/embed' : '/preview') + '?start=false&loop=false&delayms=3000';
      if (!published && p.resourcekey) result.embedUrl += '&resourcekey=' + encodeURIComponent(p.resourcekey);
    } else if (kind === 'document') {
      result.source = 'Google Docs';
      result.embedUrl = base + (published ? '/pub?embedded=true' : '/preview' + resource);
    } else if (kind === 'spreadsheets') {
      result.source = 'Google Sheets';
      result.embedUrl = base + (published ? '/pubhtml?widget=true&headers=false' : '/preview' + resource);
      var gid = p.gid || (/\bgid=(\d+)/.exec(u.hash) || [])[1];
      if (gid && /^\d+$/.test(gid)) result.embedUrl += (result.embedUrl.indexOf('?') >= 0 ? '&' : '?') + 'gid=' + gid;
    } else if (kind === 'forms') {
      if (/\/edit\/?$/.test(u.path)) throw new Error('For Forms, paste the responder link from Publish/Send, not the editor link.');
      result.source = 'Google Forms'; result.embedUrl = setQuery_(base + '/viewform' + (u.query ? '?' + u.query : ''), { embedded: 'true' });
    } else {
      result.source = 'Google Drawings';
      result.embedUrl = published || /\/pub$/.test(u.path) ? base + '/pub?w=1440&h=900' : 'https://drive.google.com/file/d/' + id + '/preview' + resource;
    }
  } else if (u.host === 'drive.google.com') {
    m = /^\/(?:drive\/(?:u\/\d+\/)?|)folders\/([\w-]+)/.exec(u.path);
    if (m || /\/embeddedfolderview$/.test(u.path)) {
      id = m ? m[1] : p.id;
      if (!id || !/^[\w-]+$/.test(id)) throw new Error('Drive folder ID is missing.');
      result.source = 'Drive folder';
      result.embedUrl = 'https://drive.google.com/embeddedfolderview?id=' + id + (p.resourcekey ? '&resourcekey=' + encodeURIComponent(p.resourcekey) : '') + '#grid';
    } else {
      m = /^\/file\/d\/([\w-]+)/.exec(u.path);
      id = m ? m[1] : p.id;
      if (!id || !/^[\w-]+$/.test(id)) throw new Error('Use a Drive file or folder sharing link.');
      result.source = 'Google Drive'; result.embedUrl = 'https://drive.google.com/file/d/' + id + '/preview' + resource;
    }
  } else if (isHost_(u.host, 'canva.com')) {
    m = /^\/design\/([\w-]+)(?:\/([\w-]+))?/.exec(u.path);
    if (!m) throw new Error('Use a Canva design link or its Share → Embed code.');
    result.source = 'Canva';
    var token = m[2] && !/^(edit|view|watch|embed|present)$/.test(m[2]) ? '/' + m[2] : '';
    result.embedUrl = 'https://www.canva.com/design/' + m[1] + token + '/view?embed';
    result.warning = 'Enable Share → Embed in Canva. A link alone does not publish the design.';
  } else if (u.host === 'onedrive.live.com' || u.host === 'www.onedrive.live.com' || u.host === 'onedrive.com') {
    result.source = 'OneDrive';
    var resid = p.resid || p.id;
    if (/\/embed\/?$/.test(u.path)) result.embedUrl = text;
    else if (resid && /^[a-f0-9]+![a-z0-9]+$/i.test(resid)) {
      result.embedUrl = 'https://onedrive.live.com/embed?resid=' + encodeURIComponent(resid) + (p.authkey ? '&authkey=' + encodeURIComponent(p.authkey) : '');
    } else {
      result.embedUrl = setQuery_(text, { action: 'embedview' });
      result.warning = 'This OneDrive link may not embed. Prefer OneDrive → Embed → Generate and paste the iframe code.';
    }
  } else if (isHost_(u.host, 'sharepoint.com')) {
    result.source = 'OneDrive';
    result.embedUrl = setQuery_(text, { action: 'embedview', web: '1' });
    result.warning = 'Microsoft 365 tenant permissions may require sign-in or prevent embedding. Prefer a generated embed code.';
  } else if (u.host === 'view.officeapps.live.com') {
    if (!/^\/op\/embed\.aspx$/i.test(u.path)) throw new Error('Use an Office Web Viewer embed URL.');
    if (p.src) parseHttps_(p.src);
    result.source = 'OneDrive';
  } else if (u.host.endsWith('.github.io') || (extraHosts || []).indexOf(u.host) >= 0) {
    result.source = u.host.endsWith('.github.io') ? 'GitHub Pages' : 'Web';
    result.warning = 'The website must allow framing. If it blocks embedding, use Open original.';
  } else throw new Error('Unsupported host. Use Google, Canva, GitHub Pages, OneDrive, or a configured custom web domain.');
  return result;
}
// END SHARED CONVERTER

(() => {
  const config = window.APP_CONFIG || {};
  const $ = id => document.getElementById(id);
  const state = {
    slides: [], folders: [], scope: 'all', query: '', tag: '', source: '', sort: 'newest',
    expanded: new Set(), password: '', admin: false, busy: false, loading: false, loaded: false,
    viewerId: '', viewerIds: [], pendingDelete: null, slideEdit: null, folderEdit: null,
    slideRequestId: '', folderRequestId: '', previewSequence: 0, previewTimer: null,
    idleTimer: null, notice: '', noticeKind: '', theme: 'light'
  };
  const node = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-' + name); svg.append(use); return svg;
  }
  function iconButton(name, label, handler, className = '') {
    const button = node('button', 'icon-btn ' + className);
    button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
    button.append(icon(name)); if (handler) button.addEventListener('click', handler); return button;
  }
  function requestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    if (window.crypto && crypto.getRandomValues) return Array.from(crypto.getRandomValues(new Uint8Array(16)), v => v.toString(16).padStart(2, '0')).join('');
    return Date.now().toString(36) + Math.random().toString(36).slice(2).padEnd(16, '0');
  }
  function apiUrl() {
    const url = String(config.API_URL || '').trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(url)) {
      throw new Error('Connect your library: paste the Apps Script /exec URL into config.js, then reload.');
    }
    return url;
  }
  async function api(action, payload = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.REQUEST_TIMEOUT_MS || 45000);
    try {
      const options = { redirect: 'follow', credentials: 'omit', signal: controller.signal };
      if (action) {
        options.method = 'POST';
        options.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
        options.body = JSON.stringify({ action, password: state.password, ...payload });
      }
      const response = await fetch(apiUrl(), options);
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); }
      catch (_error) { throw new Error('The API returned HTML instead of JSON. Deploy as a Web app with access Anyone, use /exec, and run setup().'); }
      if (!response.ok || !result.ok) {
        const error = new Error(result.error?.message || 'The server could not complete this request.');
        error.code = result.error?.code;
        if (error.code === 'UNAUTHORIZED') lockAdmin(false);
        throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The request timed out. It may already have saved. Refresh before retrying; no automatic write retry is performed.');
      if (error instanceof TypeError) throw new Error('Connection failed. Check the /exec URL, public deployment, network, and browser privacy settings. If saving, refresh before retrying: the write may have succeeded.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function notice(message, kind = '') {
    state.notice = message; state.noticeKind = kind;
    $('connectionStatus').textContent = message;
    $('connectionStatus').className = 'notice' + (kind === 'error' ? ' error' : '');
    $('connectionStatus').hidden = !message;
  }
  function acceptData(data) {
    if (!data || !Array.isArray(data.slides) || !Array.isArray(data.folders)) throw new Error('Unexpected API response. Update Code.gs and redeploy the backend.');
    state.slides = data.slides; state.folders = data.folders;
    if (state.scope.startsWith('folder:') && !state.folders.some(f => 'folder:' + f.id === state.scope)) state.scope = 'all';
    state.loaded = true;
    $('syncLabel').textContent = 'Synced ' + new Date(data.fetchedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · Public reads cached 120s';
    if (data.converterVersion !== CONVERTER_VERSION) {
      if (state.admin) lockAdmin(false);
      notice('Frontend and backend link converters differ. Deploy both matching copies before editing.', 'error');
    }
    else if (state.noticeKind !== 'error') notice('');
    render();
  }
  function skeletons() {
    $('resourceGrid').replaceChildren(); $('emptyState').hidden = true;
    for (let i = 0; i < 6; i++) {
      const card = node('div', 'resource-card'); card.setAttribute('aria-hidden', 'true');
      card.append(node('div', 'skeleton skeleton-cover'));
      const body = node('div', 'skeleton-body');
      for (let j = 0; j < 3; j++) body.append(node('div', 'skeleton skeleton-line'));
      card.append(body); $('resourceGrid').append(card);
    }
  }
  async function load() {
    if (state.loading || state.busy) return;
    state.loading = true; $('refreshBtn').disabled = true;
    if (!state.loaded) skeletons();
    try {
      apiUrl();
      const result = await api(); notice(''); acceptData(result.data);
      route();
    } catch (error) {
      notice(error.message, 'error');
      if (!state.loaded) {
        $('resourceGrid').replaceChildren(); $('emptyState').hidden = false;
        $('emptyTitle').textContent = config.API_URL ? 'Let’s reconnect your library.' : 'A new home for your resources.';
        $('emptyText').textContent = config.API_URL ? 'Your collection is safe in Google Sheets. Check the connection, then try again.' : 'Set up Google Sheets and Apps Script using the README, then add your API URL to config.js.';
        $('emptyAction').textContent = 'Try connection'; $('emptyAction').onclick = load;
      }
    } finally { state.loading = false; $('refreshBtn').disabled = false; }
  }
  async function mutate(action, payload, id = requestId()) {
    if (!state.admin || !state.password) throw new Error('Unlock admin access to edit this library.');
    if (state.busy || state.loading) throw new Error('Another operation is in progress. Please wait a moment.');
    state.busy = true;
    try {
      const result = await api(action, { payload, requestId: id });
      notice(''); acceptData(result.data); return result;
    } finally { state.busy = false; }
  }
  function folder(id) { return state.folders.find(f => f.id === id); }
  function ancestors(id) {
    const chain = []; const seen = new Set(); let current = folder(id);
    while (current && !seen.has(current.id) && chain.length < 20) {
      seen.add(current.id); chain.unshift(current); current = folder(current.parentId);
    }
    return chain;
  }
  function descendants(id) {
    const ids = new Set([id]); let changed = true;
    while (changed) {
      changed = false;
      state.folders.forEach(f => { if (ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); changed = true; } });
    }
    return ids;
  }
  function scopedSlides() {
    let list = state.slides;
    if (state.scope === 'favorites') list = list.filter(s => s.favorite);
    if (state.scope === 'unfiled') list = list.filter(s => !s.folderId);
    if (state.scope.startsWith('folder:')) {
      const ids = descendants(state.scope.slice(7)); list = list.filter(s => ids.has(s.folderId));
    }
    const words = state.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return list.filter(s => {
      const haystack = [s.title, ...(s.tags || []), s.notes || ''].join(' ').toLocaleLowerCase();
      return words.every(w => haystack.includes(w)) && (!state.source || s.source === state.source) && (!state.tag || (s.tags || []).includes(state.tag));
    }).sort((a, b) => state.sort === 'title' ? a.title.localeCompare(b.title) : String(b[state.sort === 'updated' ? 'updatedAt' : 'createdAt']).localeCompare(String(a[state.sort === 'updated' ? 'updatedAt' : 'createdAt'])));
  }
  function setScope(scope, updateHash = true) {
    state.scope = scope;
    if (scope.startsWith('folder:')) ancestors(scope.slice(7)).forEach(f => state.expanded.add(f.id));
    closeNav();
    if (updateHash) {
      const params = new URLSearchParams();
      if (scope.startsWith('folder:')) params.set('folder', scope.slice(7));
      else if (scope !== 'all') params.set('view', scope);
      history.replaceState(null, '', location.pathname + location.search + (params.size ? '#' + params.toString() : ''));
    }
    render();
  }
  function renderFolders() {
    const root = $('folderTree'); root.replaceChildren();
    $('folderEmpty').hidden = !!state.folders.length;
    const visited = new Set();
    const build = (parentId, container, depth) => {
      if (depth > 12) return;
      state.folders.filter(f => (f.parentId || '') === parentId).sort((a, b) => a.name.localeCompare(b.name)).forEach(f => {
        if (visited.has(f.id)) return; visited.add(f.id);
        const branch = node('div', 'folder-branch');
        const row = node('div', 'folder-row' + (state.scope === 'folder:' + f.id ? ' active' : ''));
        row.style.setProperty('--depth', Math.min(depth, 5));
        const hasChildren = state.folders.some(child => child.parentId === f.id);
        const expand = iconButton('chevron', 'Expand ' + f.name, () => {
          if (state.expanded.has(f.id)) state.expanded.delete(f.id); else state.expanded.add(f.id);
          renderFolders();
        }, 'folder-expand' + (hasChildren ? '' : ' leaf') + (state.expanded.has(f.id) ? ' expanded' : ''));
        if (hasChildren) expand.setAttribute('aria-expanded', String(state.expanded.has(f.id))); else expand.tabIndex = -1;
        const select = node('button', 'folder-select'); select.type = 'button';
        select.title = ancestors(f.id).map(item => item.name).join(' / ');
        select.append(icon('folder'), node('span', 'folder-name', f.name));
        select.addEventListener('click', () => setScope('folder:' + f.id)); row.append(expand, select);
        if (state.admin) row.append(iconButton('more', 'Manage ' + f.name, () => openFolderDialog(f), 'folder-edit'));
        branch.append(row);
        if (hasChildren && state.expanded.has(f.id)) build(f.id, branch, depth + 1);
        container.append(branch);
      });
    };
    build('', root, 0);
  }
  function renderBreadcrumbs() {
    const root = $('breadcrumbs'); root.replaceChildren();
    const home = node('button', '', config.LIBRARY_NAME || 'Folio'); home.addEventListener('click', () => setScope('all')); root.append(home);
    const items = state.scope.startsWith('folder:') ? ancestors(state.scope.slice(7)) : [{ id: '', name: state.scope === 'favorites' ? 'Favorites' : state.scope === 'unfiled' ? 'Unfiled' : 'All resources' }];
    items.forEach(f => {
      root.append(icon('chevron'));
      const item = node('button', '', f.name); item.addEventListener('click', () => setScope(f.id ? 'folder:' + f.id : state.scope)); root.append(item);
    });
  }
  function render() {
    renderFolders(); renderBreadcrumbs();
    for (const [id, scope] of [['allNav', 'all'], ['favoritesNav', 'favorites'], ['unfiledNav', 'unfiled']]) {
      $(id).classList.toggle('active', state.scope === scope);
      if (state.scope === scope) $(id).setAttribute('aria-current', 'page'); else $(id).removeAttribute('aria-current');
    }
    $('allCount').textContent = state.slides.length;
    $('favoritesCount').textContent = state.slides.filter(s => s.favorite).length;
    $('unfiledCount').textContent = state.slides.filter(s => !s.folderId).length;
    const currentFolder = state.scope.startsWith('folder:') ? folder(state.scope.slice(7)) : null;
    const title = currentFolder?.name || (state.scope === 'favorites' ? 'Favorites' : state.scope === 'unfiled' ? 'Unfiled' : 'All resources');
    $('pageTitle').replaceChildren(document.createTextNode(title), node('span', 'heading-period', '.'));
    $('pageDescription').textContent = currentFolder ? 'Everything in this folder, including its subfolders.' : state.scope === 'favorites' ? 'The ones worth keeping close.' : state.scope === 'unfiled' ? 'A little room for resources waiting to be organized.' : 'Good ideas deserve a place of their own.';
    $('resourceTotal').textContent = state.slides.length + (state.slides.length === 1 ? ' resource in library' : ' resources in library');
    const sources = [...new Set(state.slides.map(s => s.source))].sort();
    $('sourceFilter').replaceChildren(new Option('All sources', ''));
    if (state.source && !sources.includes(state.source)) state.source = '';
    sources.forEach(source => $('sourceFilter').add(new Option(source, source)));
    $('sourceFilter').value = state.source;
    const list = scopedSlides(); $('resultCount').textContent = list.length + (list.length === 1 ? ' item' : ' items');
    $('resourceGrid').replaceChildren(...list.map(renderCard));
    $('activeFilters').replaceChildren();
    const filters = [];
    if (state.tag) filters.push(['Tag: ' + state.tag + ' ×', () => { state.tag = ''; render(); }]);
    if (state.query) filters.push(['Search: ' + state.query + ' ×', () => { state.query = ''; $('searchInput').value = ''; render(); }]);
    filters.forEach(([label, action]) => { const b = node('button', '', label); b.addEventListener('click', action); $('activeFilters').append(b); });
    $('activeFilters').hidden = !filters.length;
    $('emptyState').hidden = list.length > 0;
    if (!list.length) {
      const filtering = !!(state.query || state.tag || state.source);
      $('emptyTitle').textContent = filtering ? 'Nothing quite matches yet.' : 'Make room for good ideas.';
      $('emptyText').textContent = filtering ? 'Try a different search or clear your filters to see more resources.' : state.admin ? 'Add a link to your first slide deck, document, or interactive resource.' : 'Resources will appear here when the library administrator adds them.';
      $('emptyAction').hidden = !filtering && !state.admin;
      $('emptyAction').textContent = filtering ? 'Clear filters' : 'Add first resource';
      $('emptyAction').onclick = filtering ? clearFilters : () => openSlideDialog();
    }
  }
  function renderCard(slide) {
    const card = node('article', 'resource-card');
    const cover = node('button', 'card-cover'); cover.type = 'button'; cover.setAttribute('aria-label', 'View ' + slide.title);
    const design = node('div', 'cover-design');
    const label = node('span', 'cover-label', slide.source.toUpperCase());
    const baseline = node('div', 'cover-baseline'); const lines = node('span', 'cover-lines'); lines.append(node('span'), node('span'), node('span'));
    baseline.append(node('span', '', (slide.tags || [])[0] || 'RESOURCE LIBRARY'), lines);
    design.append(label, node('strong', '', slide.title), baseline); cover.append(design);
    if (slide.thumbnailUrl) {
      try {
        parseHttps_(slide.thumbnailUrl);
        const image = node('img'); image.src = slide.thumbnailUrl; image.alt = 'Cover for ' + slide.title;
        image.width = 640; image.height = 400; image.loading = 'lazy'; image.decoding = 'async'; image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => { image.remove(); design.hidden = false; }, { once: true });
        design.hidden = true; cover.append(image);
      } catch (_error) { /* Invalid image links fall back to the title cover. */ }
    }
    const open = node('span', 'cover-open'); open.append(icon('expand')); cover.append(open);
    cover.addEventListener('click', () => openViewer(slide.id));
    const content = node('div', 'card-content'); const top = node('div', 'card-topline');
    const badge = node('span', 'badge'); badge.append(node('span', 'badge-dot'), document.createTextNode(slide.source));
    const star = iconButton('star', (slide.favorite ? 'Remove from' : 'Add to') + ' Favorites' + (state.admin ? '' : ' (admin only)'), async () => {
      if (!state.admin) return;
      star.disabled = true;
      try { await mutate('setFavorite', { id: slide.id, expectedUpdatedAt: slide.updatedAt, favorite: !slide.favorite }); }
      catch (error) { notice(error.message, 'error'); star.disabled = false; }
    }, 'favorite-btn' + (slide.favorite ? ' selected' : ''));
    star.disabled = !state.admin; star.setAttribute('aria-pressed', String(!!slide.favorite));
    top.append(badge, star);
    const title = node('button', 'card-title', slide.title); title.addEventListener('click', () => openViewer(slide.id));
    const tags = node('div', 'card-tags');
    (slide.tags || []).slice(0, 4).forEach(tag => {
      const chip = node('button', 'tag', tag); chip.addEventListener('click', () => { state.tag = tag; render(); }); tags.append(chip);
    });
    if ((slide.tags || []).length > 4) tags.append(node('span', 'subtle', '+' + (slide.tags.length - 4)));
    const bottom = node('div', 'card-bottom'); const location = node('span', 'card-location');
    const path = ancestors(slide.folderId).map(f => f.name).join(' / ') || 'Unfiled'; location.title = path;
    location.append(icon('folder'), node('span', '', path)); bottom.append(location);
    if (state.admin) {
      const actions = node('div', 'card-admin-actions');
      actions.append(iconButton('edit', 'Edit ' + slide.title, () => openSlideDialog(slide)), iconButton('trash', 'Delete ' + slide.title, () => confirmSlideDelete(slide)));
      bottom.append(actions);
    } else bottom.append(node('span', '', new Date(slide.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
    content.append(top, title, tags, bottom); card.append(cover, content); return card;
  }
  function clearFilters() { state.query = ''; state.tag = ''; state.source = ''; $('searchInput').value = ''; render(); }
  function closeNav() { document.body.classList.remove('nav-open'); $('sidebarBackdrop').hidden = true; $('menuToggle').setAttribute('aria-expanded', 'false'); }
  function openDialog(id) { if (!$(id).open) $(id).showModal(); }
  function syncAdmin() {
    document.querySelectorAll('.admin-only').forEach(el => { el.hidden = !state.admin; });
    $('viewOnlyPill').hidden = state.admin;
    $('adminLabel').textContent = state.admin ? 'Lock editing' : 'Admin access';
    $('roleLabel').textContent = state.admin ? 'ADMIN · EDITING ENABLED' : 'VIEW-ONLY LIBRARY';
    $('adminIndicator').classList.toggle('unlocked', state.admin);
    render();
  }
  function resetIdle() {
    if (!state.admin) return;
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => lockAdmin(true), Math.max(1, Number(config.ADMIN_IDLE_MINUTES) || 15) * 60000);
  }
  function lockAdmin(showNotice = true) {
    state.admin = false; state.password = ''; clearTimeout(state.idleTimer);
    $('adminPassword').value = '';
    for (const id of ['slideDialog', 'folderDialog', 'confirmDialog']) if ($(id).open) $(id).close();
    syncAdmin(); if (showNotice) notice('Editing locked. Your library is back in view-only mode.');
  }
  async function unlock(event) {
    event.preventDefault(); $('adminError').textContent = '';
    state.password = $('adminPassword').value; $('unlockBtn').disabled = true; $('unlockBtn').textContent = 'Checking…';
    try {
      const result = await api('login');
      if (!$('adminDialog').open) { state.password = ''; return; }
      if (result.converterVersion !== CONVERTER_VERSION) throw new Error('The frontend and backend versions differ. Update and redeploy both before editing.');
      state.admin = true; $('adminPassword').value = ''; $('adminDialog').close(); syncAdmin(); resetIdle(); notice('Editing unlocked. Changes are saved to Google Sheets.');
    } catch (error) { state.password = ''; $('adminError').textContent = error.message; }
    finally { $('unlockBtn').disabled = false; $('unlockBtn').textContent = 'Unlock editing'; }
  }
  function fillFolderOptions(select, value, exclude = new Set()) {
    select.replaceChildren(new Option('Unfiled / Library root', ''));
    const walk = (parent, depth, visited) => {
      if (depth > 12) return;
      state.folders.filter(f => (f.parentId || '') === parent).sort((a, b) => a.name.localeCompare(b.name)).forEach(f => {
        if (visited.has(f.id) || exclude.has(f.id)) return; visited.add(f.id);
        select.add(new Option('— '.repeat(depth) + f.name, f.id)); walk(f.id, depth + 1, visited);
      });
    };
    walk('', 0, new Set()); select.value = value || '';
  }
  function openSlideDialog(slide = null) {
    if (!state.admin) return;
    state.slideEdit = slide; state.slideRequestId = requestId(); state.previewSequence++;
    $('slideForm').reset(); $('slideError').textContent = ''; $('linkError').textContent = '';
    $('slideDetails').open = false;
    $('slideDialogTitle').textContent = slide ? 'Edit resource' : 'Add a resource';
    $('saveSlideBtn').textContent = slide ? 'Save changes' : 'Save resource'; $('saveSlideBtn').disabled = false;
    $('slideInput').value = slide?.url || ''; $('slideTitle').value = slide?.title || '';
    $('slideTags').value = (slide?.tags || []).join(', '); $('slideNotes').value = slide?.notes || '';
    $('slideThumbnail').value = slide?.thumbnailUrl || ''; $('slideFavorite').checked = !!slide?.favorite;
    if (slide?.notes || slide?.thumbnailUrl) $('slideDetails').open = true;
    fillFolderOptions($('slideFolder'), slide?.folderId || (state.scope.startsWith('folder:') ? state.scope.slice(7) : ''));
    openDialog('slideDialog'); previewLink();
  }
  function makeFrame(url, title) {
    const checked = convertLink_(url, config.EXTRA_EMBED_HOSTS || []);
    if (checked.needsResolve) throw new Error('This resource needs to be re-saved by the administrator to resolve its short link.');
    const frame = node('iframe', 'resource-frame');
    // Use the stored embed URL only after validating its scheme/provider.
    frame.src = url; frame.title = title; frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute('allow', 'fullscreen; autoplay; clipboard-write'); frame.setAttribute('allowfullscreen', '');
    let sandbox = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-presentation';
    // Web embeds have an opaque origin: never combine scripts+same-origin for user sites.
    if (checked.source !== 'GitHub Pages' && checked.source !== 'Web') sandbox += ' allow-same-origin';
    frame.setAttribute('sandbox', sandbox); return frame;
  }
  async function previewLink() {
    const sequence = ++state.previewSequence;
    const input = $('slideInput').value.trim();
    $('linkError').textContent = ''; $('previewOriginal').hidden = true;
    $('previewStage').replaceChildren(node('p', '', input ? 'Preparing your preview…' : 'Paste a link.\nSee it here before saving.'));
    $('previewBadge').textContent = 'Waiting for a link';
    if (!input) return;
    try {
      let link = convertLink_(input, config.EXTRA_EMBED_HOSTS || []);
      if (link.needsResolve) {
        $('previewBadge').textContent = 'Resolving…';
        const result = await api('resolveLink', { input }); link = result.link;
      }
      if (sequence !== state.previewSequence || !$('slideDialog').open) return;
      $('previewStage').replaceChildren(makeFrame(link.embedUrl, 'Preview of ' + ($('slideTitle').value || link.source)));
      $('previewBadge').textContent = link.source;
      $('previewHint').textContent = link.warning || 'Preview is view-only where the provider supports it. Original sharing permissions still apply.';
      $('previewOriginal').href = link.url; $('previewOriginal').hidden = false;
    } catch (error) {
      if (sequence !== state.previewSequence) return;
      $('linkError').textContent = error.message; $('previewBadge').textContent = 'Check this link';
      $('previewStage').replaceChildren(node('p', '', 'A preview will appear when the link is ready.'));
    }
  }
  async function saveSlide(event) {
    event.preventDefault(); $('slideError').textContent = '';
    const tags = [...new Set($('slideTags').value.split(',').map(t => t.trim()).filter(Boolean))];
    if (tags.length > 20 || tags.some(t => t.length > 40)) { $('slideError').textContent = 'Use up to 20 tags, each no longer than 40 characters.'; return; }
    try { convertLink_($('slideInput').value, config.EXTRA_EMBED_HOSTS || []); }
    catch (error) { $('slideError').textContent = error.message; return; }
    const button = $('saveSlideBtn'); button.disabled = true; button.textContent = 'Saving…';
    try {
      const old = state.slideEdit;
      const result = await mutate('saveSlide', {
        id: old?.id || '', expectedUpdatedAt: old?.updatedAt || '',
        input: $('slideInput').value, title: $('slideTitle').value, folderId: $('slideFolder').value,
        tags, notes: $('slideNotes').value, thumbnailUrl: $('slideThumbnail').value, favorite: $('slideFavorite').checked
      }, state.slideRequestId);
      $('slideDialog').close(); notice(result.replay ? 'Your earlier save was already applied. Library refreshed.' : old ? 'Resource updated.' : 'A good idea, neatly filed. Resource added.');
    } catch (error) { $('slideError').textContent = error.message; }
    finally { button.disabled = false; button.textContent = state.slideEdit ? 'Save changes' : 'Save resource'; }
  }
  function openFolderDialog(item = null, parentId = '') {
    if (!state.admin) return;
    state.folderEdit = item; state.folderRequestId = requestId();
    $('folderForm').reset(); $('folderError').textContent = '';
    $('folderDialogTitle').textContent = item ? 'Rename or move folder' : 'New folder';
    $('folderName').value = item?.name || '';
    fillFolderOptions($('folderParent'), item?.parentId || parentId, item ? descendants(item.id) : new Set());
    $('folderEditActions').hidden = !item; $('saveFolderBtn').disabled = false;
    openDialog('folderDialog');
  }
  async function saveFolder(event) {
    event.preventDefault(); $('folderError').textContent = ''; $('saveFolderBtn').disabled = true;
    try {
      const old = state.folderEdit; const parentId = $('folderParent').value;
      await mutate('saveFolder', { id: old?.id || '', expectedUpdatedAt: old?.updatedAt || '', name: $('folderName').value, parentId }, state.folderRequestId);
      if (parentId) state.expanded.add(parentId);
      $('folderDialog').close(); renderFolders(); notice(old ? 'Folder updated.' : 'New folder created.');
    } catch (error) { $('folderError').textContent = error.message; }
    finally { $('saveFolderBtn').disabled = false; }
  }
  function confirmSlideDelete(slide) {
    state.pendingDelete = { action: 'deleteSlide', payload: { id: slide.id, expectedUpdatedAt: slide.updatedAt }, requestId: requestId() };
    $('confirmTitle').textContent = 'Delete resource?';
    $('confirmText').textContent = 'Remove “' + slide.title + '” from this library? This does not delete the original file.';
    $('confirmError').textContent = ''; openDialog('confirmDialog');
  }
  function confirmFolderDelete() {
    const item = state.folderEdit; if (!item) return;
    const ids = descendants(item.id); const count = state.slides.filter(s => ids.has(s.folderId)).length;
    state.pendingDelete = { action: 'deleteFolder', payload: { id: item.id, expectedUpdatedAt: item.updatedAt }, requestId: requestId() };
    $('confirmTitle').textContent = 'Delete this folder tree?';
    $('confirmText').textContent = 'Delete “' + item.name + '” and ' + (ids.size - 1) + ' subfolder(s)? ' + count + ' resource(s) will be moved to Unfiled, not deleted. Original files stay untouched.';
    $('confirmError').textContent = ''; openDialog('confirmDialog');
  }
  async function performDelete() {
    if (!state.pendingDelete) return;
    $('confirmDelete').disabled = true; $('confirmError').textContent = '';
    try {
      const pending = state.pendingDelete;
      await mutate(pending.action, pending.payload, pending.requestId);
      $('confirmDialog').close();
      if (pending.action === 'deleteFolder') $('folderDialog').close();
      state.pendingDelete = null; notice(pending.action === 'deleteFolder' ? 'Folder tree deleted. Its resources are safely in Unfiled.' : 'Resource removed from the library.');
    } catch (error) { $('confirmError').textContent = error.message; }
    finally { $('confirmDelete').disabled = false; }
  }
  function slideHash(id) { return '#slide=' + encodeURIComponent(id); }
  function openViewer(id, updateHash = true, preserveOrder = false) {
    const slide = state.slides.find(s => s.id === id);
    if (!slide) { notice('This direct link points to a resource that is no longer in the library.', 'error'); return; }
    if (!preserveOrder) {
      state.viewerIds = scopedSlides().map(s => s.id);
      if (!state.viewerIds.includes(id)) state.viewerIds = state.slides.map(s => s.id);
    }
    state.viewerId = id;
    $('viewerTitle').textContent = slide.title; $('viewerSource').textContent = slide.source;
    try {
      const safeOriginal = convertLink_(slide.url, config.EXTRA_EMBED_HOSTS || []);
      $('viewerOriginal').href = safeOriginal.url; $('viewerOriginal').hidden = false;
    } catch (_error) { $('viewerOriginal').hidden = true; $('viewerOriginal').removeAttribute('href'); }
    try { $('viewerStage').replaceChildren(makeFrame(slide.embedUrl, slide.title)); }
    catch (error) { $('viewerStage').replaceChildren(node('p', 'notice error', error.message)); }
    const position = state.viewerIds.indexOf(id);
    $('viewerPosition').textContent = (position + 1) + ' / ' + state.viewerIds.length;
    $('prevSlide').disabled = position <= 0; $('nextSlide').disabled = position >= state.viewerIds.length - 1;
    $('viewerNote').textContent = slide.notes ? slide.notes : 'Preview blocked? Use Open original. · F fullscreen · ← → navigate · Esc close';
    $('viewerNote').title = slide.notes || 'Click the toolbar to use keyboard shortcuts outside the embedded resource.';
    if (updateHash) {
      const target = location.pathname + location.search + slideHash(id);
      if ($('viewerDialog').open) history.replaceState(null, '', target); else history.pushState(null, '', target);
    }
    openDialog('viewerDialog'); document.title = slide.title + ' — ' + (config.LIBRARY_NAME || 'Folio');
    $('closeViewer').focus();
  }
  function navigateViewer(delta) {
    const at = state.viewerIds.indexOf(state.viewerId); const id = state.viewerIds[at + delta];
    if (id) openViewer(id, true, true);
  }
  function clearViewer() {
    $('viewerStage').replaceChildren(); state.viewerId = ''; document.title = (config.LIBRARY_NAME || 'Folio') + ' — Slide library';
  }
  function closeViewer(updateHash = true) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if ($('viewerDialog').open) $('viewerDialog').close();
    clearViewer();
    if (updateHash && new URLSearchParams(location.hash.slice(1)).has('slide')) setScope(state.scope);
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if ($('viewerDialog').querySelector('.viewer-shell').requestFullscreen) await $('viewerDialog').querySelector('.viewer-shell').requestFullscreen();
      else $('viewerNote').textContent = 'Native fullscreen is not available in this browser. The viewer already fills the page.';
    } catch (_error) { $('viewerNote').textContent = 'Your browser blocked native fullscreen. The viewer still fills the page.'; }
  }
  function share() {
    $('shareUrl').value = location.href.split('#')[0] + slideHash(state.viewerId);
    $('shareFeedback').textContent = '';
    // A native fullscreen top-layer can hide sibling dialogs: leave fullscreen first.
    if (document.fullscreenElement) document.exitFullscreen().then(() => openDialog('shareDialog')).catch(() => openDialog('shareDialog'));
    else openDialog('shareDialog');
  }
  async function copyShare() {
    try {
      await navigator.clipboard.writeText($('shareUrl').value);
      $('shareFeedback').textContent = 'Link copied. Ready to share.'; $('copyShare').textContent = 'Copied';
      setTimeout(() => { $('copyShare').textContent = 'Copy link'; }, 1800);
    } catch (_error) { $('shareUrl').focus(); $('shareUrl').select(); $('shareFeedback').textContent = 'Select and copy this link manually (Ctrl/Cmd+C).'; }
  }
  function route() {
    if (!state.loaded) return;
    const params = new URLSearchParams(location.hash.slice(1));
    const slideId = params.get('slide');
    if (slideId) { if (state.viewerId !== slideId || !$('viewerDialog').open) openViewer(slideId, false); return; }
    if ($('viewerDialog').open) closeViewer(false);
    const folderId = params.get('folder'); const view = params.get('view');
    setScope(folderId && folder(folderId) ? 'folder:' + folderId : ['favorites', 'unfiled'].includes(view) ? view : 'all', false);
  }
  function setTheme(theme) {
    state.theme = theme; document.documentElement.dataset.theme = theme;
    const next = theme === 'dark' ? 'light' : 'dark';
    $('themeToggle').replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon'));
    $('themeToggle').setAttribute('aria-label', 'Switch to ' + next + ' mode'); $('themeToggle').title = 'Switch to ' + next + ' mode';
  }
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('allNav').addEventListener('click', () => setScope('all'));
  $('favoritesNav').addEventListener('click', () => setScope('favorites'));
  $('unfiledNav').addEventListener('click', () => setScope('unfiled'));
  document.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); clearFilters(); setScope('all'); });
  $('searchInput').addEventListener('input', event => { state.query = event.target.value; render(); });
  $('sourceFilter').addEventListener('change', event => { state.source = event.target.value; render(); });
  $('sortSelect').addEventListener('change', event => { state.sort = event.target.value; render(); });
  $('refreshBtn').addEventListener('click', load);
  $('themeToggle').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
  $('menuToggle').addEventListener('click', () => {
    const open = !document.body.classList.contains('nav-open');
    document.body.classList.toggle('nav-open', open); $('sidebarBackdrop').hidden = !open; $('menuToggle').setAttribute('aria-expanded', String(open));
  });
  $('sidebarBackdrop').addEventListener('click', closeNav);
  $('adminToggle').addEventListener('click', () => { if (state.admin) lockAdmin(); else { $('adminError').textContent = ''; openDialog('adminDialog'); } });
  $('adminForm').addEventListener('submit', unlock);
  $('adminDialog').addEventListener('close', () => { $('adminPassword').value = ''; });
  $('addSlide').addEventListener('click', () => openSlideDialog());
  $('addFolder').addEventListener('click', () => openFolderDialog(null, state.scope.startsWith('folder:') ? state.scope.slice(7) : ''));
  $('slideForm').addEventListener('submit', saveSlide);
  $('slideInput').addEventListener('input', () => { clearTimeout(state.previewTimer); ++state.previewSequence; state.previewTimer = setTimeout(previewLink, 500); });
  $('slideDialog').addEventListener('close', () => { ++state.previewSequence; clearTimeout(state.previewTimer); $('previewStage').replaceChildren(); });
  $('folderForm').addEventListener('submit', saveFolder);
  $('folderAddChild').addEventListener('click', () => { const parent = state.folderEdit?.id || ''; openFolderDialog(null, parent); });
  $('folderDelete').addEventListener('click', confirmFolderDelete);
  $('confirmDelete').addEventListener('click', performDelete);
  $('helpBtn').addEventListener('click', () => openDialog('helpDialog'));
  $('closeViewer').addEventListener('click', () => closeViewer());
  $('viewerDialog').addEventListener('cancel', event => { event.preventDefault(); closeViewer(); });
  $('viewerDialog').addEventListener('close', clearViewer);
  $('prevSlide').addEventListener('click', () => navigateViewer(-1));
  $('nextSlide').addEventListener('click', () => navigateViewer(1));
  $('fullscreenBtn').addEventListener('click', fullscreen);
  $('shareSlide').addEventListener('click', share);
  $('copyShare').addEventListener('click', copyShare);
  for (const name of ['pointerdown', 'keydown']) document.addEventListener(name, resetIdle, { passive: true });
  document.addEventListener('keydown', event => {
    const top = [...document.querySelectorAll('dialog[open]')].at(-1);
    const typing = event.target.matches('input,textarea,select,[contenteditable="true"]');
    if (event.ctrlKey || event.metaKey || event.altKey || typing) return;
    if (top === $('viewerDialog')) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); navigateViewer(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); navigateViewer(1); }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); fullscreen(); }
    } else if (!top && event.key === '/') { event.preventDefault(); $('searchInput').focus(); }
    else if (!top && event.key === '?') openDialog('helpDialog');
    if (event.key === 'Escape' && !top) closeNav();
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  $('brandName').replaceChildren(document.createTextNode(config.LIBRARY_NAME || 'Folio'), node('span', 'brand-dot', '.'));
  if (config.LIBRARY_SUBTITLE) document.querySelector('meta[name="description"]').content = config.LIBRARY_SUBTITLE;
  setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  renderFolders(); load();
})();
