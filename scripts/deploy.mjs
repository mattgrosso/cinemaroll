// `yarn deploy`: ship to cinemaroll.org from the main checkout OR from any
// linked worktree (2026-09-29 — Bug Desk sessions live in worktrees, and
// "you need to be able to deploy from here"). Matt chose this over turning
// the worktree fence off: the fence stays up while work happens, and only
// shipping crosses it.
//
// From a worktree, the branch ships the way a session in the main checkout
// always did it by hand — "merge to main, then deploy":
//   1. the worktree must be committed and clean;
//   2. the branch must already contain local `main` (else: rebase first —
//      this never rebases for you, because a conflict needs a human eye);
//   3. the main checkout, which must be ON main, is fast-forwarded to the
//      branch (`merge --ff-only`, which refuses rather than overwrite any
//      uncommitted file there), and main is pushed;
//   4. then the usual bump + build + upload, from the worktree.
// The dev server running from the main checkout sees step 3 as ordinary
// file changes, exactly as it did when merges happened there.
//
// From the main checkout nothing git-side happens, as before.
//
// The version bump goes through the shared .env (worktreeSetup.mjs), and the
// upload uses a working aws binary — the one on PATH is x86-only on this Mac
// and dies with "Bad CPU type" (2026-09-27).
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { ensureWorktreeSetup } from './worktreeSetup.mjs';

const BUCKET = 's3://cinemaroll';
const DISTRIBUTION = 'ETF4I2E64GQSC';
const PROFILE = 'personal-deploy';

function git (args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fail (message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function run (command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) fail(`${command} ${args[0] || ''} failed.`);
}

function awsBinary () {
  if (process.env.AWS_CLI) return process.env.AWS_CLI;
  const universal = join(homedir(), 'aws-cli', 'aws');
  return existsSync(universal) ? universal : 'aws';
}

function shipWorktreeToMain ({ worktreeRoot, mainRoot }) {
  if (git(['status', '--porcelain'], worktreeRoot)) {
    fail('This worktree has uncommitted changes. Commit them first; a deploy ships commits, not a working tree.');
  }
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], worktreeRoot);
  try {
    git(['merge-base', '--is-ancestor', 'main', 'HEAD'], worktreeRoot);
  } catch {
    fail(`${branch} doesn't contain the latest main. Run \`git rebase main\` here, re-test, then deploy again.`);
  }
  const mainBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], mainRoot);
  if (mainBranch !== 'main') {
    fail(`The main checkout is on ${mainBranch}, not main. Not touching it.`);
  }
  console.log(`\nShipping ${branch} to main (fast-forward in the main checkout)...`);
  const merge = spawnSync('git', ['merge', '--ff-only', branch], { cwd: mainRoot, stdio: 'inherit' });
  if (merge.status !== 0) fail('Fast-forwarding main failed (see above). Nothing was deployed.');
  const push = spawnSync('git', ['push', 'origin', 'main'], { cwd: mainRoot, stdio: 'inherit' });
  if (push.status !== 0) console.warn('\n! Pushing main to origin failed; deploying anyway. Push it by hand afterwards.');
}

function main () {
  const roots = ensureWorktreeSetup();
  if (!existsSync(join(roots.worktreeRoot, '.env'))) fail('No .env here or in the main checkout.');

  // 2026-10-05: lint + tests run HERE, before anything merges or ships. CI runs
  // the same two commands after the push, so a red tree used to reach
  // cinemaroll.org first and GitHub's failure email second (four times that
  // day). Nothing red leaves this machine now. `--skip-checks` is for a
  // hotfix when the suite itself is what's broken; CI still runs regardless.
  if (!process.argv.includes('--skip-checks')) {
    console.log('\nChecking before shipping (yarn lint, yarn test:run; --skip-checks to bypass)...');
    run('yarn', ['lint']);
    run('yarn', ['test:run']);
  }

  if (roots.isLinkedWorktree) shipWorktreeToMain(roots);

  run('node', ['scripts/bump-and-build.mjs']);

  const aws = awsBinary();
  run(aws, ['s3', 'sync', 'dist/', BUCKET, '--delete', '--profile', PROFILE]);
  const invalidation = spawnSync(aws, ['cloudfront', 'create-invalidation', '--distribution-id', DISTRIBUTION, '--paths', '/*', '--profile', PROFILE], { encoding: 'utf8' });
  if (invalidation.status !== 0) {
    process.stderr.write(invalidation.stderr || '');
    fail('The files are uploaded but the CloudFront invalidation failed; rerun it by hand.');
  }
  writeFileSync('invalidation_output.txt', invalidation.stdout);

  const version = readFileSync('.env', 'utf8').match(/^VUE_APP_VERSION=(.*)$/m)?.[1];
  console.log(`\n✓ Deployed v${version} to cinemaroll.org`);
}

main();
