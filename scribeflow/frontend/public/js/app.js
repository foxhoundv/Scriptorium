// ── VERSION ──
const APP_VERSION = '2.3';

const API = '';
let currentProject = null;
let currentDocId = null;
let saveTimer = null;
let ctxTarget = null;
let currentView = 'editor';

// ── UTILS ──
function countWords(html) {
  if (!html) return 0;
  const t = html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
  return t ? t.split(' ').filter(w=>w.length>0).length : 0;
}
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

// ── SAVE STATUS ──
function setSaveStatus(s) {
  const el = document.getElementById('save-status');
  el.className = s;
  if (s==='saving') el.textContent = '● Saving…';
  else if (s==='saved') { el.textContent = '✓ Saved'; setTimeout(()=>{ el.textContent='—'; el.className=''; }, 2000); }
  else el.textContent = '—';
}

// ── HOME SCREEN ──
async function showHome() {
  const hs = document.getElementById('home-screen');
  hs.style.display = 'flex';
  hs.style.opacity = '1';
  hs.style.pointerEvents = 'all';
  currentProject = null;
  currentDocId = null;
  document.getElementById('status-bar').classList.remove('project-open');
  // Always re-fetch from server so any projects added/restored on disk appear
  await loadProjectList();
}
function hideHome() {
  const hs = document.getElementById('home-screen');
  hs.style.opacity = '0';
  hs.style.pointerEvents = 'none';
  // Hide after transition
  setTimeout(() => { if (hs.style.opacity === '0') hs.style.display = 'none'; }, 220);
}

// ── PROJECT TYPE LABEL ──────────────────────────────────────────────────
const DOC_STYLE_LABELS = {
  novel:      'Novel',
  screenplay: 'Screenplay',
  nonfiction: 'Non-Fiction',
  shortstory: 'Short Story',
  poetry:     'Poetry',
  blank:      'Blank',
  research:   'Research',
};
const RESEARCH_TYPE_LABELS = {
  academics: 'Academics',
  pastoral:  'Pastoral Sermons',
};

function projectTypeLabel(docStyle, researchType) {
  if (!docStyle) return '';
  const styleLabel = DOC_STYLE_LABELS[docStyle] || docStyle;
  if (docStyle === 'research' && researchType) {
    const subLabel = RESEARCH_TYPE_LABELS[researchType] || researchType;
    return styleLabel + ' · ' + subLabel;   // "Research · Pastoral Sermons"
  }
  return styleLabel;
}

async function loadProjectList(retryCount = 0) {
  const list = document.getElementById('project-list');
  // Show loading state
  if (retryCount === 0) {
    list.innerHTML = '<div style="color:var(--sidebar-muted);font-family:JetBrains Mono,monospace;font-size:13px;padding:16px 0;">Loading projects…</div>';
  }
  try {
    const res = await fetch(`${API}/api/projects`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const projects = await res.json();
    if (!projects.length) {
      list.innerHTML = '<div style="color:var(--sidebar-muted);font-family:JetBrains Mono,monospace;font-size:13px;padding:16px 0;">No projects yet. Create one to get started.</div>';
      return;
    }
    list.innerHTML = projects.map(p => {
      const tl = projectTypeLabel(p.docStyle, p.researchType);
      const isSharedWithMe = p.accessRole && p.accessRole !== 'owner';
      const isSharedOut    = p.accessRole === 'owner' && (p.sharedWith||[]).length > 0;
      const badge = isSharedWithMe
        ? '<span class="pc-badge pc-badge-shared-me">shared with me</span>'
        : (isSharedOut ? '<span class="pc-badge pc-badge-shared-out">shared</span>' : '');
      return `<div class="project-card" data-id="${p.id}" data-access="${p.accessRole||'owner'}">
        <div class="pc-icon">📖</div>
        <div class="pc-info">
          <div class="pc-title">${escHtml(p.title)}${tl ? `<span class="pc-type">${escHtml(tl)}</span>` : ''}${badge}</div>
          <div class="pc-meta">Updated ${formatDate(p.updatedAt)}</div>
        </div>
        <span class="pc-wc">${p.wordCount.toLocaleString()} words</span>
        <button class="pc-settings" data-id="${p.id}" title="Project Settings" style="background:none;border:none;color:var(--sidebar-muted);cursor:pointer;padding:4px;border-radius:4px;opacity:0;transition:opacity 0.15s,color 0.15s;font-size:14px;">⚙</button>
        ${(p.accessRole||'owner')==='owner' ? `<button class="pc-delete" data-id="${p.id}" title="Delete project">🗑</button>` : ''}
      </div>`;
    }).join('');
    list.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.pc-delete') || e.target.closest('.pc-settings')) return;
        openProject(card.dataset.id);
      });
    });
    list.querySelectorAll('.pc-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this project permanently?')) return;
        await fetch(`${API}/api/projects/${btn.dataset.id}`, { method: 'DELETE' });
        loadProjectList();
      });
    });
    list.querySelectorAll('.pc-settings').forEach(btn => {
      btn.style.opacity = '0';
      btn.parentElement.addEventListener('mouseenter', () => btn.style.opacity = '1');
      btn.parentElement.addEventListener('mouseleave', () => btn.style.opacity = '0');
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await openProject(btn.dataset.id);
        openSettings();
      });
    });
  } catch(err) {
    if (retryCount < 4) {
      // Server may still be starting up — retry with back-off (1s, 2s, 4s, 8s)
      const delay = Math.pow(2, retryCount) * 1000;
      list.innerHTML = `<div style="color:var(--sidebar-muted);font-family:JetBrains Mono,monospace;font-size:13px;padding:16px 0;">Connecting… retrying in ${delay/1000}s</div>`;
      setTimeout(() => loadProjectList(retryCount + 1), delay);
    } else {
      list.innerHTML = '<div style="color:#e74c3c;font-family:JetBrains Mono,monospace;font-size:13px;padding:16px 0;">Could not reach server. Check that ScribeFlow is running.</div>';
    }
  }
}

document.getElementById('new-project-btn').addEventListener('click', async () => {
  const title = document.getElementById('new-project-title').value.trim();
  if (!title) return;
  const res = await fetch(`${API}/api/projects`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({title}) });
  const p = await res.json();
  await openProject(p.id);
  // Open settings on the Doc Style tab first so user picks a template,
  // then they can fill in General info before saving
  openSettings._pendingTab = 'style';
  openSettings();
});
document.getElementById('new-project-title').addEventListener('keydown', e => { if (e.key==='Enter') document.getElementById('new-project-btn').click(); });
document.getElementById('btn-home').addEventListener('click', showHome);

// ── OPEN PROJECT ──
async function openProject(id) {
  const res = await fetch(`${API}/api/projects/${id}`);
  currentProject = await res.json();
  hideHome();
  renderBinder();
  renderCorkboard();
  updateProjectWordCount();
  updateStatusBar();
  applyProjectLayout();
  scriptureInitialized = false; // reset so resize handles rebind for new project
  // Open first doc
  const firstDoc = findFirstDoc(currentProject.binder);
  if (firstDoc) selectDoc(firstDoc.id);
  else showEmptyState();
}

function findFirstDoc(node) {
  if (node.type === 'document') return node;
  if (node.children) for (const c of node.children) { const f = findFirstDoc(c); if (f) return f; }
  return null;
}

// ── BINDER ──
function renderBinder() {
  const tree = document.getElementById('binder-tree');
  tree.innerHTML = '';
  if (!currentProject) return;
  const root = currentProject.binder;
  for (const child of root.children) {
    tree.appendChild(renderBinderNode(child, 0));
  }
}

const folderIcons = { book: '📖', search: '🔍', folder: '📁', 'trash-2': '🗑', default: '📁' };
const docIcons = { 'file-text': '📄', default: '📄' };

function renderBinderNode(node, depth) {
  const wrap = document.createElement('div');
  if (node.children && node.children.length > 0 || node.type === 'folder' || node.type === 'trash') {
    // Folder
    const item = createBinderItem(node, depth, true);
    wrap.appendChild(item);
    const children = document.createElement('div');
    children.className = 'binder-children';
    children.style.display = node.expanded ? 'block' : 'none';
    if (node.children) node.children.forEach(c => children.appendChild(renderBinderNode(c, depth+1)));
    wrap.appendChild(children);
    item.querySelector('.bi-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      node.expanded = !node.expanded;
      item.querySelector('.bi-toggle').classList.toggle('open', node.expanded);
      children.style.display = node.expanded ? 'block' : 'none';
      saveBinderState();
    });
    if (node.expanded) item.querySelector('.bi-toggle').classList.add('open');
  } else {
    wrap.appendChild(createBinderItem(node, depth, false));
  }
  return wrap;
}

function createBinderItem(node, depth, isFolder) {
  const item = document.createElement('div');
  item.className = 'binder-item';
  item.dataset.id = node.id;
  item.dataset.type = node.type;
  if (node.id === currentDocId) item.classList.add('active');

  const indent = document.createElement('span');
  indent.className = 'bi-indent';
  indent.style.width = (depth * 14 + 4) + 'px';

  const toggle = document.createElement('span');
  toggle.className = 'bi-toggle';
  toggle.innerHTML = isFolder ? '▶' : '';

  const icon = document.createElement('span');
  icon.className = 'bi-icon';
  if (isFolder || node.type === 'folder' || node.type === 'trash') {
    icon.textContent = folderIcons[node.icon] || '📁';
  } else {
    icon.textContent = docIcons[node.icon] || '📄';
  }

  const label = document.createElement('span');
  label.className = 'bi-label';
  label.textContent = node.title;

  const ctx = document.createElement('span');
  ctx.className = 'bi-ctx';
  ctx.textContent = '⋯';

  item.append(indent, toggle, icon, label, ctx);

  if (node.type === 'document') {
    item.addEventListener('click', () => selectDoc(node.id));
  }

  ctx.addEventListener('click', (e) => { e.stopPropagation(); showCtxMenu(e, node); });
  item.addEventListener('contextmenu', (e) => { e.preventDefault(); showCtxMenu(e, node); });

  return item;
}

async function saveBinderState() {
  if (!currentProject) return;
  await fetch(`${API}/api/projects/${currentProject.id}`, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ binder: currentProject.binder })
  });
}

// ── DOCUMENT SELECTION ──
async function selectDoc(docId) {
  currentDocId = docId;
  const doc = currentProject.documents[docId];
  if (!doc) return;

  // Update active state in binder
  document.querySelectorAll('.binder-item').forEach(el => el.classList.toggle('active', el.dataset.id === docId));

  // Show editor
  document.getElementById('editor-wrap').style.display = 'flex';
  document.getElementById('empty-state').style.display = 'none';

  // Set content
  document.getElementById('doc-title-input').value = doc.title || '';
  const editor = document.getElementById('editor');
  editor.innerHTML = doc.content || '';

  // Inspector
  document.getElementById('ins-synopsis').value = doc.synopsis || '';
  document.getElementById('ins-notes-text').value = doc.notes || '';
  document.getElementById('ins-label').value = doc.label || 'none';
  document.getElementById('ins-status').value = doc.status || 'draft';
  document.getElementById('ins-compile').checked = doc.includeInCompile !== false;
  document.getElementById('ins-target-words').value = doc.targetWordCount || '';

  updateStats();
}

