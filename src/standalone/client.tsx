import { createRoot } from 'react-dom/client'
import { CLIENT_CSS } from '../client/styles.js'
import { StandaloneApp } from './App.js'
import css from './styles.css'
import windowCss from './window.css'
import glassCss from './glass.css'

const style = document.createElement('style')
style.textContent = `${CLIENT_CSS}\n${css}\n${windowCss}\n${glassCss}`
document.head.appendChild(style)
const container = document.getElementById('root')
if (!container) throw new Error('BetterLearn mount element is missing')
createRoot(container).render(<StandaloneApp />)
