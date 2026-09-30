import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    // src/test/emulated needs the Firebase emulator around it (yarn
    // test:emulated), so it is not part of a plain `yarn test:run`.
    // Linked worktrees (.claude/worktrees/*) carry their own copy of the
    // suite; running them from the main checkout doubles the run and fails
    // on whatever the branch hasn't merged yet.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/test/emulated/**', '.claude/worktrees/**'],
    setupFiles: ['./src/test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '.history/', // VS Code Local History snapshots — not real source
        'aws-lambda/', // separate deployable (own package.json/node_modules), not part of this app's test universe — same "pollutes the number" issue .history/ had
        'src/test/',
        '**/*.test.js',
        '**/*.spec.js',
        'dist/',
        '*.config.js'
      ]
    },
    // Suppress console warnings in tests
    silent: false,
    onConsoleLog: (log) => {
      // Suppress Sass deprecation warnings
      if (log.includes('DEPRECATION WARNING: The legacy JS API is deprecated')) {
        return false
      }
      return true
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  }
})