function showEmptyState() {
  document.getElementById('editor-wrap').style.display = 'none';
  document.getElementById('empty-state').style.display = 'flex';
}

// ── AUTO-SAVE ──
async function saveCurrentDoc() {
  if (!currentProject || !currentDocId) return;
  setSaveStatus('saving');
  const content = getEditorContent();
  const title = document.getElementById('doc-title-input').value.trim();
  const payload = {
    content,
    title: title || 'Untitled',
    synopsis: document.getElementById('ins-synopsis').value,
    notes: document.getElementById('ins-notes-text').value,
    label: document.getElementById('ins-label').value,
    status: document.getElementById('ins-status').value,
    includeInCompile: document.getElementById('ins-compile').checked,
    targetWordCount: parseInt(document.getElementById('ins-target-words').value) || 0
  };
  try {
    const res = await fetch(`${API}/api/documents/${currentProject.id}/${currentDocId}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    const updated = await res.json();
    currentProject.documents[currentDocId] = updated;
    // Update binder title if changed
    if (title) updateNodeTitle(currentProject.binder, currentDocId, title);
    renderBinder();
    updateStats();
    updateProjectWordCount();
    updateStatusBar();
    renderCorkboard();
    setSaveStatus('saved');
  } catch(e) { setSaveStatus(''); }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrentDoc, 1500);
}

function getEditorContent() {
  const editor = document.getElementById('editor');
  let content = editor.innerHTML;
  // Firefox adds a trailing <br> to empty contenteditable — strip it
  content = content.replace(/^<br\s*\/?>$/i, '');
  // Also normalize multiple consecutive <br> at end
  content = content.replace(/(<br\s*\/?>\s*)+$/i, '');
  return content;
}

document.getElementById('editor').addEventListener('input', scheduleSave);
document.getElementById('doc-title-input').addEventListener('input', scheduleSave);
document.getElementById('ins-synopsis').addEventListener('input', scheduleSave);
document.getElementById('ins-notes-text').addEventListener('input', scheduleSave);
document.getElementById('ins-label').addEventListener('change', saveCurrentDoc);
document.getElementById('ins-status').addEventListener('change', saveCurrentDoc);
document.getElementById('ins-compile').addEventListener('change', saveCurrentDoc);
document.getElementById('ins-target-words').addEventListener('input', scheduleSave);

function updateNodeTitle(node, id, title) {
  if (node.id === id) { node.title = title; return; }
  if (node.children) node.children.forEach(c => updateNodeTitle(c, id, title));
}

// ── STATS ──
function updateStats() {
  if (!currentDocId || !currentProject) return;
  const doc = currentProject.documents[currentDocId];
  if (!doc) return;
  const content = getEditorContent();
  const wc = countWords(content);
  const text = content.replace(/<[^>]*>/g, '');
  const chars = text.replace(/\s/g, '').length;
  const paras = (content.match(/<p/g) || []).length;
  const readMin = Math.max(1, Math.round(wc / 200));
  document.getElementById('stat-words').textContent = wc.toLocaleString();
  document.getElementById('stat-chars').textContent = chars.toLocaleString();
  document.getElementById('stat-paras').textContent = paras;
  document.getElementById('stat-read').textContent = readMin + ' min';
  const target = parseInt(document.getElementById('ins-target-words').value) || 0;
  document.getElementById('stat-target-label').textContent = `${wc.toLocaleString()} / ${target.toLocaleString()} words`;
  document.getElementById('stat-progress').style.width = target ? Math.min(100, Math.round(wc/target*100)) + '%' : '0%';
  document.getElementById('stat-proj-words').textContent = Object.values(currentProject.documents).reduce((s,d) => s + (d.wordCount || 0), 0).toLocaleString();
  const wcEl = document.getElementById('project-wordcount');
  if (wcEl) wcEl.textContent = wc.toLocaleString() + ' words';
}

function updateProjectWordCount() {
  if (!currentProject) return;
  const total = Object.values(currentProject.documents).reduce((s,d) => s + (d.wordCount||0), 0);
  document.getElementById('project-wordcount').textContent = total.toLocaleString() + ' words';
}

document.getElementById('editor').addEventListener('keyup', updateStats);
document.getElementById('editor').addEventListener('input', updateStats);

// ── CROSS-BROWSER RICH TEXT ENGINE ──
// Replaces deprecated execCommand with Selection/Range API for Firefox/Chrome/Brave/Edge

function editorExec(cmd, value) {
  const editor = document.getElementById('editor');
  editor.focus();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  // execCommand for inline styles is supported in all browsers for contenteditable
  // (bold, italic, underline, lists, justification) - it is deprecated API but
  // all browsers still implement it. The alternative (Selection API + CSS) is
  // significantly more complex and inconsistent. We use it with saved selection
  // to ensure it works even if focus was briefly lost (Firefox).
  const inlineCmds = ['bold','italic','underline','strikeThrough','justifyLeft','justifyCenter','justifyRight','insertUnorderedList','insertOrderedList'];
  if (inlineCmds.includes(cmd)) {
    const sel = window.getSelection();
    let savedRange = null;
    if (sel && sel.rangeCount) savedRange = sel.getRangeAt(0).cloneRange();
    editor.focus();
    if (savedRange) {
      const sel2 = window.getSelection();
      sel2.removeAllRanges();
      sel2.addRange(savedRange);
    }
    document.execCommand(cmd, false, value || null);
    scheduleSave();
    return;
  }

  if (cmd === 'formatBlock') {
    wrapSelectionInBlock(value || 'p');
    scheduleSave();
    return;
  }

  if (cmd === 'insertHR') {
    insertNodeAtCursor(document.createElement('hr'));
    scheduleSave();
    return;
  }
}

function wrapSelectionInBlock(tag) {
  const editor = document.getElementById('editor');
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  const range = sel.getRangeAt(0);

  // Find the block-level ancestor within the editor
  let blockNode = range.commonAncestorContainer;
  while (blockNode && blockNode !== editor) {
    if (blockNode.nodeType === Node.ELEMENT_NODE) {
      const display = window.getComputedStyle(blockNode).display;
      if (display === 'block' || blockNode.parentNode === editor) break;
    }
    blockNode = blockNode.parentNode;
  }
  if (!blockNode || blockNode === editor) {
    // Selection is directly in editor, wrap selected content
    const newEl = document.createElement(tag);
    try {
      range.surroundContents(newEl);
    } catch(e) {
      // Partial selection — extract and wrap
      const frag = range.extractContents();
      newEl.appendChild(frag);
      range.insertNode(newEl);
    }
    // Move cursor inside
    const newRange = document.createRange();
    newRange.selectNodeContents(newEl);
    newRange.collapse(false);
    sel.removeAllRanges();
    sel.addRange(newRange);
    return;
  }

  // Replace tag of existing block node
  const newEl = document.createElement(tag);
  // Move all children
  while (blockNode.firstChild) newEl.appendChild(blockNode.firstChild);
  // Copy text alignment class if any
  if (blockNode.style && blockNode.style.textAlign) newEl.style.textAlign = blockNode.style.textAlign;
  blockNode.parentNode.replaceChild(newEl, blockNode);

  // Restore cursor at end of new element
  const newRange = document.createRange();
  newRange.selectNodeContents(newEl);
  newRange.collapse(false);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

function insertNodeAtCursor(node) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  // Move cursor after inserted node
  const newRange = document.createRange();
  newRange.setStartAfter(node);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

function insertHtmlAtCursor(htmlStr) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();

  // Parse the HTML string into a document fragment
  const temp = document.createElement('div');
  temp.innerHTML = htmlStr;
  const frag = document.createDocumentFragment();
  let lastNode = null;
  while (temp.firstChild) {
    lastNode = temp.firstChild;
    frag.appendChild(lastNode);
  }
  range.insertNode(frag);

  // Move cursor after last inserted node
  if (lastNode) {
    const newRange = document.createRange();
    newRange.setStartAfter(lastNode);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }
}

// ── FORMAT BAR EVENT HANDLERS ──
document.querySelectorAll('.fmt-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Prevent losing selection focus
  });
  btn.addEventListener('click', () => {
    document.getElementById('editor').focus();
    editorExec(btn.dataset.cmd);
  });
});

document.getElementById('fmt-hr').addEventListener('mousedown', e => e.preventDefault());
document.getElementById('fmt-hr').addEventListener('click', () => {
  document.getElementById('editor').focus();
  editorExec('insertHR');
});

document.getElementById('fmt-blockquote').addEventListener('mousedown', e => e.preventDefault());
document.getElementById('fmt-blockquote').addEventListener('click', () => {
  document.getElementById('editor').focus();
  wrapSelectionInBlock('blockquote');
  scheduleSave();
});

// Save selection when format picker gets focus, restore on change
let savedSelForFormat = null;
document.getElementById('fmt-block').addEventListener('focus', () => {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    savedSelForFormat = sel.getRangeAt(0).cloneRange();
  }
});
document.getElementById('fmt-block').addEventListener('change', (e) => {
  const editor = document.getElementById('editor');
  editor.focus();
  // Restore saved selection if we lost it due to focus change
  if (savedSelForFormat) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedSelForFormat);
    savedSelForFormat = null;
  }
  wrapSelectionInBlock(e.target.value);
  // Reset picker display
  e.target.value = e.target.value; // keep shown
});

// ── KEYBOARD SHORTCUTS ──
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrentDoc(); }
  if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  if (e.key === 'Escape') {
    if (document.body.classList.contains('distraction-free')) {
      document.body.classList.remove('distraction-free');
    }
    closeSettings();
    closeHlPopover();
    hideHlDropdown();
  }
});

// ── INSPECTOR TABS ──
document.querySelectorAll('.ins-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.ins-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ins-tab-panel').forEach(p => p.style.display = 'none');
    tab.classList.add('active');
    const panel = document.getElementById('ins-' + tab.dataset.tab);
    if (panel) panel.style.display = 'block';
  });
});

// ── VIEW SWITCHING ──
document.getElementById('btn-view-editor').addEventListener('click', () => {
  currentView = 'editor';
  document.getElementById('btn-view-editor').classList.add('active');
  document.getElementById('btn-view-corkboard').classList.remove('active');
  document.getElementById('editor-wrap').style.display = 'flex';
  document.getElementById('corkboard').style.display = 'none';
  document.getElementById('format-bar').style.display = 'flex';
  document.getElementById('inspector').style.display = 'flex';
});
document.getElementById('btn-view-corkboard').addEventListener('click', () => {
  currentView = 'corkboard';
  document.getElementById('btn-view-corkboard').classList.add('active');
  document.getElementById('btn-view-editor').classList.remove('active');
  document.getElementById('editor-wrap').style.display = 'none';
  document.getElementById('corkboard').style.display = 'flex';
  document.getElementById('format-bar').style.display = 'none';
  document.getElementById('inspector').style.display = 'none';
  renderCorkboard();
});

// ── CORKBOARD ──
function renderCorkboard() {
  const board = document.getElementById('corkboard');
  board.innerHTML = '';
  if (!currentProject) return;
  const docs = [];
  function collect(node) {
    if (node.type === 'document') docs.push({ node, doc: currentProject.documents[node.id] });
    if (node.children) node.children.forEach(c => { if (c.type !== 'trash') collect(c); });
  }
  collect(currentProject.binder);
  docs.forEach(({ node, doc }, i) => {
    if (!doc) return;
    const card = document.createElement('div');
    card.className = 'index-card' + (node.id === currentDocId ? ' active' : '');
    card.style.setProperty('--rot', (Math.sin(i * 7.3) * 1.2).toFixed(2));
    card.innerHTML = `
      <div class="ic-pin"></div>
      <div class="ic-header"><div class="ic-title">${escHtml(doc.title)}</div></div>
      <div class="ic-body"><div class="ic-synopsis">${escHtml(doc.synopsis || 'No synopsis yet.')}</div></div>
      <div class="ic-footer"><span>${doc.status || 'draft'}</span><span>${(doc.wordCount||0).toLocaleString()} w</span></div>
    `;
    card.addEventListener('click', () => {
      document.getElementById('btn-view-editor').click();
      selectDoc(node.id);
    });
    board.appendChild(card);
  });
}

// ── CONTEXT MENU ──
function showCtxMenu(e, node) {
  ctxTarget = node;
  const menu = document.getElementById('ctx-menu');
  menu.style.display = 'block';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  const isFolder = node.type !== 'document';
  document.getElementById('ctx-add-doc').style.display = isFolder ? 'flex' : 'none';
  document.getElementById('ctx-add-folder').style.display = isFolder ? 'flex' : 'none';
}
document.addEventListener('click', () => { document.getElementById('ctx-menu').style.display = 'none'; });

document.getElementById('ctx-add-doc').addEventListener('click', async () => {
  if (!ctxTarget || !currentProject) return;
  const res = await fetch(`${API}/api/documents/${currentProject.id}`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({title:'Untitled'})
  });
  const doc = await res.json();
  currentProject.documents[doc.id] = doc;
  ctxTarget.children = ctxTarget.children || [];
  ctxTarget.children.push({ id: doc.id, title: 'Untitled', type: 'document', icon: 'file-text', children: [] });
  ctxTarget.expanded = true;
  await saveBinderState();
  renderBinder();
  selectDoc(doc.id);
});

document.getElementById('ctx-add-folder').addEventListener('click', async () => {
  if (!ctxTarget || !currentProject) return;
  const { v4: uuid } = { v4: () => 'folder-' + Math.random().toString(36).substr(2,9) };
  const folderId = uuid();
  ctxTarget.children = ctxTarget.children || [];
  ctxTarget.children.push({ id: folderId, title: 'New Folder', type: 'folder', icon: 'folder', expanded: false, children: [] });
  ctxTarget.expanded = true;
  await saveBinderState();
  renderBinder();
});

document.getElementById('ctx-rename').addEventListener('click', () => {
  if (!ctxTarget) return;
  const item = document.querySelector(`.binder-item[data-id="${ctxTarget.id}"]`);
  if (!item) return;
  const labelEl = item.querySelector('.bi-label');
  const input = document.createElement('input');
  input.value = ctxTarget.title;
  labelEl.textContent = '';
  labelEl.appendChild(input);
  input.focus(); input.select();
  const done = async () => {
    const newTitle = input.value.trim() || ctxTarget.title;
    ctxTarget.title = newTitle;
    if (ctxTarget.type === 'document' && currentProject.documents[ctxTarget.id]) {
      currentProject.documents[ctxTarget.id].title = newTitle;
      await fetch(`${API}/api/documents/${currentProject.id}/${ctxTarget.id}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({title: newTitle})
      });
    }
    await saveBinderState();
    renderBinder();
  };
  input.addEventListener('blur', done);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
});

