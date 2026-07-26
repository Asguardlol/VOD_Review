import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves this project from https://<user>.github.io/<repo>/, so the
// built asset URLs need that repo path as their base. Dev server stays at '/'.
// Override with VITE_BASE if the repo is renamed or moved to a custom domain
// (a custom domain serves from the root, so VITE_BASE=/ in that case).
const base = process.env.VITE_BASE ?? '/WoW_VOD_Review/'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? base : '/',
  plugins: [react()],
}))
