import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { seed } from './demo/seed'
seed()
createRoot(document.getElementById('root')!).render(<App />)