document.getElementById('ctx-delete').addEventListener('click', async () => {
  if (!ctxTarget || !currentProject) return;
  if (ctxTarget.type === 'root' || ctxTarget.type === 'trash') return;
  if (!confirm(`Delete "${ctxTarget.title}"?`)) return;
  if (ctxTarget.type === 'document') {
    await fetch(`${API}/api/documents/${currentProject.id}/${ctxTarget.id}`, { method: 'DELETE' });
    delete currentProject.documents[ctxTarget.id];
  }
  removeNodeFromBinder(currentProject.binder, ctxTarget.id);
  await saveBinderState();
  if (currentDocId === ctxTarget.id) { currentDocId = null; showEmptyState(); }
  renderBinder();
});

function removeNodeFromBinder(node, id) {
  if (node.children) {
    node.children = node.children.filter(c => c.id !== id);
    node.children.forEach(c => removeNodeFromBinder(c, id));
  }
}

// ── BINDER ADD BUTTON ──
document.getElementById('binder-add').addEventListener('click', async () => {
  if (!currentProject) return;
  const res = await fetch(`${API}/api/documents/${currentProject.id}`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({title:'Untitled'})
  });
  const doc = await res.json();
  currentProject.documents[doc.id] = doc;
  // Add to first manuscript folder or root
  const ms = currentProject.binder.children.find(c => c.type === 'folder' && c.title === 'Manuscript');
  const target = ms || currentProject.binder;
  target.children = target.children || [];
  target.children.push({ id: doc.id, title: 'Untitled', type: 'document', icon: 'file-text', children: [] });
  if (ms) ms.expanded = true;
  await saveBinderState();
  renderBinder();
  selectDoc(doc.id);
});

// ── EXPORT ──
document.getElementById('btn-export').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('export-menu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});

// Pending export state — set before the hotlink modal, consumed after
let _pendingExportFmt = null;

function doExport(fmt, removeHotlinks) {
  if (!currentProject) return;
  const qs = removeHotlinks ? '?removeHotlinks=1' : '';
  window.open(`${API}/api/export/${currentProject.id}/${fmt}${qs}`, '_blank');
}

function projectHasHotlinks() {
  const pages = getHlPages();
  if (!pages.length) return false;
  // Check if any current document content actually contains hl-widget spans
  const docs = currentProject ? Object.values(currentProject.documents) : [];
  return docs.some(d => d.content && d.content.includes('hl-widget'));
}

document.querySelectorAll('.export-item').forEach(item => {
  item.addEventListener('click', () => {
    if (!currentProject) return alert('Open a project first.');
    const fmt = item.dataset.format;
    document.getElementById('export-menu').style.display = 'none';

    // JSON backup always exports as-is — no hotlink replacement
    if (fmt === 'json') { doExport(fmt, false); return; }

    // If there are no hotlinks in the content, export directly
    if (!projectHasHotlinks()) { doExport(fmt, false); return; }

    // Show the hotlink choice modal
    _pendingExportFmt = fmt;
    const overlay = document.getElementById('export-hl-overlay');
    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('open'));
  });
});

// Hotlink modal buttons
document.getElementById('export-hl-keep').addEventListener('click', () => {
  closeExportHlModal();
  if (_pendingExportFmt) doExport(_pendingExportFmt, false);
  _pendingExportFmt = null;
});
document.getElementById('export-hl-replace').addEventListener('click', () => {
  closeExportHlModal();
  if (_pendingExportFmt) doExport(_pendingExportFmt, true);
  _pendingExportFmt = null;
});
document.getElementById('export-hl-cancel').addEventListener('click', () => {
  closeExportHlModal();
  _pendingExportFmt = null;
});
document.getElementById('export-hl-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('export-hl-overlay')) {
    closeExportHlModal();
    _pendingExportFmt = null;
  }
});
function closeExportHlModal() {
  const overlay = document.getElementById('export-hl-overlay');
  overlay.classList.remove('open');
  setTimeout(() => { if (!overlay.classList.contains('open')) overlay.style.display = 'none'; }, 200);
}

// ── DARK MODE ──
document.getElementById('btn-dark-mode').addEventListener('click', () => {
  document.body.classList.toggle('dark-mode');
  localStorage.setItem('scribeflow-dark', document.body.classList.contains('dark-mode'));
});
if (localStorage.getItem('scribeflow-dark') === 'true') document.body.classList.add('dark-mode');

// ── DISTRACTION FREE ──
document.getElementById('btn-distraction-free').addEventListener('click', () => {
  document.body.classList.toggle('distraction-free');
});

// ── HTML ESCAPE ──
function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── SCRIVENER IMPORT ──
document.getElementById('import-scriv-btn').addEventListener('click', () => {
  document.getElementById('import-scriv-input').click();
});

