import { createRoot } from 'react-dom/client'

import { ReactPanel } from './ReactPanel'

const container = document.getElementById('root')
if (!container) throw new Error('#root not found in react.html')

createRoot(container).render(<ReactPanel />)
