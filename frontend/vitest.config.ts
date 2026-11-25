import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Opt-in live tests assert global summary deltas against one dedicated DB.
    // Running files concurrently would let unrelated fixtures change that baseline.
    fileParallelism: false,
  },
})