document.getElementById('import-scriv-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const progress = document.getElementById('import-progress');
  const progressText = document.getElementById('import-progress-text');
  const progressFill = document.getElementById('import-progress-fill');

  function setProgress(pct, msg) {
    progress.style.display = 'block';
    progressText.textContent = msg;
    progressFill.style.width = pct + '%';
  }

  try {
    setProgress(10, 'Reading file…');
    if (!window.JSZip) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    }
    const arrayBuffer = await file.arrayBuffer();
    setProgress(25, 'Unpacking archive…');

    let zip;
    try {
      zip = await JSZip.loadAsync(arrayBuffer);
    } catch(err) {
      const text = new TextDecoder().decode(arrayBuffer);
      await importScrivxXml(text, file.name.replace(/\.(scrivx|scriv)$/i, ''));
      setProgress(100, 'Import complete!');
      setTimeout(() => { progress.style.display = 'none'; loadProjectList(); }, 1500);
      return;
    }

    setProgress(40, 'Parsing project structure…');

    let scrivxFile = null;
    zip.forEach((path, entry) => {
      if (path.endsWith('.scrivx') && !scrivxFile) scrivxFile = entry;
    });
    if (!scrivxFile) {
      zip.forEach((path, entry) => {
        if ((path.endsWith('.xml') || path.includes('project')) && !scrivxFile) scrivxFile = entry;
      });
    }

    let projectTitle = file.name.replace(/\.(scriv|scrivx|zip)$/i, '');
    let xmlText = '';
    if (scrivxFile) { xmlText = await scrivxFile.async('text'); }

    setProgress(55, 'Reading document content…');
    const contentMap = {};
    const rtfPromises = [];
    zip.forEach((path, entry) => {
      if (!entry.dir && (path.includes('/Files/') || path.includes('/content')) && (path.endsWith('.rtf') || path.endsWith('.txt') || path.endsWith('.html'))) {
        const match = path.match(/(\d+)\.(rtf|txt|html)$/i);
        if (match) {
          const id = match[1];
          rtfPromises.push(entry.async('text').then(text => { contentMap[id] = { path, text, ext: match[2].toLowerCase() }; }));
        }
      }
    });
    await Promise.all(rtfPromises);
    setProgress(70, 'Converting documents…');

    const project = await buildProjectFromScriv(xmlText, projectTitle, contentMap);
    setProgress(85, 'Saving to ScribeFlow…');

    const createRes = await fetch(`${API}/api/projects`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ title: project.title })
    });
    const created = await createRes.json();
    const merged = { ...created, title: project.title, binder: project.binder, documents: project.documents };
    await fetch(`${API}/api/projects/${created.id}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(merged)
    });
    for (const [docId, doc] of Object.entries(project.documents)) {
      await fetch(`${API}/api/documents/${created.id}/${docId}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(doc)
      });
    }

    setProgress(100, `✓ Imported "${project.title}" — ${Object.keys(project.documents).length} documents`);
    setTimeout(() => { progress.style.display = 'none'; loadProjectList(); }, 2000);

  } catch(err) {
    console.error('Import error:', err);
    document.getElementById('import-progress-text').textContent = '✗ Import failed: ' + err.message;
    document.getElementById('import-progress-fill').style.background = '#e74c3c';
  }
});

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function rtfToHtml(rtf) {
  if (!rtf) return '';
  let text = rtf;
  text = text.replace(/\{\\rtf[\s\S]*?(?=\\pard|\\par\b|[^\\{])/m, '');
  text = text.replace(/\\b\b([\s\S]*?)\\b0\b/g, '<strong>$1</strong>');
  text = text.replace(/\\i\b([\s\S]*?)\\i0\b/g, '<em>$1</em>');
  text = text.replace(/\\ul\b([\s\S]*?)\\ulnone\b/g, '<u>$1</u>');
  text = text.replace(/\\par\b\s*/g, '</p><p>');
  text = text.replace(/\\pard[^\\]*/g, '');
  text = text.replace(/\\\w+[-]?\d*\s?/g, '');
  text = text.replace(/[{}]/g, '');
  text = text.trim();
  if (!text) return '';
  return '<p>' + text + '</p>';
}

async function buildProjectFromScriv(xmlText, title, contentMap) {
  const genId = () => 'imp-' + Math.random().toString(36).substr(2,12);
  const documents = {};
  const binderChildren = [];

  if (xmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, 'application/xml');
    const projEl = xml.querySelector('ScrivenerProject, Project');
    if (projEl && projEl.getAttribute('Title')) title = projEl.getAttribute('Title');

    const binderEl = xml.querySelector('Binder');
    if (binderEl) {
      function parseBinderItem(el) {
        const uuid = el.getAttribute('UUID') || el.getAttribute('ID') || genId();
        const type = el.getAttribute('Type') || 'Text';
        const titleEl = el.querySelector(':scope > Title');
        const itemTitle = titleEl ? titleEl.textContent.trim() : 'Untitled';

        if (type === 'Folder' || type === 'RootFolder') {
          const children = [];
          const childrenEl = el.querySelector(':scope > Children');
          if (childrenEl) childrenEl.querySelectorAll(':scope > BinderItem').forEach(child => { const p = parseBinderItem(child); if (p) children.push(p); });
          return { id: uuid, title: itemTitle, type: 'folder', icon: 'folder', expanded: true, children };
        } else {
          const docId = genId();
          let content = '';
          const contentEntry = contentMap[uuid] || Object.values(contentMap).find(c => c.path.includes(uuid));
          if (contentEntry) {
            if (contentEntry.ext === 'rtf') content = rtfToHtml(contentEntry.text);
            else if (contentEntry.ext === 'html') content = contentEntry.text;
            else content = '<p>' + contentEntry.text.replace(/\n\n+/g,'</p><p>').replace(/\n/g,'<br>') + '</p>';
          }
          const synopsisEl = el.querySelector(':scope > Synopsis');
          const notesEl = el.querySelector(':scope > Notes');
          documents[docId] = {
            id: docId, title: itemTitle, content,
            synopsis: synopsisEl ? synopsisEl.textContent.trim() : '',
            notes: notesEl ? notesEl.textContent.trim() : '',
            label: 'none', status: 'draft', includeInCompile: true,
            wordCount: countWords(content), targetWordCount: 0,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
          };
          return { id: docId, title: itemTitle, type: 'document', icon: 'file-text', children: [] };
        }
      }
      binderEl.querySelectorAll(':scope > BinderItem').forEach(item => { const p = parseBinderItem(item); if (p) binderChildren.push(p); });
    }
  }

  if (Object.keys(documents).length === 0) {
    const manuscriptChildren = [];
    const sorted = Object.entries(contentMap).sort((a,b) => a[0].localeCompare(b[0], undefined, {numeric:true}));
    for (const [id, entry] of sorted) {
      const docId = genId();
      let content = '';
      if (entry.ext === 'rtf') content = rtfToHtml(entry.text);
      else if (entry.ext === 'html') content = entry.text;
      else content = '<p>' + entry.text.replace(/\n\n+/g,'</p><p>').replace(/\n/g,'<br>') + '</p>';
      const docTitle = entry.path.split('/').pop().replace(/\.\w+$/, '') || ('Document ' + id);
      documents[docId] = {
        id: docId, title: docTitle, content, synopsis: '', notes: '',
        label: 'none', status: 'draft', includeInCompile: true,
        wordCount: countWords(content), targetWordCount: 0,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      };
      manuscriptChildren.push({ id: docId, title: docTitle, type: 'document', icon: 'file-text', children: [] });
    }
    binderChildren.push({ id: genId(), title: 'Manuscript', type: 'folder', icon: 'book', expanded: true, children: manuscriptChildren });
  }

  binderChildren.push({ id: genId(), title: 'Trash', type: 'trash', icon: 'trash-2', expanded: false, children: [] });
  return { title, binder: { id: genId(), title: 'Root', type: 'root', children: binderChildren }, documents };
}

async function importScrivxXml(xmlText, title) {
  const project = await buildProjectFromScriv(xmlText, title, {});
  const createRes = await fetch(`${API}/api/projects`, {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ title: project.title })
  });
  const created = await createRes.json();
  const merged = { ...created, title: project.title, binder: project.binder, documents: project.documents };
  await fetch(`${API}/api/projects/${created.id}`, {
    method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(merged)
  });
}


// ── PROJECT SETTINGS ──
let settingsOpen = false;

function openSettings() {
  if (!currentProject) { alert('Open a project first.'); return; }

  // Show the overlay immediately (before field population so any JS error
  // in the data-fill code doesn't prevent the modal from appearing at all)
  const overlay = document.getElementById('settings-overlay');
  overlay.style.display = 'flex';
  overlay.classList.add('open');
  settingsOpen = true;

  const s = currentProject.settings || {};
  document.getElementById('settings-project-name').textContent = currentProject.title;

  // Goals
  document.getElementById('goal-final-wc').value = s.finalWordCount || '';
  document.getElementById('goal-daily-wc').value = s.dailyWordGoal || '';
  document.getElementById('goal-deadline').value = s.deadline || '';

  // General
  document.getElementById('settings-title-input').value = currentProject.title || '';
  document.getElementById('settings-desc-input').value = currentProject.description || '';
  document.getElementById('settings-author-input').value = s.author || '';

  // Hot-links toggle state
  const hlToggle = document.getElementById('hl-enabled-toggle');
  const hlEnabled = s.hlEnabled !== false; // default on
  if (hlToggle) {
    hlToggle.checked = hlEnabled;
    const hlBody = document.getElementById('hl-body');
    if (hlBody) hlBody.style.display = hlEnabled ? 'block' : 'none';
  }

  updateGoalProgress();
  renderHlPagesList();
  populateHlDocPicker();
  renderStyleGrid();
  renderResearchTypeTab();
  showResearchTypeNavItem();
  initQuickAddList('char-list',  'char-summary',  'char-create-btn',  'Character');
  initQuickAddList('place-list', 'place-summary', 'place-create-btn', 'Place');

  // Default to General tab on open (unless a specific tab was requested)
  openSettings._pendingTab = openSettings._pendingTab || 'general';
  document.querySelectorAll('.sn-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
  const targetTab = document.querySelector('.sn-item[data-section="' + openSettings._pendingTab + '"]');
  const targetSection = document.getElementById('section-' + openSettings._pendingTab);
  if (targetTab) targetTab.classList.add('active');
  if (targetSection) targetSection.classList.add('active');
  openSettings._pendingTab = null; // reset for next open
}

function closeSettings() {
  const overlay = document.getElementById('settings-overlay');
  overlay.classList.remove('open');
  overlay.style.display = 'none';
  settingsOpen = false;
}

function updateGoalProgress() {
  if (!currentProject) return;
  const totalWc = Object.values(currentProject.documents).reduce((s,d) => s + (d.wordCount||0), 0);
  const s = currentProject.settings || {};

  const finalGoal = parseInt(document.getElementById('goal-final-wc').value) || parseInt(s.finalWordCount) || 0;
  const finalPct = finalGoal ? Math.min(100, Math.round(totalWc / finalGoal * 100)) : 0;
  document.getElementById('goal-final-current').textContent = totalWc.toLocaleString() + ' written';
  document.getElementById('goal-final-pct').textContent = finalPct + '%';
  const finalFill = document.getElementById('goal-final-fill');
  finalFill.style.width = finalPct + '%';
  finalFill.classList.toggle('complete', finalPct >= 100);

  const dailyGoal = parseInt(document.getElementById('goal-daily-wc').value) || parseInt(s.dailyWordGoal) || 0;
  const todayKey = new Date().toISOString().slice(0,10);
  const todayWc = (s.dailyLog && s.dailyLog[todayKey]) || 0;
  const dailyPct = dailyGoal ? Math.min(100, Math.round(todayWc / dailyGoal * 100)) : 0;
  document.getElementById('goal-daily-current').textContent = todayWc.toLocaleString() + ' today';
  document.getElementById('goal-daily-pct').textContent = dailyPct + '%';
  const dailyFill = document.getElementById('goal-daily-fill');
  dailyFill.style.width = dailyPct + '%';
  dailyFill.classList.toggle('complete', dailyPct >= 100);

  // Deadline hint
  const deadline = document.getElementById('goal-deadline').value || s.deadline;
  const hintEl = document.getElementById('goal-deadline-hint');
  if (deadline) {
    const days = Math.ceil((new Date(deadline) - new Date()) / 86400000);
    const wordsLeft = Math.max(0, finalGoal - totalWc);
    const wpd = days > 0 ? Math.ceil(wordsLeft / days) : 0;
    hintEl.textContent = days > 0
      ? `${days} days until deadline · ${wpd.toLocaleString()} words/day needed`
      : days === 0 ? 'Deadline is today!' : `Deadline passed ${Math.abs(days)} days ago`;
  } else { hintEl.textContent = ''; }
}

document.getElementById('goal-final-wc').addEventListener('input', updateGoalProgress);
document.getElementById('goal-daily-wc').addEventListener('input', updateGoalProgress);
document.getElementById('goal-deadline').addEventListener('input', updateGoalProgress);

async function saveSettings() {
  if (!currentProject) return;
  const s = currentProject.settings || {};
  const hlToggle = document.getElementById('hl-enabled-toggle');
  // Only set docStyle once (on first save after project creation)
  const selectedStyleEl = document.querySelector('#style-grid .style-card.selected');
  const chosenStyle = selectedStyleEl ? selectedStyleEl.dataset.styleId : (s.docStyle || null);
  const isNewStyle = !s.docStyle && chosenStyle;

  currentProject.settings = {
    ...s,
    finalWordCount: parseInt(document.getElementById('goal-final-wc').value) || 0,
    dailyWordGoal: parseInt(document.getElementById('goal-daily-wc').value) || 0,
    deadline: document.getElementById('goal-deadline').value || '',
    author: document.getElementById('settings-author-input').value.trim(),
    hlEnabled: hlToggle ? hlToggle.checked : true,
    docStyle: chosenStyle,
  };

  // Read Research Type selection
  const selectedRTypeEl = document.querySelector('#rtype-grid .rtype-card.selected');
  const chosenResearchType = selectedRTypeEl ? selectedRTypeEl.dataset.rtype : (s.researchType || null);
  currentProject.settings.researchType = chosenResearchType;

  // Apply binder structure if this is the first time a style is set
  if (isNewStyle) applyDocStyleBinder(chosenStyle);
  currentProject.title = document.getElementById('settings-title-input').value.trim() || currentProject.title;
  currentProject.description = document.getElementById('settings-desc-input').value.trim();

  await fetch(`${API}/api/projects/${currentProject.id}`, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      title: currentProject.title,
      description: currentProject.description,
      settings: currentProject.settings,
      binder: currentProject.binder
    })
  });
  closeSettings();
  updateProjectWordCount();
  updateStatusBar();
  applyProjectLayout();
  showResearchTypeNavItem();
}

