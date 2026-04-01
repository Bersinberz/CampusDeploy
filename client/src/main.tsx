import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import DeployPage from './pages/DeployPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeployPage />
  </StrictMode>,
)
