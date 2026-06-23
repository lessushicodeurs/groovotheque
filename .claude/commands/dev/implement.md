---
name: implement
description: Implémente une epic du projet dans un worktree isolé. Ne revient vers l'utilisateur qu'avec une implémentation testable.
---

Implémente l'epic suivante : $ARGUMENTS

## Rôle de la session

Cette session est **uniquement orchestratrice**. Elle ne lit pas de fichiers source, n'écrit pas de code, n'exécute pas de tests, et ne produit pas d'analyse. Chaque étape de travail réel est déléguée à un agent via l'outil `Agent`.

---

## Étape 1 — Analyser l'epic (agent Explore)

Déléguer à un agent Explore (`subagent_type: "Explore"`) :

> Lis le fichier epic `$ARGUMENTS` dans `docs/1. todo/` ou `docs/2. done/`. Extrais et retourne : numéro de l'epic, slug (pour nommer le worktree), objectif, liste des stories dans l'ordre des dépendances, décisions de conception, critères d'acceptance.

Récupérer le résultat (numéro, slug, stories, décisions, critères).

---

## Étape 2 — Créer et initialiser le worktree (orchestrateur)

C'est la seule étape exécutée directement par la session, car il s'agit de coordination pure.

```bash
git worktree add .worktrees/epic-<N>-<slug> -b epic-<N>-<slug>
cd .worktrees/epic-<N>-<slug>
ln -s ../../grooves grooves
ln -s ../../cache cache
ln -s ../../.auth .auth
ln -s ../../node_modules node_modules
echo '{}' > cache/comments.json
```

Vérifier que le worktree démarre (401 attendu, pas 500) :

```bash
PORT=3099 node server.js &
sleep 1
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3099/)
kill %1 2>/dev/null
[[ "$STATUS" == "401" ]] && echo "OK" || echo "ERREUR : $STATUS"
```

---

## Étape 3 — Implémenter (agent général)

Déléguer à un agent général avec tout le contexte issu de l'étape 1 :

> Tu travailles dans le worktree `.worktrees/epic-<N>-<slug>` (branche `epic-<N>-<slug>`). Ne touche jamais à `master`.
>
> **Objectif :** [objectif de l'epic]
>
> **Décisions de conception :** [liste]
>
> **Stories à implémenter dans l'ordre :** [liste numérotée]
>
> **Critères d'acceptance :** [liste]
>
> Pour chaque story :
> 1. Implémenter dans le worktree
> 2. Vérifier le critère d'acceptance correspondant
> 3. Committer : commit unitaire, Conventional Commits, description en français, un commit par story ou groupe logique cohérent
>
> Si une décision manque, faire le choix le plus simple et le noter.
>
> Retourner : liste des commits effectués, choix faits en l'absence de décision.

---

## Étape 4 — Relire et reviewer (agent général)

Déléguer à un agent général :

> Lis le diff complet (`git diff master`) dans le worktree `.worktrees/epic-<N>-<slug>`.
>
> **Critères d'acceptance de l'epic :** [liste issue de l'étape 1]
>
> Pour chaque point, indique s'il est couvert ou non. Produis ensuite une liste de remarques sur :
> - critères non couverts
> - cas limites non gérés visibles dans le code
> - code mort, TODO, logs de debug oubliés
> - décisions de conception non respectées
> - régressions possibles
>
> Retourner : liste structurée de remarques (vide si aucune).

---

## Étape 5 — Phase corrective (agent général, si remarques)

Si l'étape 4 produit des remarques, déléguer à un agent général :

> Tu travailles dans le worktree `.worktrees/epic-<N>-<slug>`.
>
> **Remarques à corriger :** [liste issue de l'étape 4]
>
> Pour chaque remarque corrigeable sans décision utilisateur :
> 1. Corriger dans le worktree
> 2. Committer : `fix(scope): ...`
>
> Retourner : liste des corrections appliquées, et remarques non résolues nécessitant une décision.

---

## Étape 6 — Générer la recette

Invoquer le skill `/dev:recette` avec le chemin du fichier epic et le nom du worktree.

Exemple : `/dev:recette "docs/1. todo/epic-<N>-<slug>.md" epic-<N>-<slug>`

---

## Étape 7 — Exécuter la recette (agent général)

Déléguer à un agent général avec la recette complète issue de l'étape 6 :

> Tu travailles dans le worktree `.worktrees/epic-<N>-<slug>`.
>
> **Recette à exécuter :** [contenu complet de la recette]
>
> Pour chaque scénario :
> - Exécuter le scénario
> - Noter le résultat réel face au résultat attendu
> - Si un scénario échoue : corriger dans le worktree, committer (`fix(scope): ...`), rejouer avant de continuer
>
> Retourner : résultat de chaque scénario (PASS / FAIL + détail), et corrections appliquées.

---

## Étape 8 — Revenir vers l'utilisateur

Ne revenir qu'une fois **tous les scénarios PASS**.

Annoncer :
- Worktree : `.worktrees/epic-<N>-<slug>`
- Branche : `epic-<N>-<slug>`
- Recette (contenu complet)
- Résultats de l'exécution
- Choix faits en l'absence de décision dans l'epic
- Remarques non résolues nécessitant une décision (si applicable)

---

## Règles

- La session n'écrit jamais de code, ne lit jamais de fichiers source, n'exécute jamais de tests directement
- Tout travail réel (lecture d'epic, implémentation, review, corrections, exécution de recette) est délégué à un agent
- Ne jamais travailler sur `master` — toujours dans le worktree créé à l'étape 2
- Ne pas demander de validation intermédiaire sauf blocage réel (fichier source manquant, décision contradictoire)
- Ne pas merger ni pousser — laisser l'utilisateur valider avant
