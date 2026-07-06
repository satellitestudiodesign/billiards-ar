import { createRoot } from 'react-dom/client'
import { ChakraProvider } from '@chakra-ui/react'
import { App } from './App'
import { system } from './system'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <ChakraProvider value={system}>
    <App />
  </ChakraProvider>,
)
