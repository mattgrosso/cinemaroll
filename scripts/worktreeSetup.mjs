// Make a linked git worktree able to build, deploy and run the admin
// scripts, by linking it to the main checkout's untracked essentials.
//
// Why (2026-09-29): sessions started from Bug Desk run in the background and
// are fenced into a worktree under .claude/worktrees/ so they can't disturb
// the checkout the dev server runs from. But a fresh worktree has none of
// the gitignored files: no .env (the API keys AND the app version), no
// .env.local (the admin key path), no node_modules. So nothing could deploy
// from one.
//
// These are SYMLINKS to the main checkout's copies, never copies: there is
// one version counter, and a bump made from any worktree lands in the main
// checkout's .env (writeFileSync follows the link). Copies would fork the
// counter and ship two different builds under one number.
//
// Idempotent, and a no-op in the main checkout. Run directly, or imported.
import { existsSync, lstatSync, symlinkSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const SHARED = ['.env', '.env.local', 'node_modules'];

function git (args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// { worktreeRoot, mainRoot, isLinkedWorktree }
export function checkoutRoots (cwd = process.cwd()) {
  const worktreeRoot = git(['rev-parse', '--show-toplevel'], cwd);
  const commonDir = resolve(worktreeRoot, git(['rev-parse', '--git-common-dir'], cwd));
  const mainRoot = dirname(commonDir);
  return { worktreeRoot, mainRoot, isLinkedWorktree: resolve(mainRoot) !== resolve(worktreeRoot) };
}

export function ensureWorktreeSetup ({ cwd = process.cwd(), quiet = false } = {}) {
  const roots = checkoutRoots(cwd);
  if (!roots.isLinkedWorktree) return roots;

  SHARED.forEach((name) => {
    const target = join(roots.mainRoot, name);
    const link = join(roots.worktreeRoot, name);
    let present = false;
    try { lstatSync(link); present = true; } catch { /* missing */ }
    if (present || !existsSync(target)) return;
    symlinkSync(target, link);
    if (!quiet) console.log(`linked ${name} -> main checkout`);
  });
  return roots;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureWorktreeSetup();
}