// Settings listeners are bound in initSettingsListeners() called after the
// settings HTML is in the DOM (settings HTML is placed before this <script>).
function initSettingsListeners() {
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('settings-close').addEventListener('click', (e) => { e.stopPropagation(); closeSettings(); });
  document.getElementById('settings-cancel').addEventListener('click', (e) => { e.stopPropagation(); closeSettings(); });
  document.getElementById('settings-save').addEventListener('click', (e) => { e.stopPropagation(); saveSettings(); });

  // Single delegated handler on overlay: nav tabs + backdrop close
  document.getElementById('settings-overlay').addEventListener('click', (e) => {
    // Close/cancel/save buttons — already handled above via stopPropagation, won't reach here
    // Nav tab switch
    const item = e.target.closest('.sn-item');
    if (item) {
      document.querySelectorAll('.sn-item').forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.settings-section').forEach(s => s.classList.remove('active'));
      item.classList.add('active');
      const section = document.getElementById('section-' + item.dataset.section);
      if (section) section.classList.add('active');
      return;
    }
    // Backdrop click to close
    if (e.target === document.getElementById('settings-overlay')) closeSettings();
  });

  // Hot-links toggle
  const hlToggle = document.getElementById('hl-enabled-toggle');
  if (hlToggle) {
    hlToggle.addEventListener('change', () => {
      const enabled = hlToggle.checked;
      document.getElementById('hl-body').style.display = enabled ? 'block' : 'none';
      if (currentProject) {
        currentProject.settings = currentProject.settings || {};
        currentProject.settings.hlEnabled = enabled;
      }
    });
  }
}

// Also open settings from home screen — add a settings icon on project cards
function addSettingsToProjectCard(card, projectId) {
  // handled inline
}

// ── HOT-LINKS ──

function getHlPages() {
  if (!currentProject) return [];
  return (currentProject.settings && currentProject.settings.hlPages) || [];
}

function saveHlPages(pages) {
  if (!currentProject) return;
  currentProject.settings = currentProject.settings || {};
  currentProject.settings.hlPages = pages;
}

function renderHlPagesList() {
  const list = document.getElementById('hl-pages-list');
  const pages = getHlPages();
  if (!pages.length) {
    list.innerHTML = '<div style="color:var(--text3);font-family:JetBrains Mono,monospace;font-size:12px;padding:12px 0;">No hot-links yet. Add characters, places, or items below.</div>';
    return;
  }
  list.innerHTML = pages.map((p, i) => `
    <div class="hl-page-row">
      <span class="hl-page-type ${p.type}">${p.type === 'character' ? '👤' : p.type === 'place' ? '📍' : '📦'} ${p.type}</span>
      <span class="hl-page-name">${escHtml(p.name)}</span>
      <span class="hl-fallback-label" title="Name upon removal">→</span>
      <input class="hl-page-fallback" data-index="${i}" value="${escHtml(p.fallbackName || '')}" placeholder="${escHtml(p.name)}" title="Name upon hot-link removal" />
      <span class="hl-page-doc">${escHtml(getDocTitle(p.docId))}</span>
      <button class="hl-page-del" data-index="${i}" title="Remove">✕</button>
    </div>
  `).join('');

  // Save fallback name on change
  list.querySelectorAll('.hl-page-fallback').forEach(input => {
    input.addEventListener('change', () => {
      const pages = getHlPages();
      const idx = parseInt(input.dataset.index);
      if (pages[idx]) {
        pages[idx].fallbackName = input.value.trim();
        saveHlPages(pages);
        // Persist immediately
        if (currentProject) {
          fetch(`${API}/api/projects/${currentProject.id}`, {
            method: 'PUT', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ settings: currentProject.settings, binder: currentProject.binder })
          });
        }
      }
    });
  });

  list.querySelectorAll('.hl-page-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const pages = getHlPages();
      pages.splice(parseInt(btn.dataset.index), 1);
      saveHlPages(pages);
      renderHlPagesList();
    });
  });
}

function getDocTitle(docId) {
  if (!currentProject || !docId) return '';
  const doc = currentProject.documents[docId];
  return doc ? doc.title : docId;
}

function populateHlDocPicker() {
  const sel = document.getElementById('hl-doc-select');
  sel.innerHTML = '<option value="">— link to document —</option>';
  if (!currentProject) return;
  const docs = [];
  function collect(node) {
    if (node.type === 'document') docs.push(node);
    if (node.children) node.children.forEach(c => { if (c.type !== 'trash') collect(c); });
  }
  collect(currentProject.binder);
  docs.forEach(node => {
    const opt = document.createElement('option');
    opt.value = node.id;
    opt.textContent = node.title;
    sel.appendChild(opt);
  });
}

document.getElementById('hl-add-btn').addEventListener('click', () => {
  const type         = document.getElementById('hl-type-select').value;
  const docId        = document.getElementById('hl-doc-select').value;
  const fallbackName = document.getElementById('hl-fallback-input').value.trim();
  if (!docId) { alert('Please select a document to link.'); return; }
  const docTitle = getDocTitle(docId);
  const pages = getHlPages();
  if (pages.find(p => p.docId === docId)) { alert('This document is already a hot-link.'); return; }
  pages.push({ type, name: docTitle, docId, fallbackName: fallbackName || '' });
  saveHlPages(pages);
  renderHlPagesList();
  // Clear fallback input after adding
  document.getElementById('hl-fallback-input').value = '';
});

// ── HOT-LINK AUTOCOMPLETE IN EDITOR ──
let hlTriggerActive = false;
let hlFilterText = '';
let hlSelectedIndex = 0;
let hlSavedRange = null;
let hlDropdownItems = [];

function getHlMatches(filter) {
  const pages = getHlPages();
  const fl = filter.toLowerCase();
  return pages.filter(p => !fl || p.name.toLowerCase().includes(fl)).slice(0, 10);
}

function showHlDropdown(range) {
  hlSavedRange = range;
  hlTriggerActive = true;
  hlFilterText = '';
  hlSelectedIndex = 0;
  document.getElementById('hl-filter-text').textContent = '';
  updateHlDropdown();
  positionHlDropdown();
  document.getElementById('hl-dropdown').classList.add('open');
}

function hideHlDropdown() {
  hlTriggerActive = false;
  hlFilterText = '';
  hlSelectedIndex = 0;
  document.getElementById('hl-dropdown').classList.remove('open');
  hlDropdownItems = [];
}

function positionHlDropdown() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const dd = document.getElementById('hl-dropdown');
  const ddH = 320;
  const top = rect.bottom + window.scrollY + 6;
  const left = rect.left + window.scrollX;
  const maxLeft = window.innerWidth - 360;
  dd.style.top = (top + ddH > window.innerHeight ? rect.top - ddH - 6 : top) + 'px';
  dd.style.left = Math.min(left, maxLeft) + 'px';
}

function updateHlDropdown() {
  hlDropdownItems = getHlMatches(hlFilterText);
  const list = document.getElementById('hl-dropdown-list');
  if (!hlDropdownItems.length) {
    list.innerHTML = '<div style="padding:12px 14px;font-family:JetBrains Mono,monospace;font-size:12px;color:var(--text3);">No matches found</div>';
    return;
  }
  list.innerHTML = hlDropdownItems.map((p, i) => `
    <div class="hl-drop-item ${i === hlSelectedIndex ? 'selected' : ''}" data-index="${i}">
      <span class="hl-drop-type hl-page-type ${p.type}">${p.type === 'character' ? '👤' : p.type === 'place' ? '📍' : '📦'}</span>
      <span class="hl-drop-name">${escHtml(p.name)}</span>
      <span class="hl-drop-hint">↵ insert</span>
    </div>
  `).join('');
  list.querySelectorAll('.hl-drop-item').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      insertHlWidget(hlDropdownItems[parseInt(el.dataset.index)]);
    });
    el.addEventListener('mouseover', () => {
      hlSelectedIndex = parseInt(el.dataset.index);
      updateHlDropdown();
    });
  });
}

function insertHlWidget(page) {
  hideHlDropdown();
  const editor = document.getElementById('editor');
  editor.focus();

  const sel = window.getSelection();
  if (!sel) return;

  // Restore the range saved when "hl/" was typed
  let range;
  if (hlSavedRange) {
    sel.removeAllRanges();
    sel.addRange(hlSavedRange);
    range = sel.getRangeAt(0);
  } else if (sel.rangeCount) {
    range = sel.getRangeAt(0);
  } else {
    return;
  }

  // Delete "hl/" + any filter text typed since trigger
  // The range is positioned right after "hl/", so we walk back through the text node
  const triggerLen = 3 + hlFilterText.length; // "hl/" + typed filter chars
  const container = range.startContainer;
  if (container.nodeType === Node.TEXT_NODE) {
    const start = Math.max(0, range.startOffset - triggerLen);
    const delRange = document.createRange();
    delRange.setStart(container, start);
    delRange.setEnd(container, range.startOffset);
    delRange.deleteContents();
    // Update range position
    range = document.createRange();
    range.setStart(container, start);
    range.collapse(true);
  } else {
    range.deleteContents();
  }

  // Build the widget element
  const typeLabel = page.type === 'character' ? '👤' : page.type === 'place' ? '📍' : '📦';
  const widget = document.createElement('span');
  widget.className = 'hl-widget';
  widget.contentEditable = 'false';
  widget.dataset.hlDoc = page.docId;
  widget.dataset.hlType = page.type;
  widget.dataset.hlName = page.name;

  const typeSpan = document.createElement('span');
  typeSpan.className = 'hl-w-type ' + page.type;
  typeSpan.textContent = typeLabel + ' ' + page.type;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'hl-w-name';
  nameSpan.textContent = ' ' + page.name;

  widget.appendChild(typeSpan);
  widget.appendChild(nameSpan);

  // Insert a zero-width space after widget so cursor can move past it
  const spacer = document.createTextNode('\u200B');

  // Insert both nodes at cursor position
  range.insertNode(spacer);
  range.insertNode(widget);

  // Move cursor after the spacer
  const newRange = document.createRange();
  newRange.setStartAfter(spacer);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);

  scheduleSave();
}

