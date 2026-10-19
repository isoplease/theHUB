import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { LanguageProvider } from './i18n.tsx'

// Her pencere yalnızca kendi görünümünü yükler; gizli pencereler tüm uygulamayı ayrıştırmaz.
const App = lazy(() => import('./App.tsx'))
const PanelView = lazy(() => import('./components/PanelView.tsx').then((m) => ({ default: m.PanelView })))
const JoystickView = lazy(() => import('./components/JoystickView.tsx').then((m) => ({ default: m.JoystickView })))
const StripView = lazy(() => import('./components/StripView.tsx').then((m) => ({ default: m.StripView })))

const view = new URLSearchParams(window.location.search).get('view')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <Suspense fallback={null}>
        {view === 'panel' ? <PanelView /> : view === 'joystick' ? <JoystickView /> : view === 'strip' ? <StripView /> : <App />}
      </Suspense>
    </LanguageProvider>
  </StrictMode>,
)
