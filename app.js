(() => {
  'use strict';

  const CFG = window.CONFIG;
  const $ = (s, root = document) => root.querySelector(s);

  const SOURCES = {
    'google-slides': { label: 'Google Slides', icon: '🟨' },
    'google-drive': { label: 'Google Drive', icon: '📁' },
    'canva': { label: 'Canva', icon: '🎨' },
    'onedrive': { label: 'OneDrive', icon: '☁️' }
  };

  const state = {
    slides: [],
    folders: [],
    view: 'all',          // all | fav | recent | none | <folderId>
    query: '',
    token: sessionStorage.getItem('slidelib_token') || '',
    edit: false,
    editingId: null,
    collapsed: new Set(JSON.parse(localStorage.getItem('slidelib_collapsed') || '[]'))
  };
  state.edit = !!state.token;

  /* ---------- tiny DOM helper ---------- */
  function h(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    kids.flat().forEach(c => {
      if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
    });
    return n;
  }

  function toast(msg, type) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (type === 'err' ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 3200);
  }

  /* ---------- link conversion (keep in sync with Code.gs) ---------- */
  function toEmbed(raw) {
    const url = String(raw || '').trim();
    let m;
    if (!/^https:\/\//i.test(url)) return null;

    if ((m = url.match(/docs\.google\.com\/presentation\/d\/e\/([\w-]+)/))) {
      return { source: 'google-slides', embedUrl: `https://docs.google.com/presentation/d/e/${m[1]}/embed?start=false&loop=false&delayms=3000` };
    }
    if ((m = url.match(/docs\.google\.com\/presentation\/d\/([\w-]+)/))) {
      return {
        source: 'google-slides',
        embedUrl: `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false&delayms=3000`,
        thumb: `https://drive.google.com/thumbnail?id=${m[1]}&sz=w480`
      };
    }
    if ((m = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/)) ||
        (m = url.match(/drive\.google\.com\/open\?(?:[^#]*&)?id=([\w-]+)/))) {
      return {
        source: 'google-drive',
        embedUrl: `https://drive.google.com/file/d/${m[1]}/preview`,
        thumb: `https://drive.google.com/thumbnail?id=${m[1]}&sz=w480`
      };
    }
    if (/^https:\/\/onedrive\.live\.com\/embed\?/i.test(url) ||
        /^https:\/\/[\w-]+\.sharepoint\.com\/.+\/embed\.aspx/i.test(url)) {
      return { source: 'onedrive', embedUrl: url };
    }
    if (/^https:\/\/onedrive\.live\.com\//i.test(url) && (m = url.match(/[?&](?:resid|id)=([^&#]+)/))) {
      const resid = decodeURIComponent(m[1]);
      const k = url.match(/[?&]authkey=([^&#]+)/);
      const c = url.match(/[?&]cid=([^&#]+)/);
      const cid = c ? decodeURIComponent(c[1]) : resid.split('!')[0];
      return { source: 'onedrive', embedUrl: `https://onedrive.live.com/embed?cid=${encodeURIComponent(cid)}&resid=${encodeURIComponent(resid)}` + (k ? `&authkey=${encodeURIComponent(decodeURIComponent(k[1]))}` : '') };
    }
    if ((m = url.match(/canva\.com\/design\/([\w-]+)\/(?:([\w-]+)\/)?(?:view|watch)/))) {
      return { source: 'canva', embedUrl: `https://www.canva.com/design/${m[1]}/${m[2] ? m[2] + '/' : ''}view?embed` };
    }
    return null;
  }

  /* ---------- API ---------- */
  const apiReady = () => CFG.API_URL && !CFG.API_URL.includes('PASTE_YOUR');

  async function apiGet() {
    const r = await fetch(CFG.API_URL, { redirect: 'follow' });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Could not load data');
    return j;
  }

  async function apiPost(action, data) {
    const r = await fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // avoids CORS preflight
      body: JSON.stringify({ action, data, token: state.token })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Request failed');
    return j;
  }

  function saveCache() {
    try { localStorage.setItem(CFG.CACHE_KEY, JSON.stringify({ slides: state.slides, folders: state.folders })); } catch (e) {}
  }

  async function refresh(silent) {
    try {
      const j = await apiGet();
      state.slides = j.slides;
      state.folders = j.folders;
      saveCache();
      renderAll();
      route();
    } catch (e) {
      if (!silent) toast(e.message, 'err');
    }
  }

  /* ---------- folder helpers ---------- */
  const byId = (arr, id) => arr.find(x => x.id === id);
  const childrenOf = pid => state.folders
    .filter(f => (f.parentId || '') === (pid || ''))
    .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
  function descendantIds(id) {
    const out = [id];
    childrenOf(id).forEach(c => out.push(...descendantIds(c.id)));
    return out;
  }
  function folderPath(id) {
    const parts = [];
    let f = byId(state.folders, id), guard = 0;
    while (f && guard++ < 20) { parts.unshift(f.name); f = byId(state.folders, f.parentId); }
    return parts.join(' / ');
  }
  const folderExists = id => !!id && !!byId(state.folders, id);
  const countIn = id => {
    const ids = new Set(descendantIds(id));
    return state.slides.filter(s => ids.has(s.folderId)).length;
  };

  /* ---------- slide helpers ---------- */
  const tagsOf = s => String(s.tags || '').split(',').map(t => t.trim()).filter(Boolean);
  const asc = (a, b) => String(a.dateAdded).localeCompare(String(b.dateAdded));
  const desc = (a, b) => asc(b, a);

  function visibleSlides() {
    let list = state.slides.slice();
    const q = state.query.trim().toLowerCase();
    if (q) {
      return list.filter(s => {
        const hay = [s.title, s.tags, s.notes, folderPath(s.folderId)].join(' ').toLowerCase();
        return hay.includes(q);
      }).sort(desc);
    }
    const v = state.view;
    if (v === 'fav') list = list.filter(s => s.favorite);
    else if (v === 'none') list = list.filter(s => !folderExists(s.folderId));
    else if (v !== 'all' && v !== 'recent') {
      const ids = new Set(descendantIds(v));
      list = list.filter(s => ids.has(s.folderId));
    }
    if (v === 'recent') return list.sort(desc).slice(0, 12);
    // inside a folder: oldest first so lessons follow the order you added them
    return list.sort(byIdIsFolder(v) ? asc : desc);
  }
  const byIdIsFolder = v => !['all', 'fav', 'recent', 'none'].includes(v);

  function viewTitle() {
    if (state.query.trim()) return `Search: “${state.query.trim()}”`;
    switch (state.view) {
      case 'all': return 'All slides';
      case 'fav': return '⭐ Favorites';
      case 'recent': return '🕒 Recently added';
      case 'none': return 'Unfiled';
      default: return folderPath(state.view) || 'All slides';
    }
  }

  /* ---------- render: sidebar ---------- */
  function treeItem({ id, icon, name, count, depth, folder }) {
    const kids = folder ? childrenOf(folder.id) : [];
    const collapsed = state.collapsed.has(id);
    const row = h('div', {
      class: 'tree-item' + (state.view === id && !state.query ? ' active' : ''),
      onclick: () => { state.view = id; state.query = ''; $('#search').value = ''; closeMenu(); renderAll(); }
    },
      h('span', {
        class: 'caret',
        onclick: e => {
          if (!kids.length) return;
          e.stopPropagation();
          collapsed ? state.collapsed.delete(id) : state.collapsed.add(id);
          localStorage.setItem('slidelib_collapsed', JSON.stringify([...state.collapsed]));
          renderTree();
        }
      }, kids.length ? (collapsed ? '▶' : '▼') : ''),
      h('span', {}, icon),
      h('span', { class: 'name', dir: 'auto' }, name),
      folder ? h('span', { class: 'tree-actions edit-only' },
        h('button', { title: 'Add subfolder', onclick: e => { e.stopPropagation(); addFolder(folder.id); } }, '＋'),
        h('button', { title: 'Rename', onclick: e => { e.stopPropagation(); renameFolder(folder); } }, '✎'),
        h('button', { title: 'Delete', onclick: e => { e.stopPropagation(); deleteFolder(folder); } }, '🗑')
      ) : null,
      h('span', { class: 'count' }, String(count))
    );
    const wrap = h('div', {}, row);
    if (kids.length && !collapsed) {
      wrap.append(h('div', { class: 'tree-children' }, kids.map(k =>
        treeItem({ id: k.id, icon: '📁', name: k.name, count: countIn(k.id), folder: k }))));
    }
    return wrap;
  }

  function renderTree() {
    const tree = $('#folderTree');
    tree.replaceChildren();
    tree.append(
      treeItem({ id: 'all', icon: '🗂️', name: 'All slides', count: state.slides.length }),
      treeItem({ id: 'fav', icon: '⭐', name: 'Favorites', count: state.slides.filter(s => s.favorite).length }),
      treeItem({ id: 'recent', icon: '🕒', name: 'Recently added', count: Math.min(12, state.slides.length) })
    );
    tree.append(h('div', { class: 'tree-label' }, 'Folders'));
    childrenOf('').forEach(f => tree.append(treeItem({ id: f.id, icon: '📁', name: f.name, count: countIn(f.id), folder: f })));
    const unfiled = state.slides.filter(s => !folderExists(s.folderId)).length;
    if (unfiled) tree.append(treeItem({ id: 'none', icon: '📄', name: 'Unfiled', count: unfiled }));
  }

  /* ---------- render: grid ---------- */
  function renderGrid() {
    const grid = $('#grid'), empty = $('#empty');
    grid.replaceChildren();
    $('#viewTitle').textContent = viewTitle();
    const list = visibleSlides();

    if (!list.length) {
      empty.classList.remove('hidden');
      empty.textContent = !apiReady()
        ? 'Connect your Apps Script URL in config.js to load your slides.'
        : state.slides.length
          ? 'No slides here yet.'
          : 'No slides yet. Click 🔒 Edit, enter your password, then “+ Add slide”.';
      return;
    }
    empty.classList.add('hidden');

    list.forEach(s => {
      const src = SOURCES[s.source] || { label: 'Link', icon: '🔗' };
      const conv = toEmbed(s.url);
      const thumb = h('div', { class: 'thumb' }, src.icon);
      if (conv && conv.thumb) {
        const img = h('img', { src: conv.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
        img.addEventListener('error', () => img.remove());
        thumb.append(img);
      }
      if (state.edit) {
        thumb.append(h('button', {
          class: 'fav-btn', title: 'Toggle favorite',
          onclick: e => { e.stopPropagation(); toggleFav(s); }
        }, s.favorite ? '⭐' : '☆'));
      } else if (s.favorite) {
        thumb.append(h('span', { class: 'fav' }, '⭐'));
      }

      const meta = h('div', { class: 'card-meta' },
        h('span', { class: 'badge' }, src.label),
        folderExists(s.folderId) ? h('span', { dir: 'auto' }, '📁 ' + byId(state.folders, s.folderId).name) : null
      );
      const tags = tagsOf(s);
      const card = h('div', { class: 'card', onclick: () => openViewer(s.id) },
        thumb,
        h('div', { class: 'card-body' },
          h('div', { class: 'card-title', dir: 'auto' }, s.title),
          meta,
          tags.length ? h('div', { class: 'card-meta' }, tags.map(t => h('span', { class: 'chip', dir: 'auto' }, '#' + t))) : null
        )
      );
      grid.append(card);
    });
  }

  function renderAll() {
    document.body.classList.toggle('edit', state.edit);
    $('#editToggle').textContent = state.edit ? '🔓 Editing' : '🔒 Edit';
    renderTree();
    renderGrid();
    if (!$('#viewer').classList.contains('hidden')) renderDetails();
  }

  /* ---------- viewer ---------- */
  let currentId = null;

  const siblings = s => state.slides
    .filter(x => (x.folderId || '') === (s.folderId || '')).sort(asc);

  function openViewer(id) {
    history.pushState({ viewer: 1 }, '', '#slide=' + id);
    showViewer(id);
  }

  function showViewer(id) {
    const s = byId(state.slides, id);
    if (!s) return hideViewer();
    currentId = id;
    $('#viewer').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const frame = $('#vFrame');
    if (frame.dataset.src !== s.embedUrl) {
      frame.dataset.src = s.embedUrl;
      frame.src = s.embedUrl;
    }
    $('#vTitle').textContent = s.title;
    $('#vOpen').href = s.url;
    const sib = siblings(s), i = sib.findIndex(x => x.id === id);
    const hasPrev = i > 0, hasNext = i >= 0 && i < sib.length - 1;
    [$('#vPrev'), $('#stagePrev')].forEach(b => { b.disabled = !hasPrev; b.style.visibility = hasPrev ? 'visible' : 'hidden'; });
    [$('#vNext'), $('#stageNext')].forEach(b => { b.disabled = !hasNext; b.style.visibility = hasNext ? 'visible' : 'hidden'; });
    renderDetails();
  }

  function hideViewer() {
    exitFull();
    currentId = null;
    $('#viewer').classList.add('hidden');
    const f = $('#vFrame');
    f.removeAttribute('data-src');
    f.src = 'about:blank';
    document.body.style.overflow = '';
  }

  function closeViewer() {
    if (history.state && history.state.viewer) history.back();
    else { history.replaceState(null, '', location.pathname + location.search); hideViewer(); }
  }

  function step(dir) {
    const s = byId(state.slides, currentId);
    if (!s) return;
    const sib = siblings(s), i = sib.findIndex(x => x.id === currentId);
    const next = sib[i + dir];
    if (next) { history.replaceState({ viewer: 1 }, '', '#slide=' + next.id); showViewer(next.id); }
  }

  function renderDetails() {
    const s = byId(state.slides, currentId);
    const box = $('#details');
    if (!s) return;
    const src = SOURCES[s.source] || { label: 'Link' };
    const tags = tagsOf(s);
    box.replaceChildren(
      h('h2', { dir: 'auto' }, s.title),
      h('div', { class: 'row' },
        h('span', { class: 'badge' }, src.label),
        folderExists(s.folderId) ? h('span', { class: 'muted', dir: 'auto' }, '📁 ' + folderPath(s.folderId)) : null
      ),
      tags.length ? h('div', { class: 'row' }, tags.map(t => h('span', { class: 'chip', dir: 'auto' }, '#' + t))) : null,
      s.notes ? h('div', { class: 'notes', dir: 'auto' }, s.notes) : null,
      h('div', { class: 'muted' }, 'Added ' + new Date(s.dateAdded).toLocaleDateString()),
      h('div', { class: 'row actions edit-only' },
        h('button', { onclick: () => toggleFav(s) }, s.favorite ? '⭐ Unfavorite' : '☆ Favorite'),
        h('button', { onclick: () => openDialog(s) }, '✎ Edit'),
        h('button', { class: 'danger', onclick: () => deleteSlide(s) }, '🗑 Delete')
      ),
      h('div', { class: 'muted' }, 'Shortcuts: F fullscreen · ← → previous/next · Esc close')
    );
  }

  /* fullscreen (with a fallback for browsers that cannot fullscreen an element, e.g. iPhone) */
  const stage = () => $('#stage');
  const fsSupported = () => !!(stage().requestFullscreen || stage().webkitRequestFullscreen);
  const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement) || stage().classList.contains('pseudo-full');

  function enterFull() {
    const st = stage();
    if (fsSupported()) (st.requestFullscreen || st.webkitRequestFullscreen).call(st);
    else st.classList.add('pseudo-full');
  }
  function exitFull() {
    stage().classList.remove('pseudo-full');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.webkitFullscreenElement && document.webkitExitFullscreen) document.webkitExitFullscreen();
  }
  const toggleFull = () => (isFull() ? exitFull() : enterFull());

  async function copyShare() {
    const link = location.origin + location.pathname + '#slide=' + currentId;
    try { await navigator.clipboard.writeText(link); toast('Link copied'); }
    catch (e) { prompt('Copy this link:', link); }
  }

  function route() {
    const m = location.hash.match(/slide=([\w-]+)/);
    if (m && byId(state.slides, m[1])) showViewer(m[1]);
    else if (!$('#viewer').classList.contains('hidden')) hideViewer();
  }

  /* ---------- slide actions ---------- */
  async function toggleFav(s) {
    const next = !s.favorite;
    s.favorite = next;
    renderAll();
    try { await apiPost('editSlide', { id: s.id, favorite: next }); saveCache(); }
    catch (e) { s.favorite = !next; renderAll(); toast(e.message, 'err'); }
  }

  async function deleteSlide(s) {
    if (!confirm(`Delete “${s.title}”? This removes it from the sheet.`)) return;
    try {
      await apiPost('deleteSlide', { id: s.id });
      state.slides = state.slides.filter(x => x.id !== s.id);
      saveCache();
      closeViewer();
      renderAll();
      toast('Slide deleted');
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------- folder actions ---------- */
  async function addFolder(parentId) {
    const where = parentId ? ` inside “${byId(state.folders, parentId).name}”` : '';
    const name = prompt('New folder name' + where + ':');
    if (!name || !name.trim()) return;
    try {
      const j = await apiPost('addFolder', { name: name.trim(), parentId: parentId || '' });
      state.folders.push(j.folder);
      if (parentId) state.collapsed.delete(parentId);
      saveCache(); renderAll(); toast('Folder created');
    } catch (e) { toast(e.message, 'err'); }
  }

  async function renameFolder(f) {
    const name = prompt('Rename folder:', f.name);
    if (!name || !name.trim() || name.trim() === f.name) return;
    try {
      await apiPost('renameFolder', { id: f.id, name: name.trim() });
      f.name = name.trim();
      saveCache(); renderAll();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function deleteFolder(f) {
    if (!confirm(`Delete folder “${f.name}”? Its slides move to “Unfiled” and subfolders move to the top level.`)) return;
    try {
      await apiPost('deleteFolder', { id: f.id });
      if (state.view === f.id) state.view = 'all';
      await refresh();
      toast('Folder deleted');
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---------- add / edit dialog ---------- */
  const dlg = () => $('#slideDialog');

  function fillFolderSelect(selected) {
    const sel = $('#fFolder');
    sel.replaceChildren(h('option', { value: '' }, '(No folder)'));
    const walk = (pid, depth) => childrenOf(pid).forEach(f => {
      sel.append(h('option', { value: f.id }, '\u00A0\u00A0'.repeat(depth) + (depth ? '↳ ' : '') + f.name));
      walk(f.id, depth + 1);
    });
    walk('', 0);
    sel.value = selected && folderExists(selected) ? selected : '';
  }

  function updatePreview() {
    const url = $('#fUrl').value.trim();
    const status = $('#urlStatus'), box = $('.preview-box'), frame = $('#fPreview');
    if (!url) { status.textContent = ''; status.className = 'status'; box.classList.remove('live'); frame.src = 'about:blank'; return; }
    const conv = toEmbed(url);
    if (!conv) {
      status.textContent = '✗ Not recognised. Use a Google Slides, Google Drive, OneDrive embed, or Canva “view” link.';
      status.className = 'status err';
      box.classList.remove('live'); frame.src = 'about:blank';
      return;
    }
    status.textContent = `✓ ${SOURCES[conv.source].label} detected. If the preview stays blank, set sharing to “Anyone with the link can view”.`;
    status.className = 'status ok';
    box.classList.add('live');
    if (frame.dataset.src !== conv.embedUrl) { frame.dataset.src = conv.embedUrl; frame.src = conv.embedUrl; }
  }

  function openDialog(slide) {
    state.editingId = slide ? slide.id : null;
    $('#dlgTitle').textContent = slide ? 'Edit slide' : 'Add slide';
    $('#fUrl').value = slide ? slide.url : '';
    $('#fTitle').value = slide ? slide.title : '';
    $('#fTags').value = slide ? slide.tags : '';
    $('#fNotes').value = slide ? slide.notes : '';
    const defaultFolder = slide ? slide.folderId : (folderExists(state.view) ? state.view : '');
    fillFolderSelect(defaultFolder);
    $('#fPreview').removeAttribute('data-src');
    updatePreview();
    dlg().showModal();
  }

  async function saveDialog(e) {
    e.preventDefault();
    const url = $('#fUrl').value.trim();
    if (!toEmbed(url)) { toast('That link type is not supported.', 'err'); return; }
    const data = {
      url,
      title: $('#fTitle').value.trim() || 'Untitled slide',
      folderId: $('#fFolder').value,
      tags: $('#fTags').value.trim(),
      notes: $('#fNotes').value.trim()
    };
    const btn = $('#fSave');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (state.editingId) {
        const j = await apiPost('editSlide', Object.assign({ id: state.editingId }, data));
        const i = state.slides.findIndex(s => s.id === state.editingId);
        if (i >= 0 && j.slide) state.slides[i] = j.slide;
        toast('Slide updated');
      } else {
        const j = await apiPost('addSlide', data);
        state.slides.push(j.slide);
        toast('Slide added');
      }
      saveCache();
      dlg().close();
      renderAll();
      if (currentId) showViewer(currentId);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false; btn.textContent = 'Save';
    }
  }

  /* ---------- edit mode ---------- */
  async function toggleEdit() {
    if (state.edit) {
      state.edit = false; state.token = '';
      sessionStorage.removeItem('slidelib_token');
      renderAll();
      return;
    }
    if (!apiReady()) { toast('Set API_URL in config.js first.', 'err'); return; }
    const pw = prompt('Admin password:');
    if (!pw) return;
    state.token = pw;
    try {
      await apiPost('auth', {});
      state.edit = true;
      sessionStorage.setItem('slidelib_token', pw);
      toast('Edit mode on');
    } catch (e) {
      state.token = '';
      toast(e.message, 'err');
    }
    renderAll();
  }

  /* ---------- theme + mobile menu ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('slidelib_theme', t);
  }
  const openMenu = () => { document.body.classList.add('menu-open'); $('#backdrop').classList.remove('hidden'); };
  const closeMenu = () => { document.body.classList.remove('menu-open'); $('#backdrop').classList.add('hidden'); };

  /* ---------- wire up ---------- */
  function init() {
    document.title = CFG.SITE_TITLE || 'Slide Library';
    $('#brand').textContent = '📚 ' + (CFG.SITE_TITLE || 'Slide Library');

    applyTheme(localStorage.getItem('slidelib_theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

    $('#themeBtn').onclick = () => applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    $('#menuBtn').onclick = openMenu;
    $('#backdrop').onclick = closeMenu;
    $('#editToggle').onclick = toggleEdit;
    $('#addSlideBtn').onclick = () => openDialog(null);
    $('#addFolderBtn').onclick = () => addFolder(folderExists(state.view) ? state.view : '');
    $('#search').addEventListener('input', e => { state.query = e.target.value; renderAll(); });

    $('#vClose').onclick = closeViewer;
    $('#vPrev').onclick = $('#stagePrev').onclick = () => step(-1);
    $('#vNext').onclick = $('#stageNext').onclick = () => step(1);
    $('#vFull').onclick = toggleFull;
    $('#stageExit').onclick = exitFull;
    $('#vShare').onclick = copyShare;

    $('#slideForm').addEventListener('submit', saveDialog);
    $('#fCancel').onclick = () => dlg().close();
    let t;
    $('#fUrl').addEventListener('input', () => { clearTimeout(t); t = setTimeout(updatePreview, 350); });
    dlg().addEventListener('close', () => { $('#fPreview').src = 'about:blank'; $('#fPreview').removeAttribute('data-src'); });

    document.addEventListener('keydown', e => {
      if ($('#viewer').classList.contains('hidden') || dlg().open) return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) return;
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleFull(); }
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'Escape') {
        if (stage().classList.contains('pseudo-full')) exitFull();
        else if (!isFull()) closeViewer();
      }
    });

    window.addEventListener('popstate', route);
    window.addEventListener('hashchange', route);

    // show cached data instantly, then refresh in the background
    try {
      const cached = JSON.parse(localStorage.getItem(CFG.CACHE_KEY) || 'null');
      if (cached) { state.slides = cached.slides || []; state.folders = cached.folders || []; }
    } catch (e) {}
    renderAll();
    route();

    if (!apiReady()) {
      const b = $('#banner');
      b.textContent = 'Almost there: paste your Apps Script Web app URL into config.js (API_URL), then reload.';
      b.classList.remove('hidden');
    } else {
      refresh(true);
    }
  }

  init();
})();
