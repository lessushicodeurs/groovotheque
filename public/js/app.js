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
  // 37.3 — ré-exécutable : retirer les badges existants avant de re-poser
  listEl.querySelectorAll('.groove-comment-icon').forEach(el => el.remove());
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

// ── Epic 37 — Fil de commentaires (panneau latéral) ──────────────────────

const feedBtn      = document.getElementById('btn-feed');
const feedBadge    = document.getElementById('feed-badge');
const feedBackdrop = document.getElementById('feed-backdrop');
const feedList     = document.getElementById('feed-list');
const feedMarkAll  = document.getElementById('feed-mark-all');
const feedClose    = document.getElementById('feed-close');

let feedEntries = null; // [{ groovePath, grooveName, comment }] trié par activité desc

function markIdsSeen(ids) {
  const seen = getSeenIds();
  let changed = false;
  for (const id of ids) {
    if (id && !seen.has(id)) { seen.add(id); changed = true; }
  }
  if (!changed) return;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { /* ignore */ }
}

function discussionIds(comment) {
  return [comment.id, ...(comment.replies || []).map(r => r.id)];
}

// Une discussion est non lue si le racine OU une réponse n'est pas vue
function isDiscussionSeen(comment, seen) {
  return discussionIds(comment).every(id => seen.has(id));
}

// 37.5 — nom de rédacteur en priorité, repli sur le nom de compte
function displayAuthor(item) {
  return item.authorName || item.author || '?';
}

