import React, { useEffect, useRef, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useWebSocket, Suggestion } from '../hooks/useWebSocket'
import { useAudioCapture, AudioChunkData, SpeechTimingData } from '../hooks/useAudioCapture'
import { SessionSettings } from './Dashboard'
import { useOverlay } from '../App'

interface SessionProps {
  settings: SessionSettings
  onEnd: () => void
}

export default function Session({ settings, onEnd }: SessionProps) {
  const {
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
  } = useWebSocket()

  const { isOverlay } = useOverlay()
  const [suggestionsMuted, setSuggestionsMuted] = useState(false)

  // Track current speaker for speaker.update messages
  const currentSpeakerRef = useRef<'user' | 'interviewer'>('interviewer')

  // Use a ref so the audio worklet always calls the latest sendAudio
  const sendAudioRef = useRef(sendAudio)
  sendAudioRef.current = sendAudio

  // Keep sendMessage ref current for callbacks
  const sendMessageRef = useRef(sendMessage)
  sendMessageRef.current = sendMessage

  const audioSendCountRef = useRef(0)
  const onAudioDataRef = useRef<(data: ArrayBuffer) => void>((data) => {
    audioSendCountRef.current++
    if (audioSendCountRef.current % 10 === 1) {
      console.log(`[Session] Sending audio chunk #${audioSendCountRef.current}, size: ${data.byteLength} bytes`)
    }
    sendAudioRef.current(data)
  })

  // Rich audio chunk handler — detect speaker changes and forward to backend
  const onAudioChunkRef = useRef<(chunk: AudioChunkData) => void>((chunk) => {
    if (chunk.speaker !== currentSpeakerRef.current) {
      currentSpeakerRef.current = chunk.speaker
      sendMessageRef.current({
        type: 'speaker.update',
        speaker: chunk.speaker,
      })
    }
  })

  // Speech timing handler — forward to backend for turn detection
  // Throttle to every 300ms to avoid flooding the WebSocket
  const lastTimingSentRef = useRef(0)
  const lastIsSpeakingRef = useRef(true)
  const onSpeechTimingRef = useRef<(timing: SpeechTimingData) => void>((timing) => {
    const now = Date.now()
    const stateChanged = timing.isSpeaking !== lastIsSpeakingRef.current
    // Send immediately on state change (speech→silence or silence→speech),
    // otherwise throttle to every 300ms
    if (stateChanged || now - lastTimingSentRef.current >= 300) {
      lastTimingSentRef.current = now
      lastIsSpeakingRef.current = timing.isSpeaking
      sendMessageRef.current({
        type: 'speech.timing',
        isSpeaking: timing.isSpeaking,
        silenceDurationMs: timing.silenceDurationMs,
      })
    }
  })

  const { startCapture, stopCapture, setStreamingMode, isCapturing, micLevel, error: audioError } =
    useAudioCapture(onAudioDataRef, onAudioChunkRef, onSpeechTimingRef)

  const [localError, setLocalError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showTranscript, setShowTranscript] = useState(false)

  // Auto-scroll when new suggestions arrive
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [suggestions.length, streamingSuggestion])

  const handleStart = useCallback(async () => {
    setLocalError(null)

    try {
      await connect()
    } catch (err) {
      console.error('WebSocket connect error:', err)
      setLocalError('Failed to connect to server. Please check your internet connection.')
      return
    }

    sendMessage({
      type: 'session.start',
      context: settings.context,
      verbosity: settings.verbosity,
      provider: settings.provider,
      promptKey: settings.promptKey,
    })

    try {
      const started = await startCapture()
      if (!started) {
        setLocalError('Could not capture system audio. Please enable Stereo Mix in Windows Sound settings.')
        return
      }
    } catch (err) {
      console.error('Audio capture error:', err)
      setLocalError('Failed to capture system audio')
      return
    }

    if (sttMode === 'streaming') {
      setStreamingMode(true)
    }
  }, [connect, sendMessage, startCapture, setStreamingMode, sttMode, settings])

  const handleStop = () => {
    sendMessage({ type: 'session.end' })
    stopCapture()
    disconnect()
    clearSuggestions()
    onEnd()
  }

  const handleToggleMute = () => {
    const newMuted = !suggestionsMuted
    setSuggestionsMuted(newMuted)
    toggleSuggestions(!newMuted) // backend: enabled=true means NOT muted
  }

  // Start session on mount
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      if (cancelled) return
      await handleStart()
    }
    init()
    return () => {
      cancelled = true
      stopCapture()
      disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const displayError = localError || sessionError || audioError

  const statusColor =
    status === 'connected'
      ? 'bg-green-500'
      : status === 'connecting'
      ? 'bg-yellow-500 animate-pulse'
      : 'bg-red-500'

  const micBarWidth = Math.min(micLevel * 500, 100)
  const latestTranscript = transcripts.length > 0 ? transcripts[transcripts.length - 1] : null

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800"
        style={{ backgroundColor: isOverlay ? 'rgba(22, 22, 42, 0.4)' : '#16162a' }}
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-[10px] text-gray-400 capitalize">{status}</span>
          {suggestions.length > 0 && (
            <span className="text-[10px] text-gray-600">
              {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Mute/Unmute suggestions */}
          <button
            onClick={handleToggleMute}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              suggestionsMuted
                ? 'bg-amber-600/30 text-amber-300'
                : 'bg-emerald-600/30 text-emerald-300'
            }`}
            title={suggestionsMuted ? 'Resume AI suggestions' : 'Pause AI suggestions'}
          >
            {suggestionsMuted ? 'AI OFF' : 'AI ON'}
          </button>
          {/* Toggle transcript view */}
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
              showTranscript
                ? 'bg-blue-600/30 text-blue-300'
                : 'bg-gray-700/50 text-gray-400 hover:text-gray-300'
            }`}
            title="Toggle transcript"
          >
            TXT
          </button>
          <button
            onClick={handleStop}
            className="px-3 py-1 text-[10px] bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded transition-colors"
          >
            Stop
          </button>
        </div>
      </div>

      {/* Error display */}
      {displayError && (
        <div className="px-3 py-1.5 bg-red-900/20 border-b border-red-800/30">
          <p className="text-[10px] text-red-400">{displayError}</p>
        </div>
      )}

      {/* Muted banner */}
      {suggestionsMuted && (
        <div className="px-3 py-1 bg-amber-900/20 border-b border-amber-800/30">
          <p className="text-[10px] text-amber-400 text-center">Suggestions paused</p>
        </div>
      )}

      {/* Live transcript bar */}
      {latestTranscript && !showTranscript && (
        <div
          className="px-3 py-1.5 border-b border-gray-800/50"
          style={{ backgroundColor: isOverlay ? 'rgba(13, 13, 31, 0.3)' : '#0d0d1f' }}
        >
          <p className="text-[10px] text-gray-500 truncate">
            <span className={latestTranscript.speaker === 'user' ? 'text-blue-400' : 'text-amber-400'}>
              {latestTranscript.speaker === 'user' ? 'You' : 'Interviewer'}:
            </span>{' '}
            <span className="text-gray-400">{latestTranscript.text}</span>
          </p>
        </div>
      )}

      {/* Main content area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {showTranscript ? (
          <div className="space-y-1.5">
            {transcripts.length === 0 && (
              <p className="text-xs text-gray-600 text-center py-4">Listening for speech...</p>
            )}
            {transcripts.map((t) => (
              <div key={t.id} className={`text-xs leading-relaxed ${t.isNewTurn ? 'mt-3' : ''}`}>
                <span className={`font-medium ${t.speaker === 'user' ? 'text-blue-400' : 'text-amber-400'}`}>
                  {t.speaker === 'user' ? 'You' : 'Interviewer'}
                </span>
                <span className="text-gray-300 ml-1.5">{t.text}</span>
                {!t.isFinal && <span className="text-gray-600 ml-1">...</span>}
              </div>
            ))}
          </div>
        ) : (
          <>
            {streamingSuggestion && (
              <SuggestionCard suggestion={streamingSuggestion} isStreaming overlay={isOverlay} />
            )}
            {suggestions.map((s) => (
              <SuggestionCard key={s.id} suggestion={s} overlay={isOverlay} />
            ))}
            {suggestions.length === 0 && !streamingSuggestion && status === 'connected' && (
              <div className="text-center py-8">
                <div className="w-8 h-8 mx-auto mb-3 rounded-full bg-purple-600/10 flex items-center justify-center">
                  <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                  </svg>
                </div>
                <p className="text-xs text-gray-500">Listening...</p>
                <p className="text-[10px] text-gray-600 mt-1">
                  Suggestions appear when questions are detected
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Mic level indicator */}
      <div
        className="px-3 py-1.5 border-t border-gray-800"
        style={{ backgroundColor: isOverlay ? 'rgba(22, 22, 42, 0.4)' : '#16162a' }}
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-3 h-3 ${isCapturing ? 'text-green-400' : 'text-gray-600'}`}
            fill="currentColor"
            viewBox="0 0 16 16"
          >
            <path d="M8 11a3 3 0 003-3V4a3 3 0 10-6 0v4a3 3 0 003 3z" />
            <path d="M13 8a1 1 0 10-2 0A3 3 0 115 8a1 1 0 10-2 0 5 5 0 004 4.9V14H5.5a.5.5 0 000 1h5a.5.5 0 000-1H9v-1.1A5 5 0 0013 8z" />
          </svg>
          <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-75 rounded-full"
              style={{ width: `${micBarWidth}%` }}
            />
          </div>
          <span className="text-[9px] text-gray-600 w-8 text-right">
            {isCapturing ? `${Math.round(micBarWidth)}%` : 'OFF'}
          </span>
        </div>
      </div>
    </div>
  )
}

function SuggestionCard({
  suggestion,
  isStreaming = false,
  overlay = false,
}: {
  suggestion: Suggestion
  isStreaming?: boolean
  overlay?: boolean
}) {
  const bgStyle = isStreaming
    ? { backgroundColor: overlay ? 'rgba(88, 28, 135, 0.15)' : 'rgba(88, 28, 135, 0.1)' }
    : { backgroundColor: overlay ? 'rgba(15, 15, 35, 0.5)' : '#0f0f23' }

  return (
    <div
      className={`rounded-lg p-2.5 border ${
        isStreaming ? 'border-purple-700/30' : 'border-gray-800/50'
      }`}
      style={bgStyle}
    >
      {isStreaming && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
          <span className="text-[9px] text-purple-400 font-medium">Generating...</span>
        </div>
      )}

      {/* Markdown-rendered response */}
      <div className="text-xs text-gray-200 leading-relaxed suggestion-content">
        <MarkdownResponse text={suggestion.response} />
      </div>

      {suggestion.keyPoints?.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {suggestion.keyPoints.map((point, i) => (
            <li key={i} className="text-[10px] text-gray-400 flex items-start gap-1">
              <span className="text-emerald-400 mt-0.5 shrink-0">&#8226;</span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      )}

      {suggestion.followUp && (
        <p className="mt-1.5 text-[10px] text-gray-500 italic">
          {suggestion.followUp}
        </p>
      )}

      {!isStreaming && (
        <p className="mt-1.5 text-[9px] text-gray-600">
          {suggestion.timestamp.toLocaleTimeString()}
        </p>
      )}
    </div>
  )
}

/** Render suggestion text with full markdown support */
function MarkdownResponse({ text }: { text: string }) {
  if (!text) return null

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="text-xs text-gray-200 leading-relaxed mb-2 last:mb-0">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-gray-100">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-gray-300">{children}</em>
        ),
        h1: ({ children }) => (
          <h1 className="text-sm font-semibold text-gray-100 mb-1 mt-2 first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-xs font-semibold text-gray-100 mb-1 mt-2 first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-[11px] font-semibold text-emerald-400/90 uppercase tracking-wider mb-1 mt-2 first:mt-0">{children}</h3>
        ),
        ul: ({ children }) => (
          <ul className="space-y-0.5 mb-2 last:mb-0 ml-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="space-y-0.5 mb-2 last:mb-0 ml-1 list-decimal list-inside marker:text-emerald-400/60">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="text-xs text-gray-300 flex items-start gap-1.5">
            <span className="mt-[5px] w-1 h-1 rounded-full bg-emerald-400/50 flex-shrink-0" />
            <span className="flex-1">{children}</span>
          </li>
        ),
        code: ({ children, className: codeClassName }) => {
          const isBlock = codeClassName?.startsWith('language-')
          if (isBlock) {
            return (
              <code className={`block bg-white/[0.04] rounded px-2.5 py-2 text-[10px] font-mono text-emerald-300/90 overflow-x-auto mb-2 whitespace-pre ${codeClassName || ''}`}>
                {children}
              </code>
            )
          }
          return (
            <code className="px-1 py-0.5 bg-white/[0.08] rounded text-[10px] font-mono text-emerald-300/80">
              {children}
            </code>
          )
        },
        pre: ({ children }) => (
          <pre className="bg-white/[0.03] border border-white/[0.06] rounded overflow-x-auto mb-2 last:mb-0">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-emerald-400/40 pl-3 py-0.5 mb-2 last:mb-0 text-gray-400 italic text-[11px]">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-white/[0.08] my-2" />,
        table: ({ children }) => (
          <div className="overflow-x-auto mb-2 last:mb-0">
            <table className="w-full text-[10px] border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="border-b border-white/[0.1]">{children}</thead>
        ),
        tbody: ({ children }) => (
          <tbody className="divide-y divide-white/[0.04]">{children}</tbody>
        ),
        tr: ({ children }) => <tr>{children}</tr>,
        th: ({ children }) => (
          <th className="px-2 py-1 text-left text-[9px] font-semibold text-gray-400 uppercase tracking-wider">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-2 py-1 text-gray-300">{children}</td>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}
