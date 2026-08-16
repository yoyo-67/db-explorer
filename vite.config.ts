import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  plugins: [
    // Console piping opens an EventSource per tab that never closes. Browsers
    // cap concurrent connections per origin, so a handful of open tabs used up
    // every socket and the next tab hung mid-hydration, stuck on the server-
    // rendered "Checking connection..." shell. The rest of devtools is fine.
    devtools({ consolePiping: { enabled: false } }),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
