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

app.listen(PORT, () => {
  console.log(`Groovotheque listening on port ${PORT}`);
});
