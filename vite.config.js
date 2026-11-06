import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'local-api',
      async configureServer(server) {
        const env = loadEnv(mode, process.cwd(), '');
        for (const key of [
          'MONGODB_URI',
          'MONGODB_DB',
          'APP_ORIGIN',
          'ADMIN_USERNAME',
          'ADMIN_PASSWORD_HASH',
        ]) {
          if (env[key] && !process.env[key]) process.env[key] = env[key];
        }
        const { default: handler } = await import('./api/index.js');
        server.middlewares.use('/api/index', handler);
      },
    },
  ],
  server: { port: 5173, strictPort: true },
}));
