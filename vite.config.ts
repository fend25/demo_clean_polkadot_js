import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    testTimeout: 60000, // Timeout in milliseconds
    hookTimeout: 60000 // Optional: Timeout for beforeAll/afterAll hooks
  }
})
