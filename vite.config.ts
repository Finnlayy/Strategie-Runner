import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    build: {
      outDir: 'dist',
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Preview-/Deployment-Hosts akzeptieren (AI Studio Cloud Run + Sandbox-Preview).
      // Ohne diesen Eintrag antwortet der Dev-Server auf fremde Host-Header mit 403.
      allowedHosts: process.env.ALLOWED_HOSTS
        ? process.env.ALLOWED_HOSTS.split(',').map(h => h.trim()).filter(Boolean)
        : (true as const),
    },
  };
});
