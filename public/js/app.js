import { marked } from '/vendor/marked.esm.js';

const listEl    = document.getElementById('groove-list');
const tooltipEl = document.getElementById('tooltip');

// Encode un chemin relatif pour l'utiliser dans une URL path
function encodePath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

// Lit le query param ?path= de l'URL courante
function getCurrentPath() {
  return new URLSearchParams(location.search).get('path') || '';
}

// ── Tooltip ────────────────────────────────────────────────────────────────

const mdCache = new Map();
let activeCard = null;

function sanitizeHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('script, style, iframe, object, embed').forEach(el => el.remove());
  for (const el of tmp.querySelectorAll('*')) {
    for (const { name } of [...el.attributes]) {
      if (name.startsWith('on') || (name === 'href' && el.getAttribute(name).startsWith('javascript:'))) {
        el.removeAttribute(name);
      }
    }
  }
  return tmp.innerHTML;
}

async function loadMd(groovePath) {
  if (mdCache.has(groovePath)) return mdCache.get(groovePath);
  const res = await fetch(`/api/grooves/${encodePath(groovePath)}/md`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const html = data.mdContent ? sanitizeHtml(marked.parse(data.mdContent)) : null;
  mdCache.set(groovePath, html);
  return html;
}

function positionTooltip(card) {
  const rect = card.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 12;

  if (vw < 768) {
    tooltipEl.style.width = `${vw - 2 * gap}px`;
    tooltipEl.style.left = `${gap}px`;
    const below = rect.bottom + gap;
    tooltipEl.style.top = `${below + tooltipEl.offsetHeight <= vh - gap
      ? below
      : Math.max(gap, rect.top - tooltipEl.offsetHeight - gap)}px`;
    return;
  }

  tooltipEl.style.width = '';
  let left = rect.right + gap;
  let top = rect.top;

  if (left + tooltipEl.offsetWidth > vw - gap) {
    left = rect.left - tooltipEl.offsetWidth - gap;
  }
  left = Math.max(gap, Math.min(left, vw - tooltipEl.offsetWidth - gap));
  if (top + tooltipEl.offsetHeight > vh - gap) {
    top = vh - tooltipEl.offsetHeight - gap;
  }
  top = Math.max(gap, top);

  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

async function showTooltip(card, groovePath) {
  try {
    const html = await loadMd(groovePath);
    if (!html || activeCard !== card) return;
    tooltipEl.innerHTML = html;
    tooltipEl.style.left = '-9999px';
    tooltipEl.style.top = '-9999px';
    tooltipEl.removeAttribute('hidden');
    tooltipEl.setAttribute('aria-hidden', 'false');
    positionTooltip(card);
  } catch {
    // Erreur transitoire : pas de mise en cache
  }
}

function hideTooltip() {
  activeCard = null;
  tooltipEl.setAttribute('hidden', '');
  tooltipEl.setAttribute('aria-hidden', 'true');
}

document.addEventListener('touchstart', (e) => {
  if (activeCard && !activeCard.contains(e.target)) hideTooltip();
}, { passive: true });

document.addEventListener('scroll', hideTooltip, { passive: true });

// ── Cartes ─────────────────────────────────────────────────────────────────

function createGrooveCard(groove) {
  const card = document.createElement('a');
  card.className = 'groove-card';
  card.href = `player.html?groove=${encodePath(groove.path)}`;

  const name = document.createElement('p');
  name.className = 'groove-card-name';
  name.textContent = groove.displayName;
  card.appendChild(name);

  if (groove.hasMd) {
    const note = document.createElement('p');
    note.className = 'groove-card-note';
    note.textContent = 'notes disponibles';
    card.appendChild(note);

    card.addEventListener('mouseenter', () => {
      activeCard = card;
      showTooltip(card, groove.path);
    });
    card.addEventListener('mouseleave', () => {
      if (activeCard === card) hideTooltip();
    });

    card.addEventListener('touchend', (e) => {
      const tooltipVisible = !tooltipEl.hasAttribute('hidden') && activeCard === card;
      if (!tooltipVisible) {
        e.preventDefault();
        activeCard = card;
        showTooltip(card, groove.path);
      }
    }, { passive: false });
  }

  return card;
}

function createFolderCard(folder) {
  const card = document.createElement('a');
  card.className = 'groove-card groove-card--folder';
  card.href = `/?path=${encodePath(folder.path)}`;

  const icon = document.createElement('span');
  icon.className = 'folder-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '📁';
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
      current.textContent = seg.replace(/[-_]/g, ' ');
      nav.appendChild(current);
    } else {
      const link = document.createElement('a');
      link.href = `/?path=${encodePath(partialPath)}`;
      link.className = 'breadcrumb-link';
      link.textContent = seg.replace(/[-_]/g, ' ');
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
      breadcrumb.textContent = segments.slice(0, -1).map(s => s.replace(/[-_]/g, ' ')).join(' › ');
      card.appendChild(breadcrumb);
    }
    listEl.appendChild(card);
  }
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
  await renderLevel(currentPath);
}

init();
