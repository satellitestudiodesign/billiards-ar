import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base: '/' for local dev (LAN/tunnel), '/billiards-ar/' for the GitHub Pages
// build so asset URLs resolve under the project subpath.
// The dev server (mkcert https + tunnel hosts) is only configured for `serve`
// so the Pages build doesn't try to read the gitignored local certs.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/billiards-ar/' : '/',
  plugins: [react()],
  server:
    command === 'serve'
      ? {
          host: true,
          // Allow public tunnel domains (cloudflared / ngrok) to reach the dev
          // server from outside the LAN. Vite blocks unknown Host headers otherwise.
          allowedHosts: ['.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'],
          // ponytail: mkcert cert for phone WebXR over LAN. Regen: mkcert -cert-file certs/cert.pem -key-file certs/key.pem <your-lan-ip> localhost 127.0.0.1
          https: {
            cert: readFileSync('certs/cert.pem'),
            key: readFileSync('certs/key.pem'),
          },
        }
      : undefined,
  resolve: {
    dedupe: ['@react-three/fiber', 'three'],
  },
}))
