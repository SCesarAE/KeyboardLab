import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages sirve la app en /KeyboardLab/
export default defineConfig({
  base: '/KeyboardLab/',
  plugins: [react()],
})
