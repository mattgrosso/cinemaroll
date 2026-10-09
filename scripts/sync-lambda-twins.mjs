// Generates the CommonJS twins the push Lambda ships, from the ESM sources in
// src/assets/javascript. One source of truth; filmClubSync.test.js fails when
// a twin is stale. Run: node scripts/sync-lambda-twins.mjs
import { readFileSync, writeFileSync } from 'fs';

export const TWINS = [
  ['src/assets/javascript/filmClubSync.js', 'aws-lambda/filmClubSync.js'],
  ['src/assets/javascript/filmClubSyncPublisher.js', 'aws-lambda/filmClubSyncPublisher.js'],
  ['src/assets/javascript/cinemaScore.js', 'aws-lambda/cinemaScore.js'],
  ['src/assets/javascript/clubNotices.js', 'aws-lambda/clubNotices.js']
];

export function toCommonJs (source) {
  const exported = [];
  let out = source
    .replace(/^import \{([^}]+)\} from '([^']+)';$/gm, (_, names, path) => `const {${names}} = require('${path}');`)
    .replace(/^export (async function|function|class) (\w+)/gm, (_, kind, name) => { exported.push(name); return `${kind} ${name}`; })
    .replace(/^export const (\w+)/gm, (_, name) => { exported.push(name); return `const ${name}`; });
  out = `// GENERATED from src/assets/javascript — edit the ESM source and run scripts/sync-lambda-twins.mjs.\n${out}\nmodule.exports = { ${exported.join(', ')} };\n`;
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('sync-lambda-twins.mjs')) {
  for (const [from, to] of TWINS) {
    writeFileSync(to, toCommonJs(readFileSync(from, 'utf8')));
    console.log(`${to} ← ${from}`);
  }
}
