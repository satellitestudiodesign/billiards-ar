import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

const config = defineConfig({
  globalCss: {
    'html, body': { colorPalette: 'teal' },
  },
  theme: {
    tokens: {
      fonts: {
        heading: { value: 'Inter, system-ui, sans-serif' },
        body: { value: 'Inter, system-ui, sans-serif' },
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)
