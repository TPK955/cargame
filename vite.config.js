import { defineConfig } from 'vite';

export default defineConfig(async () => {
  const useDevHttps = process.env.VITE_DEV_HTTPS === '1';
  const plugins = [];

  if (useDevHttps) {
    const { default: basicSsl } = await import('@vitejs/plugin-basic-ssl');
    plugins.push(basicSsl());
  }

  return {
    plugins,
    build: {
      rollupOptions: {
        output: {
          entryFileNames: 'assets/bumpercars-app-[hash].js',
          chunkFileNames: 'assets/chunks/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name?.endsWith('.css')) {
              return 'assets/bumpercars-styles-[hash][extname]';
            }

            return 'assets/[name]-[hash][extname]';
          },
        },
      },
    },
  };
});