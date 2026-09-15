import fs from 'node:fs';
import path from 'node:path';

const appPath = 'public/app.js';
let app = fs.readFileSync(appPath, 'utf8');

function replaceOnce(label, pattern, replacement) {
  const before = app;
  app = app.replace(pattern, replacement);
  if (app === before) throw new Error(`Shared-edit patch failed: ${label}`);
}

replaceOnce('owner default', /let owner\s*=\s*localMode\s*;/, 'let owner = true;');
replaceOnce('shared admin key', /let adminKey\s*=\s*storageGet\(['"]sessionStorage['"],['"]sa-v2-admin['"]\)\s*;/, "let adminKey = 'shared-trip-editor';");
replaceOnce('owner controls', /function ownerControls\(\)\s*\{\s*return owner && !viewerRestricted\(\);\s*\}/, 'function ownerControls(){ return owner; }');
replaceOnce('reorder access', /function canReorder\(\)\s*\{\s*return owner && !filtersActive\(\) && !viewerRestricted\(\);\s*\}/, 'function canReorder(){ return owner && !filtersActive(); }');
replaceOnce('owner toggle', /function toggleOwner\(\)\s*\{[\s\S]*?\n\}\n\nfunction openViewerChooser/, "function toggleOwner(){\n  owner = true;\n  adminKey = 'shared-trip-editor';\n  toast('Shared editing is enabled for everyone');\n}\n\nfunction openViewerChooser");
fs.writeFileSync(appPath, app);

const dataPath = 'public/data/trip-v2.json';
const model = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
model.travellers = (model.travellers || []).map(t => ({...t, role:'owner'}));
fs.writeFileSync(dataPath, JSON.stringify(model) + '\n');

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function patchIncorrectOwnerKeyGuards(source) {
  const marker = 'Incorrect owner key';
  const ranges = new Map();
  let markerIndex = source.indexOf(marker);
  while (markerIndex !== -1) {
    const prefix = source.slice(0, markerIndex);
    const matches = [...prefix.matchAll(/\bif\s*\(/g)];
    const last = matches.at(-1);
    if (last) {
      const openIndex = last.index + last[0].lastIndexOf('(');
      const closeIndex = findMatchingParen(source, openIndex);
      if (closeIndex >= 0 && closeIndex < markerIndex && markerIndex - closeIndex <= 1200) {
        ranges.set(openIndex, closeIndex);
      }
    }
    markerIndex = source.indexOf(marker, markerIndex + marker.length);
  }
  let patched = source;
  const ordered = [...ranges.entries()].sort((a, b) => b[0] - a[0]);
  for (const [openIndex, closeIndex] of ordered) {
    patched = patched.slice(0, openIndex + 1) + 'false' + patched.slice(closeIndex);
  }
  return { patched, count: ordered.length };
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(?:mjs|mts|js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const functionsDir = 'netlify/functions';
let backendPatches = 0;
if (fs.existsSync(functionsDir)) {
  for (const file of walk(functionsDir)) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('Incorrect owner key')) continue;
    const result = patchIncorrectOwnerKeyGuards(source);
    if (result.count > 0) {
      fs.writeFileSync(file, result.patched);
      backendPatches += result.count;
      console.log(`Shared-edit backend guard disabled in ${file} (${result.count})`);
    }
  }
}
if (!backendPatches) {
  throw new Error('Shared-edit patch failed: backend owner-key guard not found');
}

const swPath = 'public/sw.js';
if (fs.existsSync(swPath)) {
  let sw = fs.readFileSync(swPath, 'utf8');
  sw = sw.replace(/sa-v2-[A-Za-z0-9_-]+/g, 'sa-v2-shared-edit-3');
  fs.writeFileSync(swPath, sw);
}

console.log('Shared editing enabled for all travellers; backend owner-key mismatch removed');
