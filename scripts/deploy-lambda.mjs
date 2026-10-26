// `yarn deploy:push` / `yarn deploy:ai` / `yarn deploy:newsletter`: ship a
// Lambda with checks (2026-10-17; the newsletter joined 2026-10-24, retiring
// scripts/deploy-newsletter-lambda.sh). Push and AI used to go out by
// a recipe pasted from the rules file — download the live zip, copy the
// sources over it, zip, upload — with nothing in between to notice a stale
// twin, a file that doesn't parse, or a module left out of the copy. The push
// Lambda sends every notification Cinema Roll has; a broken upload would stop
// them all without a sound.
//
//   node scripts/deploy-lambda.mjs <push|ai|newsletter> [--dry]
//
// The bundle starts from the DEPLOYED zip, so node_modules stay exactly what
// is running (aws-lambda/node_modules on disk is the AI Lambda's, and never
// run yarn in there — it is npm's). Then, in order, refusing at the first
// failure: regenerate the CommonJS twins and refuse if that changed anything
// or any shipped source is uncommitted; `node --check` every source; copy them
// in; require the bundled entry, which loads every local module and every
// dependency, and confirm it exports a handler; refuse a zip smaller than a
// healthy one; upload, and wait for the update to land. `--dry` stops before
// the upload and leaves the bundle in $TMPDIR to look at.
//
// Run from the repo root: .tool-versions pins the awscli version there.
import { execFileSync, spawnSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';

const REGION = 'us-east-1';
const PROFILE = 'personal';

// `files` maps repo file → bundle name. `minBytes` sits well under the healthy
// zip (push ~260 KB, ai ~5 MB on 2026-10-17) and well over one whose
// node_modules went hollow.
export const LAMBDAS = {
  push: {
    functionName: 'cinemaroll-push',
    entry: 'aws-lambda/push-notify.js',
    files: {
      'aws-lambda/push-notify.js': 'index.js',
      'aws-lambda/pushCadence.js': 'pushCadence.js',
      'aws-lambda/feedRevision.js': 'feedRevision.js',
      'aws-lambda/filmClubSync.js': 'filmClubSync.js',
      'aws-lambda/filmClubSyncPublisher.js': 'filmClubSyncPublisher.js',
      'aws-lambda/clubNotices.js': 'clubNotices.js',
      'aws-lambda/sweepClock.js': 'sweepClock.js',
      'aws-lambda/sentryLambda.js': 'sentryLambda.js',
      'aws-lambda/pushFit.js': 'pushFit.js'
    },
    dependencies: ['web-push'],
    // index.js hands the VAPID keys to web-push as it loads, and web-push
    // refuses a missing one; the load check gets a throwaway pair.
    loadSetup: "const k = require('web-push').generateVAPIDKeys(); process.env.VAPID_PUBLIC_KEY = k.publicKey; process.env.VAPID_PRIVATE_KEY = k.privateKey;",
    minBytes: 150000
  },
  ai: {
    functionName: 'cinemaroll-ai',
    entry: 'aws-lambda/claude-ai.js',
    files: {
      'aws-lambda/claude-ai.js': 'claude-ai.js',
      'aws-lambda/criticReviews.js': 'criticReviews.js',
      'aws-lambda/sentryLambda.js': 'sentryLambda.js'
    },
    dependencies: ['@anthropic-ai/sdk', '@aws-sdk/client-dynamodb', '@aws-sdk/client-lambda'],
    minBytes: 2000000
  },
  // Was its own bash script until 2026-10-24, with a node_modules installed
  // once into $TMPDIR and reused — the folder that went hollow and shipped a
  // Lambda missing web-push (2026-10-07). Starting from the deployed zip pins
  // the SDK versions to what is running instead.
  newsletter: {
    functionName: 'cinemaroll-newsletter',
    entry: 'aws-lambda/newsletter.js',
    files: {
      'aws-lambda/newsletter.js': 'index.js',
      'aws-lambda/newsletterCompose.js': 'newsletterCompose.js',
      'aws-lambda/newsletterSources.js': 'newsletterSources.js',
      'aws-lambda/cinemaScore.js': 'cinemaScore.js',
      'aws-lambda/letterboxd.js': 'letterboxd.js',
      'aws-lambda/letterboxdSync.js': 'letterboxdSync.js',
      'aws-lambda/sentryLambda.js': 'sentryLambda.js',
      'aws-lambda/pushFit.js': 'pushFit.js'
    },
    dependencies: ['@anthropic-ai/sdk', '@aws-sdk/client-lambda', 'web-push'],
    // Like push, it hands the VAPID keys to web-push as it loads.
    loadSetup: "const k = require('web-push').generateVAPIDKeys(); process.env.VAPID_PUBLIC_KEY = k.publicKey; process.env.VAPID_PRIVATE_KEY = k.privateKey;",
    minBytes: 2000000
  }
};

/** The `./x` modules a source requires, as repo paths. */
export function localRequires (source, dir = 'aws-lambda') {
  return [...source.matchAll(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)]
    .map(([, name]) => `${dir}/${name.endsWith('.js') ? name : `${name}.js`}`);
}

/** Every local module the entry reaches, following requires through each file. */
export function reachableFiles (entry, read = (path) => readFileSync(path, 'utf8')) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    for (const next of localRequires(read(queue.shift()))) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return [...seen];
}

