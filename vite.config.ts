import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const base = mode === 'pages' ? '/yeelock-pwa/' : '/';
  return {
    base,
    plugins: [react(), VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Yeelock Controller', short_name: 'Yeelock', display: 'standalone',
        start_url: base, scope: base, orientation: 'portrait-primary',
        theme_color: '#315ad9', background_color: '#111111',
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: { navigateFallback: `${base}index.html` },
    })],
  };
});
