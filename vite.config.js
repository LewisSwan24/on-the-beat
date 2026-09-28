import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app lives in app/ and builds to dist/, which the relay serves. For
// `npm run dev`, Vite serves the app and hands the socket and the clips to a
// relay running beside it (`npm run relay`).
const RELAY = 'http://localhost:' + (process.env.RELAY_PORT || 8790);
// Two pages: the phone's app, and the venue team's staff page (served at /staff; /staff.html under Vite).
const page = (name) => fileURLToPath(new URL('./app/' + name, import.meta.url));

export default defineConfig({
  root: 'app',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, rolldownOptions: { input: { main: page('index.html'), staff: page('staff.html') } } },
  server: {
    port: 5178,
    proxy: {
      '/api': { target: RELAY, ws: true },
      '/clip': RELAY,
    },
  },
});
