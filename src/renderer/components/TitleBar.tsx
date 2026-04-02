import React from 'react'
import { useOverlay } from '../App'

declare global {
  interface Window {
    electronAPI?: {
      toggleAlwaysOnTop: () => Promise<boolean>
      setOverlayMode: (enabled: boolean) => Promise<boolean>
      minimize: () => void
      close: () => void
      getDisplays: () => Promise<Array<{
        id: number
        label: string
        bounds: { x: number; y: number; width: number; height: number }
        primary: boolean
      }>>
      getResourcePath: (filename: string) => Promise<string>
      getDesktopSources: () => Promise<Array<{
        id: string
        name: string
        thumbnail: unknown
      }>>
    }
  }
}

export default function TitleBar() {
  const { isOverlay, setIsOverlay } = useOverlay()

  const toggleOverlay = async () => {
    const newMode = !isOverlay
    await window.electronAPI?.setOverlayMode(newMode)
    setIsOverlay(newMode)
  }

  return (
    <div
      className="h-8 flex items-center justify-between px-3 select-none shrink-0"
      style={{
        WebkitAppRegion: 'drag',
        backgroundColor: isOverlay ? 'rgba(22, 22, 42, 0.4)' : '#16162a',
      } as React.CSSProperties}
    >
      <span className="text-xs font-medium text-gray-400 tracking-wide">
        Interview Assistant
      </span>

      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Overlay toggle */}
        <button
          onClick={toggleOverlay}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
            isOverlay
              ? 'bg-purple-600/30 text-purple-300'
              : 'bg-gray-700/50 text-gray-400 hover:text-gray-300'
          }`}
          title={isOverlay ? 'Overlay mode (transparent)' : 'Normal window mode'}
        >
          {isOverlay ? 'OVR' : 'WIN'}
        </button>

        {/* Minimize */}
        <button
          onClick={() => window.electronAPI?.minimize()}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-gray-700/50 text-gray-400 hover:text-gray-200 transition-colors"
        >
          <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
            <rect width="10" height="1" />
          </svg>
        </button>

        {/* Close */}
        <button
          onClick={() => window.electronAPI?.close()}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-600/50 text-gray-400 hover:text-red-300 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="1" y1="1" x2="9" y2="9" />
            <line x1="9" y1="1" x2="1" y2="9" />
          </svg>
        </button>
      </div>
    </div>
  )
}