function formatPosition(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatRelativeDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} j`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function loadFeed() {
  try {
    const res = await fetch('/api/comments-feed');
    if (!res.ok) return;
    feedEntries = await res.json();
  } catch { /* silent */ }
}

// Compteur de discussions non lues sur le bouton 💬 (masqué à zéro)
function updateFeedBadge() {
  if (!feedEntries) return;
  const seen = getSeenIds();
  const unread = feedEntries.filter(e => !isDiscussionSeen(e.comment, seen)).length;
  if (unread > 0) {
    feedBadge.textContent = String(unread);
    feedBadge.classList.add('comment-badge--unseen');
    feedBadge.removeAttribute('hidden');
  } else {
    feedBadge.setAttribute('hidden', '');
  }
}

function buildThreadItem(item, isReply) {
  const el = document.createElement('div');
  el.className = 'feed-thread-item' + (isReply ? ' feed-thread-item--reply' : '');

  const meta = document.createElement('div');
  meta.className = 'feed-thread-meta';
  const author = document.createElement('span');
  author.className = 'feed-thread-author';
  author.textContent = displayAuthor(item);
  const date = document.createElement('span');
  date.className = 'feed-thread-date';
  date.textContent = formatRelativeDate(item.createdAt);
  meta.append(author, date);

  const text = document.createElement('div');
  text.className = 'feed-thread-text';
  text.textContent = item.text;

  el.append(meta, text);
  return el;
}

function createFeedEntry(entry, seen) {
  const { groovePath, grooveName, comment } = entry;
  const unread = !isDiscussionSeen(comment, seen);

  const el = document.createElement('article');
  el.className = 'feed-entry' + (unread ? ' feed-entry--unread' : '');

  const head = document.createElement('div');
  head.className = 'feed-entry-head';
  head.setAttribute('role', 'button');
  head.setAttribute('tabindex', '0');
  head.setAttribute('aria-expanded', 'false');

  const dot = document.createElement('span');
  dot.className = 'feed-entry-dot';
  dot.setAttribute('aria-hidden', 'true');

  const main = document.createElement('div');
  main.className = 'feed-entry-main';

  const meta = document.createElement('div');
  meta.className = 'feed-entry-meta';
  const author = document.createElement('span');
  author.className = 'feed-entry-author';
  author.textContent = displayAuthor(comment);
  const date = document.createElement('span');
  date.className = 'feed-entry-date';
  date.textContent = formatRelativeDate(comment.updatedAt || comment.createdAt);
  meta.append(author, date);

  const excerpt = document.createElement('div');
  excerpt.className = 'feed-entry-excerpt';
  excerpt.textContent = comment.text;

  const info = document.createElement('div');
  info.className = 'feed-entry-info';

  const link = document.createElement('a');
  link.className = 'feed-entry-groove';
  // 37.4 — lien profond : seek sur le commentaire + popover ouvert
  link.href = `player.html?groove=${encodePath(groovePath)}&comment=${encodeURIComponent(comment.id)}`;
  link.textContent = `▶ ${grooveName}`;
  link.title = `Ouvrir ${grooveName} à ${formatPosition(comment.position)}`;
  // Le clic sur le lien ne doit pas déplier l'entrée
  link.addEventListener('click', e => e.stopPropagation());

  const pos = document.createElement('span');
  pos.className = 'feed-entry-pos';
  pos.textContent = formatPosition(comment.position);

  info.append(link, pos);

  const nbReplies = (comment.replies || []).length;
  if (nbReplies > 0) {
    const replies = document.createElement('span');
    replies.className = 'feed-entry-replies';
    replies.textContent = `${nbReplies} réponse${nbReplies > 1 ? 's' : ''}`;
    info.appendChild(replies);
  }

  main.append(meta, excerpt, info);
  head.append(dot, main);

  const thread = document.createElement('div');
  thread.className = 'feed-thread';
  thread.setAttribute('hidden', '');

  // Clic sur l'entrée → déplie le fil sur place et marque la discussion lue
  const toggle = () => {
    const isOpen = !thread.hasAttribute('hidden');
    if (isOpen) {
      thread.setAttribute('hidden', '');
      head.setAttribute('aria-expanded', 'false');
      return;
    }
    if (!thread.childElementCount) {
      thread.appendChild(buildThreadItem(comment, false));
      for (const r of comment.replies || []) thread.appendChild(buildThreadItem(r, true));
    }
    thread.removeAttribute('hidden');
    head.setAttribute('aria-expanded', 'true');
    markIdsSeen(discussionIds(comment));
    el.classList.remove('feed-entry--unread');
    updateFeedBadge();
    applyCommentBadges();
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });

  el.append(head, thread);
  return el;
}

function renderFeed() {
  feedList.innerHTML = '';
  if (!feedEntries) {
    feedList.innerHTML = '<p class="state-msg">Erreur de chargement du fil.</p>';
    return;
  }
  if (feedEntries.length === 0) {
    feedList.innerHTML = '<p class="state-msg">Aucun commentaire pour l’instant.</p>';
    return;
  }
  const seen = getSeenIds();
  for (const entry of feedEntries) {
    feedList.appendChild(createFeedEntry(entry, seen));
  }
}

// Timer de masquage différé (fin de transition) — annulé si réouverture
let feedHideTimer = null;

function openFeed() {
  // Réouverture pendant la transition de fermeture : annuler le masquage différé
  if (feedHideTimer !== null) { clearTimeout(feedHideTimer); feedHideTimer = null; }
  feedBackdrop.removeAttribute('hidden');
  requestAnimationFrame(() => feedBackdrop.classList.add('feed-backdrop--open'));
  feedBtn.setAttribute('aria-expanded', 'true');
  // Recharger le fil à chaque ouverture (activité récente)
  loadFeed().then(() => { renderFeed(); updateFeedBadge(); });
}

function closeFeed() {
  feedBackdrop.classList.remove('feed-backdrop--open');
  feedBtn.setAttribute('aria-expanded', 'false');
  if (feedHideTimer !== null) clearTimeout(feedHideTimer);
  feedHideTimer = setTimeout(() => {
    feedHideTimer = null;
    feedBackdrop.setAttribute('hidden', '');
  }, 220);
}

function initFeed() {
  if (!feedBtn) return;

  feedBtn.addEventListener('click', openFeed);
  feedClose.addEventListener('click', closeFeed);

  // Clic hors panneau
  feedBackdrop.addEventListener('click', e => {
    if (e.target === feedBackdrop) closeFeed();
  });

  // Échap
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !feedBackdrop.hasAttribute('hidden')) closeFeed();
  });

  // Tout marquer comme lu
  feedMarkAll.addEventListener('click', () => {
    if (!feedEntries) return;
    markIdsSeen(feedEntries.flatMap(e => discussionIds(e.comment)));
    feedList.querySelectorAll('.feed-entry--unread').forEach(el => el.classList.remove('feed-entry--unread'));
    updateFeedBadge();
    applyCommentBadges();
  });

  // Compteur visible sans ouvrir le panneau
  loadFeed().then(updateFeedBadge);
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
  initFeed();
  // Charger le résumé des commentaires en parallèle du rendu de la liste
  loadCommentSummary().then(applyCommentBadges);
  await renderLevel(currentPath);
}

init();
