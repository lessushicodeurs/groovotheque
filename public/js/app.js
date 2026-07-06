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
      card.appendChild(breadcrumb);
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
