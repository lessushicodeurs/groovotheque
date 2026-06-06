import { marked } from '/vendor/marked.esm.js';

const listEl = document.getElementById('groove-list');
const tooltipEl = document.getElementById('tooltip');

const mdCache = new Map();
let activeCard = null;

// Sanitisation DOM : supprime les scripts et handlers d'événements du HTML rendu
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

// Charge uniquement le markdown (endpoint dédié, sans les pistes)
// Throws on network/HTTP error — ne met PAS en cache les erreurs transitoires
async function loadMd(slug) {
  if (mdCache.has(slug)) return mdCache.get(slug);
  const res = await fetch(`/api/grooves/${encodeURIComponent(slug)}/md`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const html = data.mdContent ? sanitizeHtml(marked.parse(data.mdContent)) : null;
  mdCache.set(slug, html);
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

async function showTooltip(card, slug) {
  try {
    const html = await loadMd(slug);
    if (!html || activeCard !== card) return;
    tooltipEl.innerHTML = html;
    tooltipEl.style.left = '-9999px';
    tooltipEl.style.top = '-9999px';
    tooltipEl.removeAttribute('hidden');
    tooltipEl.setAttribute('aria-hidden', 'false');
    positionTooltip(card);
  } catch {
    // Erreur réseau transitoire : pas de mise en cache, réessayable au prochain survol
  }
}

function hideTooltip() {
  activeCard = null;
  tooltipEl.setAttribute('hidden', '');
  tooltipEl.setAttribute('aria-hidden', 'true');
}

function createCard(groove) {
  const card = document.createElement('a');
  card.className = 'groove-card';
  card.href = `player.html?groove=${encodeURIComponent(groove.slug)}`;

  const name = document.createElement('p');
  name.className = 'groove-card-name';
  name.textContent = groove.name;
  card.appendChild(name);

  if (groove.hasMd) {
    const note = document.createElement('p');
    note.className = 'groove-card-note';
    note.textContent = 'notes disponibles';
    card.appendChild(note);

    card.addEventListener('mouseenter', () => {
      activeCard = card;
      showTooltip(card, groove.slug);
    });
    card.addEventListener('mouseleave', () => {
      if (activeCard === card) hideTooltip();
    });

    // Touch: premier tap = tooltip, deuxième tap = navigation
    card.addEventListener('touchend', (e) => {
      const tooltipVisible = !tooltipEl.hasAttribute('hidden') && activeCard === card;
      if (!tooltipVisible) {
        e.preventDefault();
        activeCard = card;
        showTooltip(card, groove.slug);
      }
      // sinon: laisser le comportement par défaut → navigation
    }, { passive: false });
  }

  return card;
}

// Ferme le tooltip si le tap est en dehors de la carte active
document.addEventListener('touchstart', (e) => {
  if (activeCard && !activeCard.contains(e.target)) hideTooltip();
}, { passive: true });

// Ferme le tooltip au scroll (évite qu'il reste fixé à l'écran)
document.addEventListener('scroll', hideTooltip, { passive: true });

async function init() {
  try {
    const res = await fetch('/api/grooves');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const grooves = await res.json();

    listEl.innerHTML = '';

    if (grooves.length === 0) {
      listEl.innerHTML = '<p class="state-msg">Aucun titre trouvé dans grooves/.</p>';
      return;
    }

    for (const groove of grooves) {
      listEl.appendChild(createCard(groove));
    }
  } catch (err) {
    const p = document.createElement('p');
    p.className = 'state-msg error';
    p.textContent = `Erreur de chargement : ${err.message}`;
    listEl.innerHTML = '';
    listEl.appendChild(p);
  }
}

init();
