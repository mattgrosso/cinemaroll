const fs = require('fs');
const dotenv = require('dotenv');

// Load the environment variables
dotenv.config();

// Get the current version number
const currentVersion = process.env.VUE_APP_VERSION;
const [major, minor, patch] = currentVersion.split('.').map(Number);

console.log(`Current version: ${currentVersion}`);
console.log('\nSemantic Versioning Guide:');
console.log('• 1 - PATCH (x.x.X): Bug fixes, small tweaks, no new features');
console.log('• 2 - MINOR (x.X.x): New features, backwards-compatible changes');
console.log('• 3 - MAJOR (X.x.x): Breaking changes, incompatible API changes');

function waitForKeypress (timeout = 20000) {
  // Lets a non-interactive caller (an agent running `yarn build`/`yarn
  // deploy`) specify the bump explicitly instead of always falling through
  // to PATCH: `VERSION_BUMP=minor yarn deploy` (or `major`/`patch`).
  const envBump = { patch: '1', minor: '2', major: '3' }[(process.env.VERSION_BUMP || '').toLowerCase()];
  if (envBump) {
    console.log(`\n(VERSION_BUMP=${process.env.VERSION_BUMP} — skipping the prompt)`);
    return Promise.resolve(envBump);
  }

  // process.stdin.setRawMode only exists on a real TTY. In a non-interactive
  // shell (a script, a CI job, or an agent running `yarn build`/`yarn
  // deploy`) it's not a function at all and throws immediately — there's
  // also no one there to press a key, so skip straight to the same PATCH
  // default the interactive prompt times out to after 20s, without the wait.
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    console.log('\n(non-interactive shell — defaulting to PATCH increment)');
    return Promise.resolve('1');
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      if (timeoutId) clearTimeout(timeoutId);
    };

    // Set up timeout
    const timeoutId = setTimeout(() => {
      cleanup();
      console.log('\n⏰ No input received, defaulting to PATCH increment...');
      resolve('1'); // Default to patch
    }, timeout);

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', (key) => {
      cleanup();
      resolve(key.toString());
    });
  });
}

async function determineVersionBump () {
  console.log('\nWhat type of changes are you releasing?');
  console.log('Press: 1, 2, or 3 (or Enter for patch) - Auto-patch in 20 seconds');

  const key = await waitForKeypress();
  const choice = key;

  let newVersion;

  switch (choice) {
    case '3':
      newVersion = `${major + 1}.0.0`;
      console.log('📋 MAJOR version bump - Breaking changes');
      break;

    case '2':
      newVersion = `${major}.${minor + 1}.0`;
      console.log('✨ MINOR version bump - New features');
      break;

    case '1':
    case '\r': // Enter key
    case '\n': // Enter key
    case ' ': // Spacebar
      newVersion = `${major}.${minor}.${patch + 1}`;
      console.log('🔧 PATCH version bump - Bug fixes/tweaks');
      break;

    case '\u0003': // Ctrl+C
      console.log('\nVersion update cancelled.');
      process.exit(0);
      break;

    default:
      console.log('Invalid choice. Defaulting to PATCH increment.');
      newVersion = `${major}.${minor}.${patch + 1}`;
  }

  // Update the .env file immediately
  const envConfig = dotenv.parse(fs.readFileSync('.env'));
  envConfig.VUE_APP_VERSION = newVersion;
  fs.writeFileSync('.env', Object.entries(envConfig).map(([key, value]) => `${key}=${value}`).join('\n'));

  console.log(`✅ Version updated to ${newVersion}`);
  process.exit(0);
}

determineVersionBump().catch(console.error);