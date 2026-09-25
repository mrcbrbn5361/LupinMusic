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
        play: path.resolve(__dirname, 'play.html')
      }
    }
  },
  server: {
    port: 5173
  }
};
