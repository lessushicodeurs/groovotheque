import {
  getSeenIds, markCommentsSeen, discussionIds, isDiscussionSeen,
  displayAuthor, formatPosition, formatRelativeDate,
} from './comments-shared.js';

const listEl = document.getElementById('groove-list');

// ── Epic 22 — Badges commentaires sur l'index ───────────────────────────

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

// ── Epic 36 — Tags : résumé, vocabulaire, chips sur les cartes ──────────

let tagsSummary = null;  // { groovePath: [tags] }
let tagVocabulary = [];  // union des tags portés par au moins un groove
let tagsSummaryPromise = null;

async function loadTagsSummary() {
  try {
    const res = await fetch('/api/tags-summary');
    if (!res.ok) return;
    tagsSummary = await res.json();
    const seen = new Set();
    for (const tags of Object.values(tagsSummary)) {
      for (const t of tags) seen.add(t);
    }
    tagVocabulary = [...seen].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  } catch { /* résumé indisponible : pas de chips */ }
}

// 36.4 — Nombre de chips visibles avant le bouton « … »
const MAX_VISIBLE_CARD_TAGS = 3;

// Affichage d'un tag : le « # » décoratif vient du CSS (::before), on ne double
// donc pas un « # » initial saisi par l'utilisateur. La valeur stockée reste
// intacte (aucune normalisation), seul le rendu est ajusté.
function displayTag(tag) {
  return tag.startsWith('#') ? tag.slice(1) : tag;
}

function createCardTagChip(tag) {
  // <span role="button"> : un vrai <button> serait imbriqué dans le <a>
  // de la carte (HTML invalide, fragile en accessibilité)
  const chip = document.createElement('span');
  chip.className = 'tag-chip';
  chip.setAttribute('role', 'button');
  chip.tabIndex = 0;
  chip.title = `Filtrer sur « ${tag} »`;
  const label = document.createElement('span');
  label.className = 'tag-chip-label';
  label.textContent = displayTag(tag);
  chip.appendChild(label);
  // Le chip ajoute un filtre sans naviguer vers le player (la carte est un lien)
  const activate = (e) => {
    e.preventDefault();
    e.stopPropagation();
    addTagFilter(tag);
  };
  chip.addEventListener('click', activate);
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') activate(e);
  });
  return chip;
}

function applyTagChips() {
  if (!tagsSummary) return;
  listEl.querySelectorAll('.groove-card[data-groove-path]').forEach(card => {
    if (card.querySelector('.groove-card-tags')) return; // déjà appliqué
    const tags = tagsSummary[card.dataset.groovePath];
    if (!tags || tags.length === 0) return;
    const body = card.querySelector('.groove-card-body') || card;
    const wrap = document.createElement('div');
    wrap.className = 'groove-card-tags';
    tags.slice(0, MAX_VISIBLE_CARD_TAGS).forEach(t => wrap.appendChild(createCardTagChip(t)));
    if (tags.length > MAX_VISIBLE_CARD_TAGS) {
      const more = document.createElement('span');
      more.className = 'tag-more-btn';
      more.setAttribute('role', 'button');
      more.tabIndex = 0;
      more.textContent = '…';
      const hidden = tags.length - MAX_VISIBLE_CARD_TAGS;
      more.title = `${hidden} tag${hidden > 1 ? 's' : ''} de plus`;
      more.setAttribute('aria-label', more.title);
      const expand = (e) => {
        e.preventDefault();
        e.stopPropagation();
        more.remove();
        tags.slice(MAX_VISIBLE_CARD_TAGS).forEach(t => wrap.appendChild(createCardTagChip(t)));
      };
      more.addEventListener('click', expand);
      more.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') expand(e);
      });
      wrap.appendChild(more);
    }
    body.appendChild(wrap);
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
const feedPanel    = document.getElementById('feed-panel');
const feedList     = document.getElementById('feed-list');
const feedMarkAll  = document.getElementById('feed-mark-all');
const feedClose    = document.getElementById('feed-close');

let feedEntries = null; // [{ groovePath, grooveName, comment }] trié par activité desc
let feedLoadError = false; // dernier chargement en échec (données peut-être périmées)

async function loadFeed() {
  try {
    const res = await fetch('/api/comments-feed');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    feedEntries = await res.json();
    feedLoadError = false;
  } catch {
    // Échec : on conserve les éventuelles données déjà chargées (mieux que rien)
    // et on signale l'erreur discrètement au rendu.
    feedLoadError = true;
  }
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

  // Ligne d'infos (lien vers le player, position, réponses) : hors du
  // role="button" pour ne pas imbriquer deux éléments interactifs
  const info = document.createElement('div');
  info.className = 'feed-entry-info';

  const link = document.createElement('a');
  link.className = 'feed-entry-groove';
  // 37.4 — lien profond : seek sur le commentaire + popover ouvert
  link.href = `player.html?groove=${encodePath(groovePath)}&comment=${encodeURIComponent(comment.id)}`;
  link.textContent = `▶ ${grooveName}`;
  link.title = `Ouvrir ${grooveName} à ${formatPosition(comment.position)}`;

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

  main.append(meta, excerpt);
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
    markCommentsSeen(discussionIds(comment));
    el.classList.remove('feed-entry--unread');
    updateFeedBadge();
    applyCommentBadges();
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });

  el.append(head, info, thread);
  return el;
}

