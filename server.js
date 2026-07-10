const express = require('express');
const basicAuth = require('express-basic-auth');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');

const app = express();
const PORT = process.env.PORT || 3099;
const CACHE_DIR = path.resolve(__dirname, 'cache');

function loadUsers() {
  const authFile = path.join(__dirname, '.auth');
  if (!fs.existsSync(authFile)) {
    console.error('ERREUR: fichier .auth introuvable. Copier .auth.example vers .auth.');
    process.exit(1);
  }
  const lines = fs.readFileSync(authFile, 'utf8').split('\n');
  const users = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    users[trimmed.slice(0, idx)] = trimmed.slice(idx + 1).replace(/^\$2y\$/, '$2b$');
  }
  if (Object.keys(users).length === 0) {
    console.error('ERREUR: aucun utilisateur trouvé dans .auth.');
    process.exit(1);
  }
  return users;
}

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

const users = loadUsers();
app.use(basicAuth({
  authorizer: (username, password, cb) => {
    const hash = users[username];
    if (!hash) return cb(null, false);
    bcrypt.compare(password, hash, cb);
  },
  authorizeAsync: true,
  challenge: true,
  realm: 'Groovotheque',
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

app.get('/player.html', (req, res) => {
  const template = fs.readFileSync(path.join(__dirname, 'public', 'player.html'), 'utf8');
  const user = req.auth?.user ?? 'anonymous';
  const injected = template.replace(
    '</head>',
    `  <script>window.CURRENT_USER = ${JSON.stringify(user)};</script>\n</head>`
  );
  res.type('html').send(injected);
});

app.use(express.static(path.join(__dirname, 'public')));

// 20.1 — Extensions media pour la détection groove vs conteneur
const AUDIO_EXTENSIONS     = new Set(['.mp3', '.wav', '.flac', '.ogg']);
const GP_EXTENSIONS        = new Set(['.gp', '.gpx', '.gp5', '.gp4', '.gp8']);
const ALL_MEDIA_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ...GP_EXTENSIONS]);

const GROOVES_DIR = path.normalize(path.resolve(__dirname, 'grooves'));

function getTrackDisplayName(filename) {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  return withoutExt.replace(/^\d+_/, '').replace(/_/g, ' ');
}

function trackSortKey(filename) {
  const m = filename.match(/^(\d+)[-_]/);
  return m ? parseInt(m[1], 10) : Infinity;
}

// 20.1 — Formatage du nom d'affichage
function formatDisplayName(slug) {
  return slug.replace(/_/g, ' ');
}

// 20.1 — Un dossier est un groove s'il contient directement un fichier audio ou GP
async function classifyDir(dirPath) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const hasMedia = entries.some(
    e => e.isFile() && ALL_MEDIA_EXTENSIONS.has(path.extname(e.name).toLowerCase())
  );
  return hasMedia ? 'groove' : 'container';
}

// Anti path traversal : accepte les chemins multi-segments
function resolveGrooveDir(groovePath, res) {
  if (!groovePath) {
    res.status(400).json({ error: 'Chemin manquant' });
    return null;
  }
  const dir = path.resolve(GROOVES_DIR, groovePath);
  if (!dir.startsWith(GROOVES_DIR + path.sep)) {
    res.status(403).json({ error: 'Accès interdit' });
    return null;
  }
  return dir;
}

app.get('/vendor/marked.esm.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/marked/lib/marked.esm.js'));
});

// 34.1 — WaveSurfer ESM depuis node_modules
app.get('/vendor/wavesurfer.esm.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'node_modules/wavesurfer.js/dist/wavesurfer.esm.js'));
});
app.get('/vendor/plugins/timeline.esm.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'node_modules/wavesurfer.js/dist/plugins/timeline.esm.js'));
});
app.get('/vendor/plugins/hover.esm.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'node_modules/wavesurfer.js/dist/plugins/hover.esm.js'));
});
app.get('/vendor/plugins/regions.esm.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'node_modules/wavesurfer.js/dist/plugins/regions.esm.js'));
});

