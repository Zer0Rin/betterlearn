import { createRoot } from 'react-dom/client'
import { CLIENT_CSS } from '../client/styles.js'
import { StandaloneApp } from './App.js'
import css from './styles.css'
import windowCss from './window.css'
import tokens from './tokens.css'
import materialCss from './material.css'
import bookshelfCss from './bookshelf.css'

const style = document.createElement('style')
style.textContent = `${tokens}\n${CLIENT_CSS}\n${css}\n${windowCss}\n${bookshelfCss}\n${materialCss}`
document.head.appendChild(style)
const container = document.getElementById('root')
if (!container) throw new Error('BetterLearn mount element is missing')
createRoot(container).render(<StandaloneApp />)