function renderFeed() {
  feedList.innerHTML = '';
  // Aucune donnée à afficher (premier chargement en échec) : erreur pleine.
  if (!feedEntries) {
    feedList.innerHTML = '<p class="state-msg">Erreur de chargement du fil.</p>';
    return;
  }
  // Rechargement en échec après un premier chargement réussi : on garde les
  // données périmées visibles, précédées d'une bannière d'erreur discrète.
  if (feedLoadError) {
    const banner = document.createElement('p');
    banner.className = 'feed-error-banner';
    banner.setAttribute('role', 'status');
    banner.textContent = 'Actualisation impossible — fil peut-être daté.';
    feedList.appendChild(banner);
  }
  if (feedEntries.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'state-msg';
    empty.textContent = 'Aucun commentaire pour l’instant.';
    feedList.appendChild(empty);
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
  feedClose.focus();
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
  // Restituer le focus au bouton d'ouverture (dialog aria-modal)
  feedBtn.focus();
}

// Piège de focus du dialog : Tab boucle à l'intérieur du panneau
function trapFeedFocus(e) {
  if (e.key !== 'Tab' || feedBackdrop.hasAttribute('hidden')) return;
  const focusables = feedPanel.querySelectorAll(
    'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!feedPanel.contains(document.activeElement)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
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

  // Piège de focus tant que le dialog est ouvert
  document.addEventListener('keydown', trapFeedFocus);

  // Tout marquer comme lu
  feedMarkAll.addEventListener('click', () => {
    if (!feedEntries) return;
    markCommentsSeen(feedEntries.flatMap(e => discussionIds(e.comment)));
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

function renderSearchResults(grooves) {
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
      // Dans le corps de la carte, sous le nom : en flex-item frère du corps,
      // le chemin comprimait le titre (chevauchement) et écrasait les chips.
      // applyTagChips ajoute ensuite la rangée de chips à la suite.
      card.querySelector('.groove-card-body').appendChild(breadcrumb);
    }
    listEl.appendChild(card);
  }
  applyCommentBadges();
  applyTagChips();
}

// `token` : garde anti-course partagée avec applyFilters — un rendu de niveau
// lent ne doit pas écraser des résultats filtrés demandés plus récemment.
async function renderLevel(currentPath, token = ++filterToken) {
  listEl.innerHTML = '<p class="state-msg">Chargement…</p>';

  const url = currentPath
    ? `/api/grooves?path=${encodeURIComponent(currentPath)}`
    : '/api/grooves';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    if (token !== filterToken) return; // une saisie plus récente a pris la main

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
    applyTagChips();
  } catch (err) {
    if (token !== filterToken) return;
    const p = document.createElement('p');
    p.className = 'state-msg error';
    p.textContent = `Erreur de chargement : ${err.message}`;
    listEl.innerHTML = '';
    listEl.appendChild(p);
  }
}

// ── Epic 36 — Recherche hybride tags (ET) + texte libre ──────────────────

const searchInput   = document.getElementById('search-input');
const searchChipsEl = document.getElementById('search-chips');
const searchSuggEl  = document.getElementById('search-tag-suggestions');

let activeTags = [];       // chips de tags actifs (filtre ET)
let searchSuggIndex = -1;  // suggestion surlignée au clavier
let filterToken = 0;       // garde anti-course sur les rendus async
let tagEntryActive = false; // frappe active d'un segment « #… » (autocomplétion)

// Découpe la saisie : texte libre avant le dernier « # », requête tag après.
// Le segment « #… » n'est transitoire que pendant la frappe active
// (tagEntryActive) : il sert alors à l'autocomplétion et n'est jamais converti
// implicitement en tag. Sur Escape ou blur, il redevient du texte libre —
// un groove nommé « Track #2 » reste ainsi trouvable en tapant « #2 ».
function splitSearchValue(value) {
  if (!tagEntryActive) return { text: value, tagQuery: null };
  const idx = value.lastIndexOf('#');
  if (idx === -1) return { text: value, tagQuery: null };
  return { text: value.slice(0, idx), tagQuery: value.slice(idx + 1) };
}

// Fin de la saisie tag (Escape/blur) : le segment « #… » restant est traité
// comme texte libre et réintègre le filtre et l'URL (q)
function commitPendingTagQuery() {
  if (!tagEntryActive) return;
  tagEntryActive = false;
  updateUrl(false);
  applyFilters();
}

function currentFreeText() {
  return splitSearchValue(searchInput.value).text.trim();
}

function hasActiveFilters() {
  return activeTags.length > 0 || currentFreeText() !== '';
}

function renderSearchChips() {
  searchChipsEl.innerHTML = '';
  for (const tag of activeTags) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';

    const label = document.createElement('span');
    label.className = 'tag-chip-label';
    label.textContent = displayTag(tag);
    chip.appendChild(label);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'tag-chip-x';
    removeBtn.setAttribute('aria-label', `Retirer le filtre ${tag}`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => removeTagFilter(tag));
    chip.appendChild(removeBtn);

    searchChipsEl.appendChild(chip);
  }
}

// 36.5 — URL partageable : index.html?path=…&tags=…&tags=…&q=…
function updateUrl(push) {
  const params = new URLSearchParams();
  const path = getCurrentPath();
  if (path) params.set('path', path);
  for (const tag of activeTags) params.append('tags', tag);
  const q = currentFreeText();
  if (q) params.set('q', q);
  const qs = params.toString();
  const url = qs ? `${location.pathname}?${qs}` : location.pathname;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

async function applyFilters() {
  const token = ++filterToken;
  const q = currentFreeText().toLowerCase();

  if (activeTags.length === 0 && !q) {
    renderLevel(getCurrentPath(), token);
    return;
  }

  try {
    if (activeTags.length > 0) {
      // Le filtre par tags a besoin du résumé : attendre son chargement initial
      if (tagsSummaryPromise) await tagsSummaryPromise;
      // Premier chargement en échec : retenter avant de filtrer
      if (!tagsSummary) await loadTagsSummary();
      if (token !== filterToken) return;
      if (!tagsSummary) {
        listEl.innerHTML = '<p class="state-msg error">Impossible de charger les tags : le filtre par tags est indisponible.</p>';
        return;
      }
    }
    const grooves = await loadAllGrooves();
    if (token !== filterToken) return; // une saisie plus récente a pris la main

    let filtered = grooves;
    // Intersection : le groove doit porter TOUS les tags actifs
    if (activeTags.length > 0) {
      filtered = filtered.filter(g => {
        const tags = (tagsSummary && tagsSummary[g.path]) || [];
        return activeTags.every(t => tags.includes(t));
      });
    }
    // Texte libre : affine sur nom + chemin à l'intérieur de la sélection
    if (q) {
      filtered = filtered.filter(g =>
        g.displayName.toLowerCase().includes(q) ||
        g.path.toLowerCase().includes(q)
      );
    }
    renderSearchResults(filtered);
  } catch (err) {
    if (token !== filterToken) return;
    listEl.innerHTML = `<p class="state-msg error">Erreur : ${err.message}</p>`;
  }
}

function addTagFilter(tag) {
  if (activeTags.includes(tag)) return;
  activeTags.push(tag);
  renderSearchChips();
  updateUrl(true); // entrée d'historique : retour arrière restaure l'état
  applyFilters();
}

function removeTagFilter(tag) {
  activeTags = activeTags.filter(t => t !== tag);
  renderSearchChips();
  updateUrl(true);
  applyFilters();
}

function hideSearchSuggestions() {
  searchSuggEl.setAttribute('hidden', '');
  searchSuggEl.innerHTML = '';
  searchSuggIndex = -1;
}

function selectSearchSuggestion(tag) {
  // La saisie « #… » se transforme en chip ; le texte libre reste dans le champ
  searchInput.value = splitSearchValue(searchInput.value).text;
  tagEntryActive = false;
  hideSearchSuggestions();
  addTagFilter(tag);
  searchInput.focus();
}

function renderSearchSuggestions(tagQuery) {
  const query = tagQuery.trim().toLowerCase();
  const matches = tagVocabulary.filter(t =>
    !activeTags.includes(t) && (query === '' || t.toLowerCase().includes(query))
  );
  if (matches.length === 0) {
    hideSearchSuggestions();
    return;
  }
  searchSuggEl.innerHTML = '';
  searchSuggIndex = -1;
  matches.slice(0, 12).forEach(tag => {
    const li = document.createElement('li');
    li.className = 'tag-suggestion';
    li.setAttribute('role', 'option');
    li.dataset.tag = tag; // valeur réelle (l'affichage strip un « # » initial)
    li.textContent = displayTag(tag);
    // mousedown pour devancer le blur du champ
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectSearchSuggestion(tag);
    });
    searchSuggEl.appendChild(li);
  });
  searchSuggEl.removeAttribute('hidden');
}