// 34.2 — AlphaTab dist depuis node_modules (worker + fonts + soundfont)
app.use('/vendor/alphatab', express.static(path.join(__dirname, 'node_modules/@coderline/alphatab/dist')));

// 20.2 — Contenu d'un niveau : GET /api/grooves?path=
// Conteneurs d'abord (alpha), grooves ensuite (alpha)
app.get('/api/grooves', async (req, res) => {
  const relPath = req.query.path || '';

  let targetDir;
  if (relPath) {
    if (relPath.includes('..') || path.isAbsolute(relPath)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    targetDir = path.resolve(GROOVES_DIR, relPath);
    if (!targetDir.startsWith(GROOVES_DIR + path.sep)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
  } else {
    targetDir = GROOVES_DIR;
  }

  try {
    const entries = await fs.promises.readdir(targetDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.endsWith('~'));

    const items = (await Promise.all(dirs.map(async entry => {
      const slug = entry.name;
      const itemPath = relPath ? `${relPath}/${slug}` : slug;
      const dirPath = path.join(targetDir, slug);
      try {
        const type = await classifyDir(dirPath);
        const displayName = formatDisplayName(slug);
        if (type === 'groove') {
          const files = await fs.promises.readdir(dirPath);
          const hasMd = files.some(f => f.endsWith('.md'));
          return { type: 'groove', slug, path: itemPath, displayName, hasMd };
        } else {
          return { type: 'folder', slug, path: itemPath, displayName };
        }
      } catch {
        return null;
      }
    }))).filter(Boolean);

    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.displayName.localeCompare(b.displayName, 'fr');
    });

    res.json(items);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Dossier introuvable' });
    res.status(500).json({ error: err.message });
  }
});

// 20.3 — Collecte récursive de tous les grooves (feuilles)
async function collectGrooves(dirPath, relPath) {
  const results = [];
  let entries;
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }
  const dirs = entries.filter(e => e.isDirectory() && !e.name.endsWith('~'));
  await Promise.all(dirs.map(async entry => {
    const slug = entry.name;
    const itemPath = relPath ? `${relPath}/${slug}` : slug;
    const subDir = path.join(dirPath, slug);
    const type = await classifyDir(subDir).catch(() => 'container');
    if (type === 'groove') {
      const displayName = formatDisplayName(slug);
      const files = await fs.promises.readdir(subDir).catch(() => []);
      const hasMd = files.some(f => f.endsWith('.md'));
      results.push({ type: 'groove', slug, path: itemPath, displayName, hasMd });
    } else {
      const sub = await collectGrooves(subDir, itemPath);
      results.push(...sub);
    }
  }));
  return results;
}

