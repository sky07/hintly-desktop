import React, { createContext, useContext, useState } from 'react'
import { useAuthStore } from './stores/authStore'
import TitleBar from './components/TitleBar'
import Login from './components/Login'
import Dashboard, { SessionSettings } from './components/Dashboard'
import Session from './components/Session'

type View = 'login' | 'dashboard' | 'session'

const DEFAULT_SETTINGS: SessionSettings = {
  context: {
    jobDescription: '',
    resume: '',
    workExperience: '',
  },
  provider: 'groq',
  promptKey: 'personalized',
  verbosity: 'concise',
}

// Overlay context — components read this to switch to transparent backgrounds
export const OverlayContext = createContext({
  isOverlay: false,
  setIsOverlay: (_v: boolean) => {},
})

export function useOverlay() {
  return useContext(OverlayContext)
}

export default function App() {
  const { token, user } = useAuthStore()
  const [view, setView] = useState<View>(token && user ? 'dashboard' : 'login')
  const [sessionSettings, setSessionSettings] = useState<SessionSettings>(DEFAULT_SETTINGS)
  const [isOverlay, setIsOverlay] = useState(false)

  const handleLoginSuccess = () => setView('dashboard')

  const handleLogout = () => {
    useAuthStore.getState().logout()
    setView('login')
  }

  const handleStartSession = (settings: SessionSettings) => {
    setSessionSettings(settings)
    setView('session')
  }

  const handleEndSession = () => setView('dashboard')

  const currentView = token && user ? view : 'login'

  return (
    <OverlayContext.Provider value={{ isOverlay, setIsOverlay }}>
      <div
        className="h-screen flex flex-col text-gray-100"
        style={{ backgroundColor: isOverlay ? 'rgba(26, 26, 46, 0.15)' : '#1a1a2e' }}
      >
        <TitleBar />
        <div className="flex-1 overflow-hidden flex flex-col">
          {currentView === 'login' && (
            <Login onSuccess={handleLoginSuccess} />
          )}
          {currentView === 'dashboard' && (
            <Dashboard
              onStartSession={handleStartSession}
              onLogout={handleLogout}
            />
          )}
          {currentView === 'session' && (
            <Session settings={sessionSettings} onEnd={handleEndSession} />
          )}
        </div>
      </div>
    </OverlayContext.Provider>
  )
}
