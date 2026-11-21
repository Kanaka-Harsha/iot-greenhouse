import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// envDir '..': locally, VITE_API_URL is read from the project-root .env.
// On Vercel, set VITE_API_URL in Project Settings -> Environment Variables instead.
export default defineConfig({
  plugins: [react()],
  envDir: '..',
  server: { port: 5173 },
})
