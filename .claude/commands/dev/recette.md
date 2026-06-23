---
name: recette
description: Génère la recette de test d'une epic : préambule worktree + démarrage serveur sur port libre + scénarios issus des critères d'acceptance.
allowed-tools: Bash, Read, Glob
---

Génère la recette pour : $ARGUMENTS

`$ARGUMENTS` contient le chemin du fichier epic (ex: `docs/1. todo/epic-23-blabla-mix.md`) et optionnellement le nom du worktree (ex: `epic-23-blabla-mix`). Si le nom du worktree est absent, le dériver du nom de fichier.

---

## 1. Lire l'epic

Lire le fichier epic. Extraire :
- Le numéro N et le titre
- Les **critères d'acceptance** (section "Critères d'acceptance")
- Le type d'implémentation : frontend/serveur web (présence de `package.json`, `server.js`) ou script CLI (shell, Python…)

## 2. Détecter l'environnement du worktree

Le worktree est dans `.worktrees/<slug>`. Vérifier sa présence :

```bash
ls .worktrees/<slug>/
```

Détecter comment lancer le projet :

```bash
# Vérifier si c'est un projet Node
test -f .worktrees/<slug>/package.json && cat .worktrees/<slug>/package.json | python3 -m json.tool | grep -A5 '"scripts"'
```

**Règles de détection du démarrage :**
- `package.json` avec `scripts.start` contenant `node` → `PORT=<port> npm start`
- `package.json` avec `scripts.dev` → `PORT=<port> npm run dev`
- Pas de `package.json`, fichier `.sh` principal → commande shell directe (pas de port à trouver)
- Makefile avec cible `dev` ou `start` → `PORT=<port> make dev`

## 3. Trouver un port libre (projets web uniquement)

```bash
for port in 3000 3001 3002 3003 4000 4001 8080 8081; do
  ss -tlnp 2>/dev/null | grep -q ":${port}" || { echo "$port"; break; }
done
```

Utiliser le premier port libre trouvé dans la recette.

## 4. Générer la recette

Produire un bloc markdown complet. Structure :

````
## Recette — Epic <N> : <titre>

### Mise en place

**Se placer dans le worktree :**
```bash
cd .worktrees/<slug>
```

**Lancer le site** (port <PORT> vérifié libre) :
```bash
PORT=<PORT> npm start
```
→ Ouvrir http://localhost:<PORT> dans le navigateur.

**Relancer après modification :**
```bash
# Ctrl+C pour arrêter, puis :
PORT=<PORT> npm start
```

---

### Prérequis
- <ce qu'il faut avoir pour tester, déduit de l'epic>

### Scénarios

**<N>.1 — <Titre du scénario>**
1. <Action concrète et vérifiable>
2. <Action concrète>
→ Résultat attendu : <ce qu'on doit observer>

**<N>.2 — …**
````

**Règles pour les scénarios :**
- Un scénario par critère d'acceptance
- Les actions sont concrètes : pas "vérifier que ça marche", mais "ouvrir http://localhost:PORT/xxx, cliquer sur Y, observer Z"
- Pour les scripts CLI : remplacer la section "Mise en place" par la commande d'exécution directe avec un exemple de données représentatives — pas de PORT
- Le titre de chaque scénario reprend littéralement le critère d'acceptance correspondant

**Section "Mise en place" pour script CLI (pas de serveur) :**
````
### Mise en place

**Se placer dans le worktree :**
```bash
cd .worktrees/<slug>
```

**Lancer le pipeline** (exemple avec données représentatives) :
```bash
<commande concrète avec un chemin d'exemple>
```

**Relancer :**
```bash
<même commande>
```
````

## 5. Afficher la recette

Afficher le contenu markdown directement dans la conversation (pas dans un bloc de code englobant).
