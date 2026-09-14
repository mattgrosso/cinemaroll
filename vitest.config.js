import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
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