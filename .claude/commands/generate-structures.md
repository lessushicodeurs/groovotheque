Generate a PDF from the Structures.md file at the given path.

The argument is: $ARGUMENTS

CSS is at `/home/alaindiart/Sites/_perso/groovotheque/.claude/styles/structures.css` — ne pas réécrire, l'utiliser directement.

Steps:

1. Générer le HTML (INPUT = chemin du .md en argument) :
```
npx md-to-pdf --as-html --stylesheet /home/alaindiart/Sites/_perso/groovotheque/.claude/styles/structures.css INPUT
```
Cela produit un fichier `.html` dans le même dossier que le `.md`.

2. Post-traiter le HTML pour envelopper chaque morceau (h1 + contenu) dans un `<div style="page-break-inside: avoid">`, via ce script Python (remplacer INPUT_HTML par le chemin du .html généré) :
```python
from pathlib import Path
import re

html = Path('INPUT_HTML').read_text()
parts = re.split(r'(?=<h1 )', html)
before, songs = parts[0], parts[1:]

wrapped = before
for song in songs:
    tail_match = re.search(r'(\s*\n\s*</body></html>)$', song)
    if tail_match:
        body, tail = song[:tail_match.start()], tail_match.group(1)
    else:
        body, tail = song, ''
    wrapped += f'<div style="page-break-inside: avoid">\n{body}</div>\n{tail}'

Path('/tmp/structures-wrapped.html').write_text(wrapped)
```

3. Générer le PDF en A4 avec puppeteer (remplacer OUTPUT_PDF par le chemin de sortie souhaité) :
```javascript
const puppeteer = require('/home/alaindiart/.npm/_npx/55158e48eb5c59f7/node_modules/puppeteer');
(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('file:///tmp/structures-wrapped.html', { waitUntil: 'networkidle0' });
  await page.pdf({
    path: 'OUTPUT_PDF',
    format: 'A4',
    printBackground: true,
  });
  await browser.close();
})();
```

Le PDF de sortie remplace le `.pdf` existant dans le même dossier que le `.md`. Indiquer le chemin en fin de tâche.
