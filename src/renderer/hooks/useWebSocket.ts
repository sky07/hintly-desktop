import { useCallback, useRef, useEffect, useState } from 'react'
import { useAuthStore } from '../stores/authStore'
import { WS_URL } from '../config'

export interface Suggestion {
  id: string
  timestamp: Date
  response: string
  keyPoints: string[]
  followUp: string
  isStreaming?: boolean
}

export interface TranscriptEntry {
  id: string
  speaker: 'user' | 'interviewer'
  text: string
  isFinal: boolean
  isNewTurn: boolean
  timestamp: Date
}

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface SessionContext {
  jobDescription: string
  resume: string
  workExperience: string
  companyName?: string
  roleType?: string
  roundType?: string
}

interface SessionStartMessage {
  type: 'session.start'
  context: SessionContext
  verbosity: 'concise' | 'moderate' | 'detailed'
  provider?: string
  promptKey?: string
  preparedAnswers?: string
}

interface SessionEndMessage {
  type: 'session.end'
}

interface PingMessage {
  type: 'ping'
  timestamp: number
}

interface SpeakerUpdateMessage {
  type: 'speaker.update'
  speaker: 'user' | 'interviewer'
}

interface SpeechTimingMessage {
  type: 'speech.timing'
  isSpeaking: boolean
  silenceDurationMs: number
}

interface SuggestionsToggleMessage {
  type: 'suggestions.toggle'
  enabled: boolean
}

interface ScreenContextMessage {
  type: 'screen.context'
  text?: string
  image?: string  // base64 PNG for screenshot
  source: 'paste' | 'screenshot' | 'clipboard'
}

type ClientMessage =
  | SessionStartMessage
  | SessionEndMessage
  | PingMessage
  | SpeakerUpdateMessage
  | SpeechTimingMessage
  | SuggestionsToggleMessage
  | ScreenContextMessage

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null)
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('idle')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [streamingSuggestion, setStreamingSuggestion] = useState<Suggestion | null>(null)
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([])
  const [sttMode, setSttMode] = useState<'chunked' | 'streaming'>('chunked')
  const [sessionError, setSessionError] = useState<string | null>(null)
  const suggestionsMutedRef = useRef(false)

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data)
      if (message.type !== 'pong') {
        console.log('[WS] Received:', message.type, message.type === 'error' ? message.message : '')
      }

      switch (message.type) {
        case 'session.ready':
          setStatus('connected')
          if (message.sttMode) setSttMode(message.sttMode)
          break

        case 'connection.status':
          if (message.status === 'connected') setStatus('connected')
          break

        case 'transcript.delta': {
          const entry: TranscriptEntry = {
            id: message.id,
            speaker: message.speaker || 'interviewer',
            text: message.text || '',
            isFinal: message.isFinal ?? true,
            isNewTurn: message.isNewTurn ?? false,
            timestamp: new Date(),
          }
          setTranscripts((prev) => {
            // Update existing entry or add new
            const idx = prev.findIndex((t) => t.id === entry.id)
            if (idx >= 0) {
              const updated = [...prev]
              updated[idx] = entry
              return updated
            }
            return [...prev, entry]
          })
          break
        }

        case 'suggestion.delta':
          if (suggestionsMutedRef.current) break
          setStreamingSuggestion((prev) => {
            if (message.isFirst || !prev) {
              return {
                id: message.id,
                timestamp: new Date(),
                response: message.delta,
                keyPoints: [],
                followUp: '',
                isStreaming: true,
              }
            }
            return {
              ...prev,
              response: prev.response + message.delta,
            }
          })
          break

        case 'suggestion.cancel':
          setStreamingSuggestion(null)
          break

        case 'suggestion': {
          if (suggestionsMutedRef.current) {
            setStreamingSuggestion(null)
            break
          }
          const suggestion: Suggestion = {
            id: message.id,
            timestamp: new Date(),
            response: message.response,
            keyPoints: message.keyPoints || [],
            followUp: message.followUp || '',
          }
          setStreamingSuggestion(null)
          setSuggestions((prev) => [suggestion, ...prev])
          break
        }

        case 'pong':
          break

        case 'credits.warning':
        case 'credits.exhausted':
          console.warn('[WS] Credit warning:', message.message)
          break

        case 'credits.force_end':
          console.warn('[WS] Session force-ended:', message.message)
          setSessionError(message.message)
          break

        case 'error':
          console.error('Server error:', message.code, message.message)
          setSessionError(message.message)
          if (!message.recoverable) setStatus('error')
          break
      }
    } catch (error) {
      console.error('Error parsing message:', error)
    }
  }, [])

  const connect = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        resolve()
        return
      }

      setStatus('connecting')
      setSessionError(null)
      const token = useAuthStore.getState().token
      const wsUrl = token ? `${WS_URL}?token=${encodeURIComponent(token)}` : WS_URL
      console.log('[WS] Connecting to:', wsUrl)

      let settled = false
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          ws.close()
          setStatus('error')
          reject(new Error('WebSocket connection timeout'))
        }
      }, 10000)

      ws.onopen = () => {
        clearTimeout(timeout)
        if (!settled) {
          settled = true
          console.log('[WS] Connected successfully')
          pingIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))
            }
          }, 5000)
          resolve()
        }
      }

      ws.onmessage = handleMessage

      ws.onclose = (event) => {
        clearTimeout(timeout)
        console.log('[WS] Closed:', event.code, event.reason)
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current)
          pingIntervalRef.current = null
        }
        if (!settled) {
          settled = true
          setStatus('error')
          reject(new Error(`WebSocket closed (code: ${event.code})`))
        } else {
          setStatus('idle')
        }
      }

      ws.onerror = () => {
        clearTimeout(timeout)
        console.error('[WS] Error — could not connect to', wsUrl)
        if (!settled) {
          settled = true
          setStatus('error')
          reject(new Error(`WebSocket failed to connect to ${WS_URL}`))
        }
      }
    })
  }, [handleMessage])

  const disconnect = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current)
      pingIntervalRef.current = null
    }
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setStatus('idle')
  }, [])

  const sendMessage = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    }
  }, [])

  const sendAudio = useCallback((audioData: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(audioData)
    }
  }, [])

  const toggleSuggestions = useCallback((enabled: boolean) => {
    suggestionsMutedRef.current = !enabled
    sendMessage({ type: 'suggestions.toggle', enabled })
  }, [sendMessage])

  const clearSuggestions = useCallback(() => {
    setSuggestions([])
    setStreamingSuggestion(null)
    setTranscripts([])
    setSessionError(null)
  }, [])

  useEffect(() => {
    return () => { disconnect() }
  }, [disconnect])

  return {
    connect,
    disconnect,
    sendMessage,
    sendAudio,
    toggleSuggestions,
    status,
    suggestions,
    streamingSuggestion,
    transcripts,
    sttMode,
    sessionError,
    clearSuggestions,
  }
}
