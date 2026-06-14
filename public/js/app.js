const listEl = document.getElementById('groove-list');

// ── Epic 22 — Badges commentaires sur l'index ───────────────────────────

const SEEN_KEY = 'groovotheque:seen_comments';

function getSeenIds() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}

let commentSummary = null; // { groovePath: { count, ids } }

async function loadCommentSummary() {
  try {
    const res = await fetch('/api/comments-summary');
    if (!res.ok) return;
    commentSummary = await res.json();
  } catch { /* silent */ }
}

function applyCommentBadges() {
  if (!commentSummary) return;
  const seen = getSeenIds();
  listEl.querySelectorAll('.groove-card[data-groove-path]').forEach(card => {
    const path = card.dataset.groovePath;
    const info = commentSummary[path];
    if (!info || info.count === 0) return;
    const hasUnseen = info.ids.some(id => !seen.has(id));
    const wrap = document.createElement('span');
    wrap.className = 'groove-comment-icon' + (hasUnseen ? ' groove-comment-icon--unseen' : '');
    wrap.title = `${info.count} commentaire${info.count > 1 ? 's' : ''}`;
    wrap.setAttribute('aria-label', wrap.title);
    const count = document.createElement('span');
    count.className = 'groove-comment-icon-count';
    count.textContent = String(info.count);
    wrap.appendChild(count);
    card.appendChild(wrap);
  });
}

// Encode un chemin relatif pour l'utiliser dans une URL path
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

// Lit le query param ?path= de l'URL courante
function getCurrentPath() {
  return new URLSearchParams(location.search).get('path') || '';
}

// ── Cartes ─────────────────────────────────────────────────────────────────

function createGrooveCard(groove) {
  const card = document.createElement('a');
  card.className = 'groove-card';
  card.href = `player.html?groove=${encodePath(groove.path)}`;
  card.dataset.groovePath = groove.path;

  const icon = document.createElement('span');
  icon.className = 'groove-icon';
  icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="1" y="10" width="3" height="4" rx="1.5"/><rect x="6" y="5" width="3" height="14" rx="1.5"/><rect x="11" y="2" width="3" height="20" rx="1.5"/><rect x="16" y="5" width="3" height="14" rx="1.5"/><rect x="21" y="10" width="2" height="4" rx="1"/></svg>';
  card.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'groove-card-body';
  card.appendChild(body);

  const name = document.createElement('p');
  name.className = 'groove-card-name';
  name.textContent = groove.displayName;
  body.appendChild(name);

  return card;
}

function createFolderCard(folder) {
  const card = document.createElement('a');
  card.className = 'groove-card groove-card--folder';
  card.href = `/?path=${encodePath(folder.path)}`;

  const icon = document.createElement('span');
  icon.className = 'folder-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
  card.appendChild(icon);

  const name = document.createElement('p');
  name.className = 'groove-card-name';
  name.textContent = folder.displayName;
  card.appendChild(name);

  return card;
}

// ── Fil d'Ariane (20.6) ────────────────────────────────────────────────────

function renderBreadcrumb(currentPath) {
  const nav = document.getElementById('breadcrumb');
  if (!nav) return;
  nav.innerHTML = '';

  const home = document.createElement('a');
  home.href = '/';
  home.className = 'breadcrumb-link';
  home.textContent = 'Accueil';
  nav.appendChild(home);

  if (!currentPath) return;

  const segments = currentPath.split('/');
  segments.forEach((seg, i) => {
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '›';
    nav.appendChild(sep);

    const partialPath = segments.slice(0, i + 1).join('/');
    const isLast = i === segments.length - 1;

    if (isLast) {
      const current = document.createElement('span');
      current.className = 'breadcrumb-current';
      current.textContent = seg.replace(/_/g, ' ');
      nav.appendChild(current);
    } else {
      const link = document.createElement('a');
      link.href = `/?path=${encodePath(partialPath)}`;
      link.className = 'breadcrumb-link';
      link.textContent = seg.replace(/_/g, ' ');
      nav.appendChild(link);
    }
  });
}

// ── Recherche live (20.7) ──────────────────────────────────────────────────

let allGrooves = null;

async function loadAllGrooves() {
  if (allGrooves !== null) return allGrooves;
  const res = await fetch('/api/search');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  allGrooves = await res.json();
  return allGrooves;
}

function renderSearchResults(query, grooves) {
  listEl.innerHTML = '';
  if (grooves.length === 0) {
    listEl.innerHTML = '<p class="state-msg">Aucun résultat.</p>';
    return;
  }
  for (const groove of grooves) {
    const card = createGrooveCard(groove);
    const segments = groove.path.split('/');
    if (segments.length > 1) {
      const breadcrumb = document.createElement('p');
      breadcrumb.className = 'groove-card-path';
      breadcrumb.textContent = segments.slice(0, -1).map(s => s.replace(/_/g, ' ')).join(' › ');
      card.appendChild(breadcrumb);
    }
    listEl.appendChild(card);
  }
  applyCommentBadges();
}

async function renderLevel(currentPath) {
  listEl.innerHTML = '<p class="state-msg">Chargement…</p>';

  const url = currentPath
    ? `/api/grooves?path=${encodeURIComponent(currentPath)}`
    : '/api/grooves';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();

    listEl.innerHTML = '';

    if (items.length === 0) {
      listEl.innerHTML = '<p class="state-msg">Aucun titre trouvé.</p>';
      return;
    }

    for (const item of items) {
      if (item.type === 'folder') {
        listEl.appendChild(createFolderCard(item));
      } else {
        listEl.appendChild(createGrooveCard(item));
      }
    }
    applyCommentBadges();
  } catch (err) {
    const p = document.createElement('p');
    p.className = 'state-msg error';
    p.textContent = `Erreur de chargement : ${err.message}`;
    listEl.innerHTML = '';
    listEl.appendChild(p);
  }
}

function setupSearch(currentPath) {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;

  let pendingQuery = '';

  searchInput.addEventListener('input', async () => {
    const query = searchInput.value.trim().toLowerCase();
    pendingQuery = query;

    if (!query) {
      renderLevel(currentPath);
      return;
    }

    try {
      const grooves = await loadAllGrooves();
      if (pendingQuery !== query) return;
      const filtered = grooves.filter(g =>
        g.displayName.toLowerCase().includes(query) ||
        g.path.toLowerCase().includes(query)
      );
      renderSearchResults(query, filtered);
    } catch (err) {
      listEl.innerHTML = `<p class="state-msg error">Erreur : ${err.message}</p>`;
    }
  });
}

async function init() {
  const currentPath = getCurrentPath();
  renderBreadcrumb(currentPath);
  setupSearch(currentPath);
  // Charger le résumé des commentaires en parallèle du rendu de la liste
  loadCommentSummary().then(applyCommentBadges);
  await renderLevel(currentPath);
}

init();
