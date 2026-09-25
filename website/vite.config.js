const path = require('path');

/** @type {import('vite').UserConfig} */
module.exports = {
  root: __dirname,
  base: '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        ozellikler: path.resolve(__dirname, 'ozellikler.html'),
        birlikte: path.resolve(__dirname, 'birlikte.html'),
        indir: path.resolve(__dirname, 'indir.html'),
        play: path.resolve(__dirname, 'play.html')
      }
    }
  },
  server: {
    port: 5173
  }
};
