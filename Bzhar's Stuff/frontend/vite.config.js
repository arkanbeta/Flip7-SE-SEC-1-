import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // The '' prefix loads ALL variables from .env for this config file only;
  // only VITE_-prefixed ones are ever exposed to browser code.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    // Vitest: tests run in a simulated browser (jsdom).
    test: {
      environment: 'jsdom',
      globals: true,
    },
    server: {
      port: 5173,
      strictPort: true, // fail instead of silently picking another port (CORS expects 5173)
      proxy: {
        // In development the browser talks only to localhost:5173 and Vite forwards
        // /api to the backend. Same origin = no CORS surprises, and session cookies
        // (Phase 2) behave exactly as they will in production.
        '/api': {
          target: env.DEV_API_TARGET || 'http://localhost:4000',
        },
        // Real-time connection (Socket.IO), same idea; ws: true lets WebSockets through.
        '/socket.io': {
          target: env.DEV_API_TARGET || 'http://localhost:4000',
          ws: true,
        },
      },
    },
  };
});