function moveSearchSuggestion(delta) {
  const items = Array.from(searchSuggEl.children);
  if (items.length === 0) return;
  searchSuggIndex = (searchSuggIndex + delta + items.length) % items.length;
  items.forEach((li, i) => li.classList.toggle('active', i === searchSuggIndex));
}

function readFiltersFromUrl() {
  const params = new URLSearchParams(location.search);
  activeTags = params.getAll('tags').map(t => t.trim()).filter(Boolean);
  searchInput.value = params.get('q') || '';
  tagEntryActive = false; // un q restauré peut contenir « # » : texte libre
}

function setupSearch() {
  if (!searchInput) return;

  searchInput.addEventListener('input', () => {
    // Taper (ou re-taper) avec un « # » présent réactive la saisie tag
    tagEntryActive = searchInput.value.includes('#');
    const { tagQuery } = splitSearchValue(searchInput.value);
    // « # » (et uniquement « # ») déclenche l'autocomplétion des tags
    if (tagQuery !== null) renderSearchSuggestions(tagQuery);
    else hideSearchSuggestions();
    // Le texte libre ne crée pas d'entrée d'historique (replaceState)
    updateUrl(false);
    applyFilters();
  });

  searchInput.addEventListener('keydown', (e) => {
    const suggestionsOpen = !searchSuggEl.hasAttribute('hidden');
    if (e.key === 'ArrowDown' && suggestionsOpen) {
      e.preventDefault();
      moveSearchSuggestion(1);
    } else if (e.key === 'ArrowUp' && suggestionsOpen) {
      e.preventDefault();
      moveSearchSuggestion(-1);
    } else if (e.key === 'Enter' && suggestionsOpen) {
      // Entrée ne sélectionne qu'une suggestion surlignée : jamais de
      // conversion implicite texte → tag
      const items = Array.from(searchSuggEl.children);
      if (searchSuggIndex >= 0 && items[searchSuggIndex]) {
        e.preventDefault();
        selectSearchSuggestion(items[searchSuggIndex].dataset.tag);
      }
    } else if (e.key === 'Escape') {
      // Fin de saisie tag : le segment « #… » restant devient du texte libre
      hideSearchSuggestions();
      commitPendingTagQuery();
    } else if (e.key === 'Backspace' && searchInput.value === '' && activeTags.length > 0) {
      // Backspace sur champ vide : retire le dernier chip
      removeTagFilter(activeTags[activeTags.length - 1]);
    }
  });

  searchInput.addEventListener('blur', () => {
    // Laisser le mousedown des suggestions s'exécuter avant de fermer
    setTimeout(() => {
      hideSearchSuggestions();
      commitPendingTagQuery();
    }, 150);
  });

  // Retour arrière / avant : restaurer l'état de recherche depuis l'URL
  window.addEventListener('popstate', () => {
    readFiltersFromUrl();
    renderSearchChips();
    hideSearchSuggestions();
    applyFilters();
  });
}

// Retour depuis le player via bfcache : les tags ont pu être édités, le résumé
// et le vocabulaire chargés au premier rendu sont potentiellement périmés
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  tagsSummaryPromise = loadTagsSummary().then(() => {
    // Retirer les chips existants pour les ré-appliquer avec les données fraîches
    listEl.querySelectorAll('.groove-card-tags').forEach(el => el.remove());
    applyTagChips();
    // Un filtre par tags actif doit refléter le nouveau résumé
    if (activeTags.length > 0) applyFilters();
  });
});

async function init() {
  const currentPath = getCurrentPath();
  renderBreadcrumb(currentPath);
  setupSearch();
  initFeed();
  // Charger les résumés (commentaires, tags) en parallèle du rendu de la liste
  loadCommentSummary().then(applyCommentBadges);
  tagsSummaryPromise = loadTagsSummary().then(applyTagChips);
  // 36.5 — l'URL porte l'état de recherche : chargeable directement
  readFiltersFromUrl();
  renderSearchChips();
  if (hasActiveFilters()) {
    await applyFilters();
  } else {
    await renderLevel(currentPath);
  }
}

init();