// 20.3 — GET /api/search : tous les grooves récursivement
app.get('/api/search', async (req, res) => {
  try {
    const grooves = await collectGrooves(GROOVES_DIR, '');
    grooves.sort((a, b) => a.path.localeCompare(b.path, 'fr'));
    res.json(grooves);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Epic 36 — Tags sur les grooves ────────────────────────────────────────

// 36.2 — GET /api/tags-summary : { "<groovePath>": ["tag1", ...], ... }
// Seuls les grooves portant au moins un tag apparaissent (pattern comments-summary).
app.get('/api/tags-summary', async (req, res) => {
  try {
    const grooves = await collectGrooves(GROOVES_DIR, '');
    const summary = {};
    await Promise.all(grooves.map(async groove => {
      try {
        const raw = await fs.promises.readFile(
          path.join(GROOVES_DIR, groove.path, 'tags.json'), 'utf8'
        );
        const data = JSON.parse(raw);
        if (Array.isArray(data.tags) && data.tags.length > 0) {
          summary[groove.path] = data.tags;
        }
      } catch { /* pas de tags.json (ou illisible) : groove absent du résumé */ }
    }));
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 36.1 — GET /api/tags/* : tags d'un groove ({ tags: [] } si fichier absent)
app.get('/api/tags/*', async (req, res) => {
  const groovePath = req.params[0];
  const grooveDir = resolveGrooveDir(groovePath, res);
  if (!grooveDir) return;
  const tagsPath = path.join(grooveDir, 'tags.json');
  try {
    const data = JSON.parse(await fs.promises.readFile(tagsPath, 'utf8'));
    res.json({ tags: Array.isArray(data.tags) ? data.tags : [] });
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({ tags: [] });
    res.status(500).json({ error: err.message });
  }
});

// 36.1 — POST /api/tags/* : remplace la liste complète des tags
// Ouvert à tout utilisateur authentifié (pas de gating admin).
// Validation : trim de chaque tag, rejet des chaînes vides, dédoublonnage exact,
// tag ≤ 80 caractères, ≤ 50 tags. Cible obligatoirement un groove feuille
// (un POST sur un conteneur créerait un tags.json orphelin).
const MAX_TAG_LENGTH = 80;
const MAX_TAGS_PER_GROOVE = 50;

app.post('/api/tags/*', async (req, res) => {
  const groovePath = req.params[0];
  const grooveDir = resolveGrooveDir(groovePath, res);
  if (!grooveDir) return;
  let dirType;
  try {
    dirType = await classifyDir(grooveDir);
  } catch {
    return res.status(404).json({ error: 'Groove introuvable' });
  }
  if (dirType !== 'groove') {
    return res.status(400).json({ error: 'La cible n\'est pas un groove' });
  }
  const { tags } = req.body ?? {};
  if (!Array.isArray(tags) || tags.some(t => typeof t !== 'string')) {
    return res.status(400).json({ error: 'tags doit être un tableau de chaînes' });
  }
  if (tags.length > MAX_TAGS_PER_GROOVE) {
    return res.status(400).json({ error: `${MAX_TAGS_PER_GROOVE} tags maximum par groove` });
  }
  const cleaned = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (!trimmed) continue; // chaîne vide après trim : ignorée
    if (trimmed.length > MAX_TAG_LENGTH) {
      return res.status(400).json({ error: `Tag trop long (${MAX_TAG_LENGTH} caractères maximum)` });
    }
    if (!cleaned.includes(trimmed)) cleaned.push(trimmed); // dédoublonnage exact
  }
  const tagsPath = path.join(grooveDir, 'tags.json');
  try {
    await fs.promises.writeFile(tagsPath, JSON.stringify({ tags: cleaned }, null, 2), 'utf8');
    res.json({ tags: cleaned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 20.4 — Routes spécifiques AVANT le wildcard général /api/grooves/*

app.get('/api/grooves/*/md', async (req, res) => {
  const groovePath = req.params[0];
  const grooveDir = resolveGrooveDir(groovePath, res);
  if (!grooveDir) return;
  try {
    const entries = await fs.promises.readdir(grooveDir, { withFileTypes: true });
    const mdEntry = entries.find(e => e.isFile() && e.name.endsWith('.md'));
    if (!mdEntry) return res.json({ mdContent: null });
    const mdContent = await fs.promises.readFile(path.join(grooveDir, mdEntry.name), 'utf8');
    res.json({ mdContent });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Groove introuvable' });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/grooves/*/download', async (req, res) => {
  const groovePath = req.params[0];
  const grooveDir = resolveGrooveDir(groovePath, res);
  if (!grooveDir) return;
  try {
    await fs.promises.access(grooveDir);
  } catch {
    return res.status(404).json({ error: 'Groove introuvable' });
  }

  const slug = groovePath.split('/').pop();
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${slug}.zip"`);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('error', (err) => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
  archive.pipe(res);

  try {
    const entries = await fs.promises.readdir(grooveDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith('~')) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (AUDIO_EXTENSIONS.has(ext) || ext === '.md') {
        archive.file(path.join(grooveDir, entry.name), { name: entry.name });
      }
    }
  } catch (err) {
    archive.abort();
    return;
  }

  await archive.finalize();
});

// 20.4 — Détail d'un groove : chemin multi-segments
app.get('/api/grooves/*', async (req, res) => {
  const groovePath = req.params[0];
  const grooveDir = resolveGrooveDir(groovePath, res);
  if (!grooveDir) return;
  try {
    const entries = await fs.promises.readdir(grooveDir, { withFileTypes: true });
    const audioEntries = entries.filter(
      e => e.isFile() && !e.name.endsWith('~') && AUDIO_EXTENSIONS.has(path.extname(e.name).toLowerCase())
    );
    audioEntries.sort((a, b) => {
      const ka = trackSortKey(a.name);
      const kb = trackSortKey(b.name);
      if (ka !== Infinity && kb !== Infinity) return ka - kb;
      if (ka !== Infinity) return -1;
      if (kb !== Infinity) return 1;
      return a.name.localeCompare(b.name);
    });
    const slug = groovePath.split('/').pop();
    const encodedPath = groovePath.split('/').map(encodeURIComponent).join('/');
    const tracks = audioEntries.map(({ name: filename }, index) => ({
      index,
      filename,
      displayName: getTrackDisplayName(filename),
      url: `/audio/${encodedPath}/${encodeURIComponent(filename)}`,
    }));
    const mdEntry = entries.find(e => e.isFile() && e.name.endsWith('.md'));
    let mdContent = null;
    if (mdEntry) {
      mdContent = await fs.promises.readFile(path.join(grooveDir, mdEntry.name), 'utf8');
    }
    const gpEntry = entries.find(
      e => e.isFile() && GP_EXTENSIONS.has(path.extname(e.name).toLowerCase())
    );
    const tabFile = gpEntry ? gpEntry.name : null;
    res.json({ slug, tracks, mdContent, tabFile });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Groove introuvable' });
    res.status(500).json({ error: err.message });
  }
});

// 30.1 / 30.2 — Mix lecture (tracks uniquement) avec fallback parent
app.get('/api/mix/*', async (req, res) => {
  const groovePath = req.params[0];
  const grooveDir = resolveGrooveDir(groovePath, res);
  if (!grooveDir) return;

  // Cherche mix.json dans le groove, puis dans le parent (un seul niveau)
  const mixPathLocal = path.join(grooveDir, 'mix.json');
  let data = null;
  let source = 'none';

  try {
    data = JSON.parse(await fs.promises.readFile(mixPathLocal, 'utf8'));
    source = 'groove';
  } catch (err) {
    if (err.code !== 'ENOENT') return res.status(500).json({ error: err.message });
    // Fallback : lire dans le dossier parent immédiat
    // Le parent doit être dans GROOVES_DIR (incluant GROOVES_DIR lui-même)
    const parentDir = path.dirname(grooveDir);
    if (parentDir === GROOVES_DIR || parentDir.startsWith(GROOVES_DIR + path.sep)) {
      const mixPathParent = path.join(parentDir, 'mix.json');
      try {
        data = JSON.parse(await fs.promises.readFile(mixPathParent, 'utf8'));
        source = 'parent';
      } catch (e2) {
        if (e2.code !== 'ENOENT') return res.status(500).json({ error: e2.message });
      }
    }
  }

  if (!data) return res.json({ _source: 'none' });

  // Ne renvoyer que les tracks (pas loop/markers qui ont leurs propres endpoints)
  const tracks = data.tracks ?? null;

  // Si le fallback parent a été déclenché mais que le mix.json parent ne contient
  // pas de clé tracks (format corrompu ou monolithique non restructuré), on
  // retourne _source:'none' pour éviter un indicateur "↑ mix parent" trompeur.
  if (source === 'parent' && !tracks) return res.json({ _source: 'none' });

  res.json({ tracks, _source: source });
});

// 30.1 — Mix écriture (tracks uniquement) — ne touche jamais au parent
app.post('/api/mix/*', async (req, res) => {
  if (req.auth?.user !== 'admin') return res.status(403).json({ error: 'Réservé à l\'admin' });
  const groovePath = req.params[0];
  const grooveDir = resolveGrooveDir(groovePath, res);
  if (!grooveDir) return;
  const mixPath = path.join(grooveDir, 'mix.json');
  try {
    const { tracks } = req.body;
    await fs.promises.writeFile(mixPath, JSON.stringify({ tracks }, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 30.1 — Loop lecture/écriture (groove-level uniquement, pas de fallback)
app.get('/api/loop/*', async (req, res) => {
  const groovePath = req.params[0];
  const grooveDir = resolveGrooveDir(groovePath, res);
  if (!grooveDir) return;
  const loopPath = path.join(grooveDir, 'loop.json');
  try {
    const data = await fs.promises.readFile(loopPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({});
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/loop/*', async (req, res) => {
  if (req.auth?.user !== 'admin') return res.status(403).json({ error: 'Réservé à l\'admin' });
  const groovePath = req.params[0];
  const grooveDir = resolveGrooveDir(groovePath, res);
  if (!grooveDir) return;
  const loopPath = path.join(grooveDir, 'loop.json');
  try {
    const { in: loopIn, out: loopOut } = req.body;
    // Si aucune borne fournie (loop effacé côté client), écrire {} pour
    // représenter "pas de loop" et écraser un éventuel loop.json existant.
    const loopData = (typeof loopIn === 'number' && typeof loopOut === 'number')
      ? { in: loopIn, out: loopOut }
      : {};
    await fs.promises.writeFile(loopPath, JSON.stringify(loopData, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 30.1 — Markers lecture/écriture (groove-level uniquement, pas de fallback)
app.get('/api/markers/*', async (req, res) => {
  const groovePath = req.params[0];
  const grooveDir = resolveGrooveDir(groovePath, res);
  if (!grooveDir) return;
  const markersPath = path.join(grooveDir, 'markers.json');
  try {
    const data = await fs.promises.readFile(markersPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') return res.json([]);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/markers/*', async (req, res) => {
  if (req.auth?.user !== 'admin') return res.status(403).json({ error: 'Réservé à l\'admin' });
  const groovePath = req.params[0];
  const grooveDir = resolveGrooveDir(groovePath, res);
  if (!grooveDir) return;
  const markersPath = path.join(grooveDir, 'markers.json');
  try {
    let markersData = req.body;
    if (!Array.isArray(markersData)) markersData = [];
    markersData.sort((a, b) => a.in - b.in);
    await fs.promises.writeFile(markersPath, JSON.stringify(markersData, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 20.4 — Stream audio : chemin multi-segments (dernier segment = fichier)
app.get('/audio/*', (req, res) => {
  const parts = req.params[0].split('/');
  if (parts.length < 2) return res.status(400).json({ error: 'Chemin invalide' });
  const filename = decodeURIComponent(parts.pop());
  const groovePath = parts.map(decodeURIComponent).join('/');
  const filePath = path.resolve(GROOVES_DIR, groovePath, filename);
  if (!filePath.startsWith(GROOVES_DIR + path.sep)) {
    return res.status(403).json({ error: 'Accès interdit' });
  }
  if (!AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return res.status(403).json({ error: 'Type de fichier non autorisé' });
  }
  res.sendFile(filePath, err => {
    if (err && !res.headersSent) {
      res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'Fichier introuvable' });
    }
  });
});

// 20.4 — Tablature Guitar Pro : chemin multi-segments
app.get('/tab/*', (req, res) => {
  const parts = req.params[0].split('/');
  if (parts.length < 2) return res.status(400).json({ error: 'Chemin invalide' });
  const filename = decodeURIComponent(parts.pop());
  const groovePath = parts.map(decodeURIComponent).join('/');
  const filePath = path.resolve(GROOVES_DIR, groovePath, filename);
  if (!filePath.startsWith(GROOVES_DIR + path.sep)) {
    return res.status(403).json({ error: 'Accès interdit' });
  }
  if (!GP_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return res.status(403).json({ error: 'Type de fichier non autorisé' });
  }
  res.sendFile(filePath, err => {
    if (err && !res.headersSent) {
      res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'Fichier introuvable' });
    }
  });
});

// 20.4 — Peaks : cache/<groove-path>/<file>.peaks.json
function resolvePeaksPath(groovePath, file, res) {
  const peaksPath = path.resolve(CACHE_DIR, groovePath, file + '.peaks.json');
  if (!peaksPath.startsWith(CACHE_DIR + path.sep)) {
    res.status(400).json({ error: 'Chemin invalide' });
    return null;
  }
  return peaksPath;
}

app.get('/api/peaks/*', async (req, res) => {
  const parts = req.params[0].split('/');
  if (parts.length < 2) return res.status(400).json({ error: 'Chemin invalide' });
  const file = decodeURIComponent(parts.pop());
  const groovePath = parts.map(decodeURIComponent).join('/');
  const peaksPath = resolvePeaksPath(groovePath, file, res);
  if (!peaksPath) return;
  try {
    const data = await fs.promises.readFile(peaksPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Cache introuvable' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/peaks/*', async (req, res) => {
  const parts = req.params[0].split('/');
  if (parts.length < 2) return res.status(400).json({ error: 'Chemin invalide' });
  const file = decodeURIComponent(parts.pop());
  const groovePath = parts.map(decodeURIComponent).join('/');
  const peaksPath = resolvePeaksPath(groovePath, file, res);
  if (!peaksPath) return;
  const { peaks } = req.body;
  if (!peaks || !Array.isArray(peaks)) {
    return res.status(400).json({ error: 'peaks doit être un tableau' });
  }
  try {
    const bodyStr = JSON.stringify({ peaks });
    if (bodyStr.length > 10 * 1024 * 1024) {
      return res.status(400).json({ error: 'Peaks trop volumineux (max 10MB)' });
    }
    await fs.promises.mkdir(path.dirname(peaksPath), { recursive: true });
    await fs.promises.writeFile(peaksPath, bodyStr, 'utf8');
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Epic 22 — Commentaires ────────────────────────────────────────────────

const COMMENTS_FILE = path.join(__dirname, 'cache', 'comments.json');

function readComments() {
  try {
    return JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeComments(data) {
  fs.writeFileSync(COMMENTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// GET /api/comments-summary — résumé {groovePath: {count, ids}} pour l'index
// 37.2 — ids inclut aussi les IDs des réponses pour le calcul du non-lu
app.get('/api/comments-summary', (req, res) => {
  try {
    const data = readComments();
    const summary = {};
    for (const [groove, comments] of Object.entries(data)) {
      if (comments.length > 0) {
        summary[groove] = {
          count: comments.length,
          ids: comments.flatMap(c => [c.id, ...(c.replies || []).map(r => r.id)]),
        };
      }
    }
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 37.1 — GET /api/comments-feed : toutes les discussions de la bibliothèque,
// triées par dernière activité descendante (updatedAt, repli sur createdAt).
// Une entrée = une discussion (commentaire racine + réponses). Lecture seule.
app.get('/api/comments-feed', (req, res) => {
  try {
    const data = readComments();
    const feed = [];
    for (const [groovePath, comments] of Object.entries(data)) {
      // Groove supprimé du disque : ne pas proposer un lien vers un player
      // en erreur (un existsSync par chemin distinct, coût négligeable)
      const grooveDir = path.resolve(GROOVES_DIR, groovePath);
      if (!grooveDir.startsWith(GROOVES_DIR + path.sep) || !fs.existsSync(grooveDir)) continue;
      const grooveName = formatDisplayName(groovePath.split('/').pop());
      for (const comment of comments) {
        feed.push({ groovePath, grooveName, comment });
      }
    }
    feed.sort((a, b) => {
      const ta = Date.parse(a.comment.updatedAt || a.comment.createdAt) || 0;
      const tb = Date.parse(b.comment.updatedAt || b.comment.createdAt) || 0;
      return tb - ta;
    });
    res.json(feed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 37.5 — nom de rédacteur optionnel (membres partageant le compte musicien)
function sanitizeAuthorName(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 50);
  return trimmed || null;
}

// POST /api/comments/*/:id/replies — AVANT le POST générique (priorité de route)
// Chemin exemple : /api/comments/SHK2/uuid-here/replies
// params[0] = "SHK2", params.id = "uuid-here"
app.post('/api/comments/*/:id/replies', (req, res) => {
  const groovePath = req.params[0];
  const { id } = req.params;
  const author = req.auth?.user;
  const { text, authorName } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text requis' });
  try {
    const data = readComments();
    const list = data[groovePath] || [];
    const comment = list.find(c => c.id === id);
    if (!comment) return res.status(404).json({ error: 'Commentaire introuvable' });
    const reply = {
      id: crypto.randomUUID(),
      author,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    const name = sanitizeAuthorName(authorName);
    if (name) reply.authorName = name;
    comment.replies.push(reply);
    comment.updatedAt = new Date().toISOString();
    writeComments(data);
    res.status(201).json(reply);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/comments/* — liste des commentaires d'un groove
app.get('/api/comments/*', (req, res) => {
  const groovePath = req.params[0];
  if (!groovePath) return res.status(400).json({ error: 'Chemin manquant' });
  try {
    const data = readComments();
    res.json(data[groovePath] || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/comments/* — crée un commentaire (après la route replies)
app.post('/api/comments/*', (req, res) => {
  const groovePath = req.params[0];
  if (!groovePath) return res.status(400).json({ error: 'Chemin manquant' });
  const author = req.auth?.user;
  const { position, text, authorName } = req.body;
  if (typeof position !== 'number' || !text?.trim()) {
    return res.status(400).json({ error: 'position (number) et text requis' });
  }
  try {
    const data = readComments();
    if (!data[groovePath]) data[groovePath] = [];
    const now = new Date().toISOString();
    const comment = {
      id: crypto.randomUUID(),
      position,
      author,
      text: text.trim(),
      createdAt: now,
      updatedAt: now,
      replies: [],
    };
    const name = sanitizeAuthorName(authorName);
    if (name) comment.authorName = name;
    data[groovePath].push(comment);
    writeComments(data);
    res.status(201).json(comment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/comments/*/:id — modifie le texte (auteur uniquement)
app.put('/api/comments/*/:id', (req, res) => {
  const groovePath = req.params[0];
  const { id } = req.params;
  const author = req.auth?.user;
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text requis' });
  try {
    const data = readComments();
    const list = data[groovePath] || [];
    const comment = list.find(c => c.id === id);
    if (!comment) return res.status(404).json({ error: 'Commentaire introuvable' });
    // 37.5 — l'admin garde tous les droits
    if (comment.author !== author && author !== 'admin') {
      return res.status(403).json({ error: 'Non autorisé' });
    }
    comment.text = text.trim();
    comment.updatedAt = new Date().toISOString();
    writeComments(data);
    res.json(comment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/comments/*/:id — supprime (auteur uniquement)
app.delete('/api/comments/*/:id', (req, res) => {
  const groovePath = req.params[0];
  const { id } = req.params;
  const author = req.auth?.user;
  try {
    const data = readComments();
    const list = data[groovePath] || [];
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Commentaire introuvable' });
    // 37.5 — l'admin garde tous les droits
    if (list[idx].author !== author && author !== 'admin') {
      return res.status(403).json({ error: 'Non autorisé' });
    }
    list.splice(idx, 1);
    writeComments(data);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Groovotheque listening on port ${PORT}`);
});
