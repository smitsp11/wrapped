import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: { viewer: resolve(import.meta.dirname, 'index.html'), maker: resolve(import.meta.dirname, 'maker.html') },
    },
  },
})
