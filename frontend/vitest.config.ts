import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Live tests share a database and compare global summary changes.
    fileParallelism: false,
  },
})