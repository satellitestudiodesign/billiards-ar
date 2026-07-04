import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // ponytail: mkcert cert for phone WebXR over LAN. Regen: mkcert -cert-file certs/cert.pem -key-file certs/key.pem <your-lan-ip> localhost 127.0.0.1
    https: {
      cert: readFileSync('certs/cert.pem'),
      key: readFileSync('certs/key.pem'),
    },
  },
  resolve: {
    dedupe: ['@react-three/fiber', 'three'],
  },
})
