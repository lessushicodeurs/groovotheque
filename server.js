const express = require('express');
const basicAuth = require('express-basic-auth');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');

const app = express();
const PORT = process.env.PORT || 3099;
// Répertoire des peaks pré-calculés. Chaque fichier : cache/<groove>/<audio>.peaks.json
// Invalidation manuelle : si un fichier audio est remplacé via FTP, supprimer le .peaks.json
// correspondant dans cache/ pour forcer le recalcul au prochain chargement.
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

// 11.1 — Injection du CURRENT_USER avant le static middleware
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

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac']);
const GROOVES_DIR = path.resolve(__dirname, 'grooves');

function getTrackDisplayName(filename) {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  return withoutExt.replace(/^\d+_/, '').replace(/_/g, ' ');
}

function trackSortKey(filename) {
  const m = filename.match(/^(\d+)[-_]/);
  return m ? parseInt(m[1], 10) : Infinity;
}

function resolveGrooveDir(name, res) {
  const dir = path.resolve(GROOVES_DIR, name);
  if (!dir.startsWith(GROOVES_DIR + path.sep)) {
    res.status(403).json({ error: 'Accès interdit' });
    return null;
  }
  return dir;
}

// Serve marked locally — évite la dépendance CDN externe
app.get('/vendor/marked.esm.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/marked/lib/marked.esm.js'));
});

// 2.1 — Liste des grooves
app.get('/api/grooves', async (req, res) => {
  try {
    const entries = await fs.promises.readdir(GROOVES_DIR, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.endsWith('~'));
    const grooves = (await Promise.all(dirs.map(async entry => {
      const slug = entry.name;
      const name = slug.replace(/_/g, ' ');
      try {
        const files = await fs.promises.readdir(path.join(GROOVES_DIR, slug));
        const hasMd = files.some(f => f.endsWith('.md'));
        return { slug, name, hasMd };
      } catch {
        return null; // sous-dossier illisible : on saute sans casser le listing
      }
    }))).filter(Boolean);
    grooves.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    res.json(grooves);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2.2b — Markdown seul (tooltip sans over-fetch des pistes)
app.get('/api/grooves/:name/md', async (req, res) => {
  const grooveDir = resolveGrooveDir(req.params.name, res);
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

// 2.2 — Détail d'un groove (pistes + contenu markdown)
app.get('/api/grooves/:name', async (req, res) => {
  const grooveDir = resolveGrooveDir(req.params.name, res);
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
    const tracks = audioEntries.map(({ name: filename }, index) => ({
      index,
      filename,
      displayName: getTrackDisplayName(filename),
      url: `/audio/${req.params.name}/${encodeURIComponent(filename)}`,
    }));
    const mdEntry = entries.find(e => e.isFile() && e.name.endsWith('.md'));
    let mdContent = null;
    if (mdEntry) {
      mdContent = await fs.promises.readFile(path.join(grooveDir, mdEntry.name), 'utf8');
    }
    res.json({ slug: req.params.name, tracks, mdContent });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Groove introuvable' });
    res.status(500).json({ error: err.message });
  }
});

// 9.2 — Téléchargement zip de toutes les pistes d'un groove
app.get('/api/grooves/:name/download', async (req, res) => {
  const grooveDir = resolveGrooveDir(req.params.name, res);
  if (!grooveDir) return;
  try {
    await fs.promises.access(grooveDir);
  } catch {
    return res.status(404).json({ error: 'Groove introuvable' });
  }

  const slug = req.params.name;
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

// 11.2 — Lecture du mix
app.get('/api/mix/:groove', async (req, res) => {
  const grooveDir = resolveGrooveDir(req.params.groove, res);
  if (!grooveDir) return;
  const mixPath = path.join(grooveDir, 'mix.json');
  try {
    const data = await fs.promises.readFile(mixPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({});
    res.status(500).json({ error: err.message });
  }
});

// 11.2 — Écriture du mix (admin uniquement)
app.post('/api/mix/:groove', async (req, res) => {
  if (req.auth?.user !== 'admin') return res.status(403).json({ error: 'Réservé à l\'admin' });
  const grooveDir = resolveGrooveDir(req.params.groove, res);
  if (!grooveDir) return;
  const mixPath = path.join(grooveDir, 'mix.json');
  try {
    await fs.promises.writeFile(mixPath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2.3 — Stream audio avec support range requests
app.get('/audio/:groove/:file', (req, res) => {
  const filePath = path.resolve(GROOVES_DIR, req.params.groove, req.params.file);
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

// 6.0 — Validation du chemin peaks (anti path traversal)
function resolvePeaksPath(groove, file, res) {
  const peaksPath = path.resolve(CACHE_DIR, groove, file + '.peaks.json');
  if (!peaksPath.startsWith(CACHE_DIR + path.sep)) {
    res.status(400).json({ error: 'Chemin invalide' });
    return null;
  }
  return peaksPath;
}

// 6.1 — GET peaks cachés
app.get('/api/peaks/:groove/:file', async (req, res) => {
  const peaksPath = resolvePeaksPath(req.params.groove, req.params.file, res);
  if (!peaksPath) return;
  try {
    const data = await fs.promises.readFile(peaksPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Cache introuvable' });
    res.status(500).json({ error: err.message });
  }
});

// 6.2 — POST sauvegarde des peaks
app.post('/api/peaks/:groove/:file', async (req, res) => {
  const peaksPath = resolvePeaksPath(req.params.groove, req.params.file, res);
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

app.listen(PORT, () => {
  console.log(`Groovotheque listening on port ${PORT}`);
});
