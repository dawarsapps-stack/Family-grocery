import fs from 'node:fs';

const appPath = 'public/app.js';
let app = fs.readFileSync(appPath, 'utf8');

function replaceOnce(label, pattern, replacement) {
  const before = app;
  app = app.replace(pattern, replacement);
  if (app === before) throw new Error(`Shared-edit patch failed: ${label}`);
}

replaceOnce('owner default', /let owner\s*=\s*localMode\s*;/, 'let owner = true;');
replaceOnce('shared admin key', /let adminKey\s*=\s*storageGet\(['\"]sessionStorage['\"],['\"]sa-v2-admin['\"]\)\s*;/, "let adminKey = 'shared-trip-editor';");
replaceOnce('owner controls', /function ownerControls\(\)\s*\{\s*return owner && !viewerRestricted\(\);\s*\}/, 'function ownerControls(){ return owner; }');
replaceOnce('reorder access', /function canReorder\(\)\s*\{\s*return owner && !filtersActive\(\) && !viewerRestricted\(\);\s*\}/, 'function canReorder(){ return owner && !filtersActive(); }');
replaceOnce('owner toggle', /function toggleOwner\(\)\s*\{[\s\S]*?\n\}\n\nfunction openViewerChooser/, "function toggleOwner(){\n  owner = true;\n  adminKey = 'shared-trip-editor';\n  toast('Shared editing is enabled for everyone');\n}\n\nfunction openViewerChooser");
fs.writeFileSync(appPath, app);

const dataPath = 'public/data/trip-v2.json';
const model = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
model.travellers = (model.travellers || []).map(t => ({...t, role:'owner'}));
fs.writeFileSync(dataPath, JSON.stringify(model) + '\n');

const swPath = 'public/sw.js';
if (fs.existsSync(swPath)) {
  let sw = fs.readFileSync(swPath, 'utf8');
  sw = sw.replace(/sa-v2-[A-Za-z0-9_-]+/g, 'sa-v2-shared-edit-2');
  fs.writeFileSync(swPath, sw);
}

console.log('Shared editing enabled for all travellers');
