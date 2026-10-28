import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/literata/opsz.css'
import '@fontsource-variable/literata/opsz-italic.css'
import './styles/tokens.css'
import './styles/app.css'
import { createRoot } from 'react-dom/client'
import { App } from './components/App'

createRoot(document.getElementById('root')!).render(<App />)
