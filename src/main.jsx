import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'           // ⬅️  makes Tailwind styles available
import BlockBlastAI from './BlockBlastAI.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BlockBlastAI />
  </React.StrictMode>,
)