function fail (message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function awsBinary () {
  if (process.env.AWS_CLI) return process.env.AWS_CLI;
  const universal = join(homedir(), 'aws-cli', 'aws');
  return existsSync(universal) ? universal : 'aws';
}

function aws (args) {
  const result = spawnSync(awsBinary(), [...args, '--profile', PROFILE, '--region', REGION], { encoding: 'utf8' });
  if (result.status !== 0) fail(`aws ${args.slice(0, 2).join(' ')} failed:\n${result.stderr}`);
  return result.stdout.trim();
}

async function main () {
  const which = process.argv[2];
  const dry = process.argv.includes('--dry');
  const lambda = LAMBDAS[which];
  if (!lambda) fail(`Say which Lambda: ${Object.keys(LAMBDAS).join(' or ')}.`);
  const { functionName, entry, files, dependencies, loadSetup = '', minBytes } = lambda;
  const sources = Object.keys(files);

  // The bundle list must hold everything the entry requires; a module added
  // to the code but not here would ship a Lambda that dies on load.
  const missing = reachableFiles(entry).filter((file) => !files[file]);
  if (missing.length) fail(`${entry} requires ${missing.join(', ')}, which this script doesn't bundle. Add it to LAMBDAS.${which}.files.`);

  execFileSync('node', ['scripts/sync-lambda-twins.mjs'], { stdio: 'ignore' });
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...sources], { encoding: 'utf8' }).trim();
  if (dirty) {
    fail(`These aren't committed (scripts/sync-lambda-twins.mjs has just run, so a twin listed here was stale):\n${dirty}\nCommit them, then deploy. A deploy ships commits.`);
  }

  for (const file of sources) {
    const check = spawnSync('node', ['--check', file], { stdio: 'inherit' });
    if (check.status !== 0) fail(`${file} does not parse. Nothing deployed.`);
  }
  console.log(`✓ ${sources.length} sources committed and parse`);

  const bundle = join(process.env.TMPDIR || tmpdir(), `${functionName}-bundle`);
  rmSync(bundle, { recursive: true, force: true });
  mkdirSync(bundle, { recursive: true });
  const location = aws(['lambda', 'get-function', '--function-name', functionName, '--query', 'Code.Location', '--output', 'text']);
  const response = await fetch(location, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) fail(`Downloading the deployed ${functionName} zip answered ${response.status}.`);
  const current = join(bundle, '..', `${functionName}-current.zip`);
  writeFileSync(current, Buffer.from(await response.arrayBuffer()));
  execFileSync('unzip', ['-q', '-o', current, '-d', bundle]);
  for (const [from, to] of Object.entries(files)) copyFileSync(from, join(bundle, to));

  // Loading the entry loads every local module and every dependency it names
  // at the top; the named dependencies are required by name as well, in case
  // one is only reached lazily.
  const loaded = spawnSync('node', ['-e', `
    ${loadSetup}
    const m = require('./${files[entry]}');
    if (typeof m.handler !== 'function') { console.error('no handler export'); process.exit(1); }
    for (const d of ${JSON.stringify(dependencies)}) require(d);
  `], { cwd: bundle, stdio: 'inherit', env: { ...process.env, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' } });
  if (loaded.status !== 0) fail(`The bundled ${files[entry]} does not load. Nothing deployed. Bundle: ${bundle}`);
  console.log(`✓ bundle loads, handler exported, ${dependencies.join(', ')} present`);

  const zip = join(bundle, '..', `${functionName}.zip`);
  rmSync(zip, { force: true });
  execFileSync('zip', ['-q', '-r', zip, '.'], { cwd: bundle });
  const bytes = statSync(zip).size;
  if (bytes < minBytes) fail(`${functionName}.zip is only ${bytes} bytes (a healthy one is over ${minBytes}) — node_modules looks hollow. Nothing deployed.`);
  console.log(`✓ ${functionName}.zip is ${Math.round(bytes / 1024)} KB`);

  if (dry) {
    console.log(`\n--dry: stopping before the upload. Bundle: ${bundle}`);
    return;
  }

  aws(['lambda', 'update-function-code', '--function-name', functionName, '--zip-file', `fileb://${zip}`, '--query', 'LastUpdateStatus', '--output', 'text']);
  for (let i = 0; i < 40; i++) {
    const status = aws(['lambda', 'get-function-configuration', '--function-name', functionName, '--query', 'LastUpdateStatus', '--output', 'text']);
    if (status === 'Successful') { console.log(`\n✓ ${functionName} updated`); return; }
    if (status === 'Failed') fail(`${functionName} update failed — see the Lambda console.`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  fail(`${functionName} is still updating after two minutes — check the Lambda console.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