// Listen for "hl/" trigger in editor
document.getElementById('editor').addEventListener('keydown', (e) => {
  if (hlTriggerActive) {
    if (e.key === 'Escape') { e.preventDefault(); hideHlDropdown(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); hlSelectedIndex = Math.min(hlSelectedIndex + 1, hlDropdownItems.length - 1); updateHlDropdown(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); hlSelectedIndex = Math.max(hlSelectedIndex - 1, 0); updateHlDropdown(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (hlDropdownItems[hlSelectedIndex]) insertHlWidget(hlDropdownItems[hlSelectedIndex]);
      return;
    }
    if (e.key === 'Backspace') {
      if (hlFilterText.length === 0) { hideHlDropdown(); return; }
      hlFilterText = hlFilterText.slice(0, -1);
      document.getElementById('hl-filter-text').textContent = hlFilterText;
      updateHlDropdown();
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      hlFilterText += e.key;
      document.getElementById('hl-filter-text').textContent = hlFilterText;
      updateHlDropdown();
      positionHlDropdown();
    }
  }
});

document.getElementById('editor').addEventListener('input', () => {
  if (hlTriggerActive) return;
  // Check if hot-links are enabled for this project
  if (currentProject && currentProject.settings && currentProject.settings.hlEnabled === false) return;
  // Detect "hl/" typed — works cross-browser via input event + text inspection
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  const textBefore = node.textContent.slice(0, range.startOffset);
  if (textBefore.endsWith('hl/')) {
    // Save a range pointing right after "hl/" so we can delete from there
    const savedRange = document.createRange();
    savedRange.setStart(node, range.startOffset);
    savedRange.setEnd(node, range.startOffset);
    showHlDropdown(savedRange);
  }
});

// Click on hl-widget opens popover
document.getElementById('editor').addEventListener('click', (e) => {
  const widget = e.target.closest('.hl-widget');
  if (widget) {
    e.preventDefault();
    e.stopPropagation();
    openHlPopover(widget);
  }
});

function openHlPopover(widget) {
  const docId = widget.dataset.hlDoc;
  const type = widget.dataset.hlType;
  const name = widget.dataset.hlName;
  const doc = currentProject && currentProject.documents[docId];

  const popover = document.getElementById('hl-popover');
  const typeEl = document.getElementById('hl-popover-type');
  typeEl.textContent = type === 'character' ? '👤 Character' : type === 'place' ? '📍 Place' : '📦 Item';
  typeEl.className = 'hl-page-type ' + type;
  document.getElementById('hl-popover-title').textContent = name;
  document.getElementById('hl-popover-synopsis').textContent = doc ? (doc.synopsis || 'No synopsis yet.') : 'Document not found.';
  document.getElementById('hl-popover-notes').textContent = doc ? (doc.notes || '') : '';

  const gotoBtn = document.getElementById('hl-popover-goto');
  gotoBtn.onclick = () => { if (doc) { selectDoc(docId); closeHlPopover(); } };

  // Position near widget
  const rect = widget.getBoundingClientRect();
  const pop = popover;
  pop.style.left = Math.min(rect.left, window.innerWidth - 340) + 'px';
  pop.style.top = (rect.bottom + 8 + 320 > window.innerHeight ? rect.top - 320 - 8 : rect.bottom + 8) + 'px';
  popover.classList.add('open');
}

function closeHlPopover() {
  document.getElementById('hl-popover').classList.remove('open');
}

document.getElementById('hl-popover-close').addEventListener('click', closeHlPopover);
document.addEventListener('click', (e) => {
  if (!e.target.closest('#hl-popover') && !e.target.closest('.hl-widget')) closeHlPopover();
  if (!e.target.closest('#hl-dropdown') && !e.target.closest('#editor')) {
    if (hlTriggerActive) hideHlDropdown();
  }
});

// Track daily word count when saving
const _origSaveCurrentDoc = saveCurrentDoc;
saveCurrentDoc = async function() {
  const prevWc = currentProject && currentDocId && currentProject.documents[currentDocId] ? (currentProject.documents[currentDocId].wordCount || 0) : 0;
  await _origSaveCurrentDoc();
  if (currentProject && currentDocId && currentProject.documents[currentDocId]) {
    const newWc = currentProject.documents[currentDocId].wordCount || 0;
    const diff = newWc - prevWc;
    if (diff > 0) {
      const todayKey = new Date().toISOString().slice(0,10);
      currentProject.settings = currentProject.settings || {};
      currentProject.settings.dailyLog = currentProject.settings.dailyLog || {};
      currentProject.settings.dailyLog[todayKey] = (currentProject.settings.dailyLog[todayKey] || 0) + diff;
      // Persist dailyLog so it's available even if settings are saved later
      fetch(`${API}/api/projects/${currentProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: currentProject.title,
          description: currentProject.description,
          settings: currentProject.settings,
          binder: currentProject.binder
        })
      }).catch(() => {});
    }
  }
};

// (Ctrl+, handled in main keyboard shortcuts above)


// ── BINDER RESIZE (cross-browser JS drag) ──
(function() {
  const handle = document.getElementById('binder-resize-handle');
  const binder = document.getElementById('binder');
  let dragging = false;
  let startX = 0;
  let startW = 0;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = binder.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  // Touch support
  handle.addEventListener('touchstart', (e) => {
    dragging = true;
    startX = e.touches[0].clientX;
    startW = binder.offsetWidth;
    handle.classList.add('dragging');
  }, { passive: true });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = e.clientX - startX;
    const newW = Math.min(400, Math.max(140, startW + delta));
    binder.style.width = newW + 'px';
  });

  document.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const delta = e.touches[0].clientX - startX;
    const newW = Math.min(400, Math.max(140, startW + delta));
    binder.style.width = newW + 'px';
  }, { passive: true });

  function stopDrag() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  document.addEventListener('mouseup', stopDrag);
  document.addEventListener('touchend', stopDrag);
})();


// ── STATUS BAR ──────────────────────────────────────────────────────────
function updateStatusBar() {
  const bar = document.getElementById('status-bar');
  if (!currentProject) { bar.classList.remove('project-open'); return; }
  bar.classList.add('project-open');

  const s = currentProject.settings || {};
  const finalGoal = parseInt(s.finalWordCount) || 0;
  const dailyGoal = parseInt(s.dailyWordGoal) || 0;

  // Show placeholder when no goals set
  if (!finalGoal && !dailyGoal) {
    document.getElementById('sb-daily-pct').textContent = '—';
    document.getElementById('sb-daily-wc').textContent = 'no daily goal';
    document.getElementById('sb-daily-fill').style.width = '0%';
    document.getElementById('sb-final-pct').textContent = '—';
    document.getElementById('sb-final-wc').textContent = 'no final goal';
    document.getElementById('sb-final-fill').style.width = '0%';
    document.getElementById('sb-deadline-chip').style.display = 'none';
    return;
  }

  const totalWc = Object.values(currentProject.documents)
    .reduce((sum, d) => sum + (d.wordCount || 0), 0);

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayWc  = (s.dailyLog && s.dailyLog[todayKey]) || 0;

  // Daily bar
  const dailyFill = document.getElementById('sb-daily-fill');
  const dailyPct  = document.getElementById('sb-daily-pct');
  const dailyWc   = document.getElementById('sb-daily-wc');
  if (dailyGoal) {
    const pct = Math.min(100, Math.round(todayWc / dailyGoal * 100));
    dailyFill.style.width = pct + '%';
    dailyFill.classList.toggle('complete', pct >= 100);
    dailyPct.textContent  = pct + '%';
    dailyWc.textContent   = todayWc.toLocaleString() + ' / ' + dailyGoal.toLocaleString();
  } else {
    dailyFill.style.width = '0%';
    dailyPct.textContent  = '—';
    dailyWc.textContent   = '';
  }

  // Final bar
  const finalFill = document.getElementById('sb-final-fill');
  const finalPct  = document.getElementById('sb-final-pct');
  const finalWc   = document.getElementById('sb-final-wc');
  if (finalGoal) {
    const pct = Math.min(100, Math.round(totalWc / finalGoal * 100));
    finalFill.style.width = pct + '%';
    finalFill.classList.toggle('complete', pct >= 100);
    finalPct.textContent  = pct + '%';
    finalWc.textContent   = totalWc.toLocaleString() + ' / ' + finalGoal.toLocaleString();
  } else {
    finalFill.style.width = '0%';
    finalPct.textContent  = '—';
    finalWc.textContent   = '';
  }

  // Deadline chip
  const chip = document.getElementById('sb-deadline-chip');
  if (s.deadline) {
    const days = Math.ceil((new Date(s.deadline) - new Date()) / 86400000);
    chip.style.display = '';
    chip.classList.remove('urgent', 'done');
    if (days < 0) {
      chip.textContent = 'Deadline passed';
      chip.classList.add('urgent');
    } else if (days === 0) {
      chip.textContent = 'Due today';
      chip.classList.add('urgent');
    } else if (days <= 7) {
      chip.textContent = days + 'd left';
      chip.classList.add('urgent');
    } else if (finalGoal && totalWc >= finalGoal) {
      chip.textContent = '✓ Goal reached';
      chip.classList.add('done');
    } else {
      chip.textContent = days + ' days left';
    }
  } else {
    chip.style.display = 'none';
  }
}


// ── DOCUMENT STYLES ────────────────────────────────────────────────────
const DOC_STYLES = [
  {
    id: 'novel',
    name: 'Novel',
    icon: '📖',
    desc: 'Manuscript, Research, Characters, Places folders',
    folders: ['Manuscript', 'Research', 'Characters', 'Places', 'Trash']
  },
  {
    id: 'screenplay',
    name: 'Screenplay',
    icon: '🎬',
    desc: 'Acts, Scenes, Characters, Research folders',
    folders: ['Act I', 'Act II', 'Act III', 'Characters', 'Research', 'Trash']
  },
  {
    id: 'nonfiction',
    name: 'Non-Fiction',
    icon: '📚',
    desc: 'Chapters, Research, Sources, Notes folders',
    folders: ['Chapters', 'Research', 'Sources', 'Notes', 'Trash']
  },
  {
    id: 'shortstory',
    name: 'Short Story',
    icon: '📄',
    desc: 'Story, Research, Notes folders',
    folders: ['Story', 'Research', 'Notes', 'Trash']
  },
  {
    id: 'poetry',
    name: 'Poetry',
    icon: '✍️',
    desc: 'Poems, Drafts, Inspiration folders',
    folders: ['Poems', 'Drafts', 'Inspiration', 'Trash']
  },
  {
    id: 'blank',
    name: 'Blank',
    icon: '🗒️',
    desc: 'Single folder, no preset structure',
    folders: ['Documents', 'Trash']
  },
  {
    id: 'research',
    name: 'Research',
    icon: '🔬',
    desc: 'Topics, Sources, Notes, References folders — choose Research Type after saving',
    folders: ['Topics', 'Sources', 'Notes', 'References', 'Trash']
  }
];

function renderStyleGrid() {
  const grid = document.getElementById('style-grid');
  const notice = document.getElementById('style-locked-notice');
  if (!grid) return;

  const s = currentProject ? (currentProject.settings || {}) : {};
  const chosen = s.docStyle || null;
  const isLocked = !!chosen; // style is locked once set

  grid.innerHTML = DOC_STYLES.map(st => `
    <div class="style-card ${chosen === st.id ? 'selected' : ''} ${isLocked ? 'locked' : ''}"
         data-style-id="${st.id}" title="${isLocked ? 'Style locked after project creation' : st.name}">
      ${chosen === st.id ? '<span class="sc-badge">Active</span>' : ''}
      <div class="sc-icon">${st.icon}</div>
      <div class="sc-name">${st.name}</div>
      <div class="sc-desc">${st.desc}</div>
    </div>
  `).join('');

  if (notice) notice.classList.toggle('show', isLocked);

  if (!isLocked) {
    grid.querySelectorAll('.style-card').forEach(card => {
      card.addEventListener('click', () => {
        grid.querySelectorAll('.style-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        if (currentProject) {
          currentProject.settings = currentProject.settings || {};
          currentProject.settings.docStyle = card.dataset.styleId;
        }
      });
    });
  }
}

function applyDocStyleBinder(styleId) {
  const style = DOC_STYLES.find(s => s.id === styleId);
  if (!style || !currentProject) return;
  const genId = () => 'f-' + Math.random().toString(36).substr(2, 9);

  // Build fresh binder based on style folders
  const children = style.folders.map(name => {
    const isTrash = name === 'Trash';
    return {
      id: genId(), title: name,
      type: isTrash ? 'trash' : 'folder',
      icon: isTrash ? 'trash-2' : name === 'Manuscript' || name === 'Story' || name === 'Poems' || name === 'Act I' ? 'book' : 'folder',
      expanded: !isTrash,
      children: []
    };
  });
  currentProject.binder = { id: 'root', title: 'Root', type: 'root', children };
}

// ── QUICK-ADD LISTS (Characters / Places) ───────────────────────────────
function initQuickAddList(listId, summaryId, btnId, type) {
  const wrap   = document.getElementById(listId);
  const sumEl  = document.getElementById(summaryId);
  const btn    = document.getElementById(btnId);
  if (!wrap) return;

  let rows = [];   // array of { el, input }

  function addRow(value) {
    const row = document.createElement('div');
    row.className = 'qalist-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'qalist-input';
    input.placeholder = value === undefined ? `New ${type} name…` : '';
    input.value = value || '';

    const del = document.createElement('button');
    del.className = 'qalist-del';
    del.title = 'Remove';
    del.innerHTML = '🗑';

    row.appendChild(input);
    row.appendChild(del);
    wrap.appendChild(row);

    const entry = { el: row, input };
    rows.push(entry);

    // Show delete button and next empty field as soon as user starts typing
    input.addEventListener('focus', () => {
      del.classList.add('show');
      // If this is the last row and it has content, add a fresh blank row
      const isLast = rows[rows.length - 1].input === input;
      if (isLast) addRow();
      updateSummary();
    });

    input.addEventListener('input', () => {
      const hasText = input.value.trim().length > 0;
      del.classList.toggle('show', hasText);
      updateSummary();
    });

    del.addEventListener('click', () => {
      row.remove();
      rows = rows.filter(r => r.el !== row);
      // Always ensure at least one blank row at end
      const lastInput = rows.length > 0 ? rows[rows.length - 1].input : null;
      if (!lastInput || lastInput.value.trim()) addRow();
      updateSummary();
    });

    return entry;
  }

  function updateSummary() {
    const names = rows.map(r => r.input.value.trim()).filter(Boolean);
    const count = names.length;
    if (sumEl) sumEl.textContent = count === 0 ? '' : `${count} ${type}${count !== 1 ? 's' : ''} will be created`;
    if (btn) btn.disabled = count === 0;
  }

  function getNames() {
    return rows.map(r => r.input.value.trim()).filter(Boolean);
  }

  function reset() {
    wrap.innerHTML = '';
    rows = [];
    addRow();
    updateSummary();
  }

  // Attach create button
  if (btn) {
    btn.addEventListener('click', async () => {
      const names = getNames();
      if (!names.length || !currentProject) return;
      await createQuickDocs(names, type);
      reset();
    });
  }

  // Expose reset and getNames on the wrapper for openSettings to call
  wrap._reset = reset;
  wrap._getNames = getNames;

  // Initialize with one blank row
  reset();
}

async function createQuickDocs(names, type) {
  if (!currentProject) return;

  // Find or create the correct folder in the binder
  const folderTitle = type === 'Character' ? 'Characters' : 'Places';
  let folder = findFolderByTitle(currentProject.binder, folderTitle);

  if (!folder) {
    const genId = () => 'qf-' + Math.random().toString(36).substr(2, 9);
    folder = { id: genId(), title: folderTitle, type: 'folder', icon: 'folder', expanded: true, children: [] };
    const trashIdx = currentProject.binder.children.findIndex(c => c.type === 'trash');
    if (trashIdx >= 0) currentProject.binder.children.splice(trashIdx, 0, folder);
    else currentProject.binder.children.push(folder);
  }
  folder.expanded = true;

  // hlType maps to the hot-link type string used in the hl system
  const hlType = type === 'Character' ? 'character' : 'place';
  const existingHlPages = getHlPages();
  const newHlEntries = [];

  for (const name of names) {
    // Create document via API
    const res = await fetch(`${API}/api/documents/${currentProject.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: name })
    });
    const doc = await res.json();
    currentProject.documents[doc.id] = doc;
    folder.children.push({ id: doc.id, title: name, type: 'document', icon: 'file-text', children: [] });

    // Auto-register as a hot-link if not already present
    const alreadyLinked = existingHlPages.some(p => p.docId === doc.id);
    if (!alreadyLinked) {
      // Default fallbackName to the full name — user can edit it in Hot-Links settings
      newHlEntries.push({ type: hlType, name, docId: doc.id, fallbackName: name });
    }
  }

  // Merge new entries into the hot-links list and persist
  if (newHlEntries.length) {
    const merged = [...existingHlPages, ...newHlEntries];
    saveHlPages(merged);
    // Persist settings to server immediately (hot-links live in settings)
    await fetch(`${API}/api/projects/${currentProject.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: currentProject.settings, binder: currentProject.binder })
    });
    // Refresh the Hot-Links panel UI if it's currently visible
    renderHlPagesList();
    populateHlDocPicker();
  }

  await saveBinderState();
  renderBinder();
  setSaveStatus('saved');
}

function findFolderByTitle(node, title) {
  if (node.type === 'folder' && node.title === title) return node;
  if (node.children) {
    for (const c of node.children) {
      const found = findFolderByTitle(c, title);
      if (found) return found;
    }
  }
  return null;
}


// ── RESEARCH TYPE ──────────────────────────────────────────────────────

function renderResearchTypeTab() {
  const s = currentProject ? (currentProject.settings || {}) : {};
  const chosen = s.researchType || null;
  const grid = document.getElementById('rtype-grid');
  if (!grid) return;

  // Mark selected card
  grid.querySelectorAll('.rtype-card').forEach(card => {
    const isSelected = card.dataset.rtype === chosen;
    card.classList.toggle('selected', isSelected);
    // Remove stale badge
    const old = card.querySelector('.rt-badge');
    if (old) old.remove();
    if (isSelected) {
      const badge = document.createElement('span');
      badge.className = 'rt-badge'; badge.textContent = 'Active';
      card.appendChild(badge);
    }
    // Bind click
    card.onclick = () => {
      grid.querySelectorAll('.rtype-card').forEach(c => {
        c.classList.remove('selected');
        const b = c.querySelector('.rt-badge'); if (b) b.remove();
      });
      card.classList.add('selected');
      const badge = document.createElement('span');
      badge.className = 'rt-badge'; badge.textContent = 'Active';
      card.appendChild(badge);
      document.getElementById('rtype-notice').classList.add('show');
    };
  });
}

function showResearchTypeNavItem() {
  const s = currentProject ? (currentProject.settings || {}) : {};
  const navItem = document.getElementById('sn-research-type');
  if (navItem) {
    navItem.style.display = s.docStyle === 'research' ? '' : 'none';
  }
}

// ── PROJECT LAYOUT ──────────────────────────────────────────────────────
// Called on openProject and after saveSettings to apply the correct UI layout

function applyProjectLayout() {
  if (!currentProject) return;
  const s = currentProject.settings || {};
  const isPastoral = s.docStyle === 'research' && s.researchType === 'pastoral';
  const pane = document.getElementById('scripture-pane');
  const editorWrap = document.getElementById('editor-wrap');
  if (isPastoral) {
    pane.classList.add('active');
    editorWrap.classList.add('sermon-split');
    initScripturePane();
  } else {
    pane.classList.remove('active');
    editorWrap.classList.remove('sermon-split');
  }
}

// ── SCRIPTURE PANE ──────────────────────────────────────────────────────
// ── BIBLE BOOK LISTS ────────────────────────────────────────────────────
const BIBLE_OT = [
  ['genesis','Genesis'],['exodus','Exodus'],['leviticus','Leviticus'],
  ['numbers','Numbers'],['deuteronomy','Deuteronomy'],['joshua','Joshua'],
  ['judges','Judges'],['ruth','Ruth'],['1-samuel','1 Samuel'],
  ['2-samuel','2 Samuel'],['1-kings','1 Kings'],['2-kings','2 Kings'],
  ['1-chronicles','1 Chronicles'],['2-chronicles','2 Chronicles'],
  ['ezra','Ezra'],['nehemiah','Nehemiah'],['esther','Esther'],['job','Job'],
  ['psalms','Psalms'],['proverbs','Proverbs'],['ecclesiastes','Ecclesiastes'],
  ['song-of-solomon','Song of Solomon'],['isaiah','Isaiah'],
  ['jeremiah','Jeremiah'],['lamentations','Lamentations'],['ezekiel','Ezekiel'],
  ['daniel','Daniel'],['hosea','Hosea'],['joel','Joel'],['amos','Amos'],
  ['obadiah','Obadiah'],['jonah','Jonah'],['micah','Micah'],['nahum','Nahum'],
  ['habakkuk','Habakkuk'],['zephaniah','Zephaniah'],['haggai','Haggai'],
  ['zechariah','Zechariah'],['malachi','Malachi']
];
const BIBLE_NT = [
  ['matthew','Matthew'],['mark','Mark'],['luke','Luke'],['john','John'],
  ['acts','Acts'],['romans','Romans'],['1-corinthians','1 Corinthians'],
  ['2-corinthians','2 Corinthians'],['galatians','Galatians'],
  ['ephesians','Ephesians'],['philippians','Philippians'],
  ['colossians','Colossians'],['1-thessalonians','1 Thessalonians'],
  ['2-thessalonians','2 Thessalonians'],['1-timothy','1 Timothy'],
  ['2-timothy','2 Timothy'],['titus','Titus'],['philemon','Philemon'],
  ['hebrews','Hebrews'],['james','James'],['1-peter','1 Peter'],
  ['2-peter','2 Peter'],['1-john','1 John'],['2-john','2 John'],
  ['3-john','3 John'],['jude','Jude'],['revelation','Revelation']
];
const BIBLE_CHAPTER_COUNTS = {
  'genesis':50,'exodus':40,'leviticus':27,'numbers':36,'deuteronomy':34,
  'joshua':24,'judges':21,'ruth':4,'1-samuel':31,'2-samuel':24,
  '1-kings':22,'2-kings':25,'1-chronicles':29,'2-chronicles':36,
  'ezra':10,'nehemiah':13,'esther':10,'job':42,'psalms':150,'proverbs':31,
  'ecclesiastes':12,'song-of-solomon':8,'isaiah':66,'jeremiah':52,
  'lamentations':5,'ezekiel':48,'daniel':12,'hosea':14,'joel':3,'amos':9,
  'obadiah':1,'jonah':4,'micah':7,'nahum':3,'habakkuk':3,'zephaniah':3,
  'haggai':2,'zechariah':14,'malachi':4,
  'matthew':28,'mark':16,'luke':24,'john':21,'acts':28,
  'romans':16,'1-corinthians':16,'2-corinthians':13,'galatians':6,
  'ephesians':6,'philippians':4,'colossians':4,
  '1-thessalonians':5,'2-thessalonians':3,
  '1-timothy':6,'2-timothy':4,'titus':3,'philemon':1,
  'hebrews':13,'james':5,'1-peter':5,'2-peter':3,
  '1-john':5,'2-john':1,'3-john':1,'jude':1,'revelation':22
};

// ── SCRIPTURE PANE INIT ─────────────────────────────────────────────────
let scriptureInitialized = false;

function initScripturePane() {
  if (scriptureInitialized) return;
  scriptureInitialized = true;

  loadBibleTranslations();
  initScriptureNavSelects();
  initScriptureResize();

  // Version change: re-load current chapter if one is selected
  document.getElementById('bible-version-select').addEventListener('change', () => {
    const book = document.getElementById('bible-book-select').value;
    const ch   = document.getElementById('bible-chapter-select').value;
    if (book && ch) loadChapter(book, parseInt(ch));
  });

  // Free-text lookup button and Enter key
  document.getElementById('bible-lookup-btn').addEventListener('click', () => {
    const ref = document.getElementById('bible-ref-input').value.trim();
    if (ref) lookupScripture(ref);
  });
  document.getElementById('bible-ref-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const ref = document.getElementById('bible-ref-input').value.trim();
      if (ref) lookupScripture(ref);
    }
  });
}

function initScriptureNavSelects() {
  const testSel  = document.getElementById('bible-testament-select');
  const bookSel  = document.getElementById('bible-book-select');
  const chapSel  = document.getElementById('bible-chapter-select');

  // Testament → populate books
  testSel.addEventListener('change', () => {
    const testament = testSel.value;
    bookSel.innerHTML = '<option value="">— Book —</option>';
    chapSel.innerHTML = '<option value="">— Ch —</option>';
    chapSel.disabled  = true;

    if (!testament) { bookSel.disabled = true; return; }
    const list = testament === 'ot' ? BIBLE_OT : BIBLE_NT;
    list.forEach(([slug, name]) => {
      const opt = document.createElement('option');
      opt.value = slug; opt.textContent = name;
      bookSel.appendChild(opt);
    });
    bookSel.disabled = false;
  });

  // Book → populate chapters
  bookSel.addEventListener('change', () => {
    const book = bookSel.value;
    chapSel.innerHTML = '<option value="">— Ch —</option>';
    if (!book) { chapSel.disabled = true; return; }
    const count = BIBLE_CHAPTER_COUNTS[book] || 1;
    for (let i = 1; i <= count; i++) {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = i;
      chapSel.appendChild(opt);
    }
    chapSel.disabled = false;
    // Auto-load chapter 1
    chapSel.value = '1';
    loadChapter(book, 1);
  });

  // Chapter → load
  chapSel.addEventListener('change', () => {
    const book = bookSel.value;
    const ch   = parseInt(chapSel.value);
    if (book && ch) loadChapter(book, ch);
  });
}

async function loadBibleTranslations() {
  try {
    const res = await fetch(`${API}/api/bible/translations`);
    if (!res.ok) return;
    const translations = await res.json();
    if (!translations.length) return;
    const sel = document.getElementById('bible-version-select');
    sel.innerHTML = translations.map(t =>
      `<option value="${t.id}">${t.label} — ${t.name}</option>`
    ).join('');
  } catch(e) { /* keep default KJV */ }
}

async function loadChapter(book, chapter) {
  const version   = document.getElementById('bible-version-select').value;
  const contentEl = document.getElementById('scripture-content');
  contentEl.innerHTML = '<div class="scripture-loading">Loading…</div>';
  try {
    const url = `${API}/api/bible/${encodeURIComponent(version)}/${encodeURIComponent(book)}/${chapter}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
    renderScriptureContent(data);
  } catch(err) {
    contentEl.innerHTML = buildScriptureError(err.message, '');
  }
}

async function lookupScripture(ref) {
  const version   = document.getElementById('bible-version-select').value;
  const contentEl = document.getElementById('scripture-content');
  const btn       = document.getElementById('bible-lookup-btn');
  contentEl.innerHTML = '<div class="scripture-loading">Looking up…</div>';
  btn.disabled = true;
  try {
    const url  = `${API}/api/bible/search?q=${encodeURIComponent(ref)}&trans=${encodeURIComponent(version)}`;
    const res  = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
    renderScriptureContent(data);
    // Sync dropdowns to match the looked-up reference
    syncDropdownsToRef(data.book, data.chapter);
  } catch(err) {
    contentEl.innerHTML = buildScriptureError(err.message, ref);
  } finally {
    btn.disabled = false;
  }
}

function renderScriptureContent(data) {
  const contentEl = document.getElementById('scripture-content');
  let inner = `<div class="scripture-book-title">${escHtml(data.reference)}`
    + ` <span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3);font-weight:400;">${escHtml(data.translation)}</span></div>`;
  inner += data.verses.map(v =>
    `<div class="scripture-verse"><span class="scripture-verse-num">${v.verse}</span>${escHtml(v.text)}</div>`
  ).join('');
  contentEl.innerHTML = inner;
  contentEl.scrollTop = 0;
  clampScripturePane();
}

function clampScripturePane() {
  const pane = document.getElementById('scripture-pane');
  const wrap = document.getElementById('editor-wrap');
  if (!pane || !wrap) return;
  const maxH = Math.floor(wrap.offsetHeight * 0.50);
  if (pane.offsetHeight > maxH) {
    pane.style.height = maxH + 'px';
    pane.style.flex   = 'none';
  }
}

function buildScriptureError(msg, ref) {
  const isMissing = msg.includes('not available') || msg.includes('not found') || msg.includes('fetch-bibles') || msg.includes('not yet');
  return isMissing
    ? `<div class="scripture-error">Bible data not yet downloaded.<br><br>Run: <code style="background:var(--bg3);padding:2px 6px;border-radius:3px;font-family:'JetBrains Mono',monospace;">node backend/scripts/fetch-bibles.js</code><br>or rebuild the Docker image to fetch automatically.</div>`
    : `<div class="scripture-error">Could not load${ref ? ` "<em>${escHtml(ref)}</em>"` : ' that reference'}.<br><br>Try: <em>John 3:16</em> · <em>Psalm 23</em> · <em>Romans 8:1-8</em></div>`;
}

function syncDropdownsToRef(bookSlug, chapter) {
  // Determine OT or NT
  const isNT = BIBLE_NT.some(([slug]) => slug === bookSlug);
  const testSel = document.getElementById('bible-testament-select');
  const bookSel = document.getElementById('bible-book-select');
  const chapSel = document.getElementById('bible-chapter-select');

  testSel.value = isNT ? 'nt' : 'ot';
  testSel.dispatchEvent(new Event('change'));  // populate books

  // Small timeout so the book options are rendered before we set value
  setTimeout(() => {
    bookSel.value = bookSlug;
    // Populate chapters for this book
    const count = BIBLE_CHAPTER_COUNTS[bookSlug] || 1;
    chapSel.innerHTML = '<option value="">— Ch —</option>';
    for (let i = 1; i <= count; i++) {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = i;
      chapSel.appendChild(opt);
    }
    chapSel.disabled = false;
    chapSel.value = String(chapter);
  }, 0);
}

function initScriptureResize() {
  const handle = document.getElementById('scripture-resize-handle');
  const pane   = document.getElementById('scripture-pane');
  const wrap   = document.getElementById('editor-wrap');
  if (!handle || !pane) return;

  let dragging = false, startY = 0, startH = 0;

  function getMaxHeight() {
    // Never exceed 50% of the editor-wrap height (which is the visible area)
    return Math.floor((wrap ? wrap.offsetHeight : window.innerHeight) * 0.50);
  }
  const MIN_H = 120;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true; startY = e.clientY; startH = pane.offsetHeight;
    handle.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.webkitUserSelect = 'none';
    document.body.style.userSelect = 'none';
  });
  handle.addEventListener('touchstart', (e) => {
    dragging = true;
    startY = e.touches[0].clientY;
    startH = pane.offsetHeight;
  }, { passive: true });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const maxH = getMaxHeight();
    const newH = Math.min(maxH, Math.max(MIN_H, startH + (e.clientY - startY)));
    pane.style.height = newH + 'px';
    pane.style.flex   = 'none';
  });
  document.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const maxH = getMaxHeight();
    const newH = Math.min(maxH, Math.max(MIN_H, startH + (e.touches[0].clientY - startY)));
    pane.style.height = newH + 'px';
    pane.style.flex   = 'none';
  }, { passive: true });

  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.webkitUserSelect = '';
    document.body.style.userSelect = '';
  };
  document.addEventListener('mouseup', stopDrag);
  document.addEventListener('touchend', stopDrag);
}

// ── INIT ──
initSettingsListeners();
document.getElementById('tb-version').textContent = 'v' + APP_VERSION;

// initAuth() stub — replaced by _initAuthMultiUser() in the second script block below.
// Defined here so any early references don't throw; the real call happens after DOM loads.
function initAuth() { /* handled by _initAuthMultiUser() */ }