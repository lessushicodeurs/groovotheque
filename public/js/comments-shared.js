// ── Utilitaires commentaires partagés index/player (epics 22 & 37) ─────────
// Suivi « vu » (localStorage), affichage rédacteur, formats de date/position.

const SEEN_KEY = 'groovotheque:seen_comments';

export function getSeenIds() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}

// 37.2 — marquage en lot (commentaire racine + réponses)
export function markCommentsSeen(ids) {
  const seen = getSeenIds();
  let changed = false;
  for (const id of ids) {
    if (id && !seen.has(id)) { seen.add(id); changed = true; }
  }
  if (!changed) return;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { /* ignore */ }
}

// IDs d'une discussion : le racine + toutes ses réponses
export function discussionIds(comment) {
  return [comment.id, ...(comment.replies || []).map(r => r.id)];
}

// 37.2 — une discussion est vue si le racine ET toutes ses réponses sont vus
export function isDiscussionSeen(comment, seen) {
  return discussionIds(comment).every(id => seen.has(id));
}

// 37.5 — nom de rédacteur en priorité, repli sur le nom de compte
export function displayAuthor(item) {
  return item.authorName || item.author || '?';
}

// Position en m:ss (ex : 1:07)
export function formatPosition(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// Date relative (« il y a 5 min », « hier »), absolue au-delà d'une semaine
export function formatRelativeDate(iso) {
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
