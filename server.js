const express = require('express');
const basicAuth = require('express-basic-auth');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3099;

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

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac']);
const GROOVES_DIR = path.resolve(__dirname, 'grooves');

function getTrackDisplayName(filename) {
  const withoutExt = filename.replace(/\.[^.]+$/, '');
  return withoutExt.replace(/^\d+[-_]/, '').replace(/[-_]/g, ' ');
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
    const dirs = entries.filter(e => e.isDirectory());
    const grooves = (await Promise.all(dirs.map(async entry => {
      const slug = entry.name;
      const name = slug.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
      e => e.isFile() && AUDIO_EXTENSIONS.has(path.extname(e.name).toLowerCase())
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

app.listen(PORT, () => {
  console.log(`Groovotheque listening on port ${PORT}`);
});
