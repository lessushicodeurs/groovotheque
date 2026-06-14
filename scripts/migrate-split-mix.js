#!/usr/bin/env node
/**
 * scripts/migrate-split-mix.js
 *
 * Migration one-shot : éclate les mix.json "monolithiques" (contenant tracks +
 * loop et/ou markers) en trois fichiers à responsabilité unique :
 *   - mix.json     → { tracks }
 *   - loop.json    → { in, out }
 *   - markers.json → [ { in, out, label }, … ]
 *
 * Usage :
 *   node scripts/migrate-split-mix.js [--dry-run] <dossier>
 *
 * --dry-run : affiche le plan sans écrire de fichiers
 *
 * Idempotent : un mix.json qui ne contient que "tracks" (déjà éclaté) est
 * ignoré. Un mix.json parent (au niveau d'un conteneur) contenant uniquement
 * "tracks" est également ignoré.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Arguments ─────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const dryRun  = args.includes('--dry-run');
const rootArg = args.find(a => !a.startsWith('--'));

if (!rootArg) {
  console.error('Usage : node scripts/migrate-split-mix.js [--dry-run] <dossier>');
  process.exit(1);
}

const ROOT = path.resolve(rootArg);
if (!fs.existsSync(ROOT)) {
  console.error(`Erreur : dossier introuvable : ${ROOT}`);
  process.exit(1);
}

// ── Récursion ─────────────────────────────────────────────────────────────────
let totalProcessed = 0;
let totalSkipped   = 0;

function processDir(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const mixFile = path.join(dir, 'mix.json');

  if (fs.existsSync(mixFile)) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(mixFile, 'utf8'));
    } catch (e) {
      console.warn(`⚠  Impossible de lire ${mixFile} : ${e.message}`);
    }

    if (data) {
      const hasLoop    = data.loop && typeof data.loop.in === 'number' && typeof data.loop.out === 'number';
      const hasMarkers = Array.isArray(data.markers) && data.markers.length > 0;

      if (!hasLoop && !hasMarkers) {
        // Déjà éclaté (ou mix sans loop/markers) — rien à faire
        totalSkipped++;
      } else {
        totalProcessed++;
        const relDir = path.relative(ROOT, dir) || '.';
        console.log(`\n[${relDir}]`);

        // mix.json → tracks uniquement
        const newMix = { tracks: data.tracks ?? null };
        if (dryRun) {
          console.log(`  ✎ mix.json     → { tracks: … } (loop/markers retirés)`);
        } else {
          fs.writeFileSync(mixFile, JSON.stringify(newMix, null, 2), 'utf8');
          console.log(`  ✓ mix.json mis à jour (tracks uniquement)`);
        }

        // loop.json
        if (hasLoop) {
          const loopFile = path.join(dir, 'loop.json');
          if (dryRun) {
            console.log(`  ✎ loop.json    → { in: ${data.loop.in}, out: ${data.loop.out} }`);
          } else {
            fs.writeFileSync(loopFile, JSON.stringify({ in: data.loop.in, out: data.loop.out }, null, 2), 'utf8');
            console.log(`  ✓ loop.json créé`);
          }
        }

        // markers.json
        if (hasMarkers) {
          const markersFile = path.join(dir, 'markers.json');
          const markersData = data.markers.map(m => ({ in: m.in, out: m.out, label: m.label ?? '' }));
          markersData.sort((a, b) => a.in - b.in);
          if (dryRun) {
            console.log(`  ✎ markers.json → [ ${markersData.length} marqueur(s) ]`);
          } else {
            fs.writeFileSync(markersFile, JSON.stringify(markersData, null, 2), 'utf8');
            console.log(`  ✓ markers.json créé (${markersData.length} marqueur(s))`);
          }
        }
      }
    }
  }

  // Récursion dans les sous-dossiers
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.endsWith('~')) {
      processDir(path.join(dir, entry.name));
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (dryRun) {
  console.log(`\n[dry-run] Analyse de ${ROOT}\n`);
} else {
  console.log(`\nMigration de ${ROOT}\n`);
}

processDir(ROOT);

console.log(`\n──────────────────────────────────────────`);
if (dryRun) {
  console.log(`Plan : ${totalProcessed} fichier(s) à éclater, ${totalSkipped} déjà éclaté(s) ignoré(s).`);
} else {
  console.log(`Terminé : ${totalProcessed} fichier(s) éclaté(s), ${totalSkipped} ignoré(s).`);
}
if (totalProcessed === 0 && totalSkipped === 0) {
  console.log('Aucun mix.json trouvé.');
}
