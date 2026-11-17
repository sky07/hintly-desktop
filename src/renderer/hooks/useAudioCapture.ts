import { useCallback, useRef, useState } from 'react'

export interface AudioChunkData {
  data: ArrayBuffer
  speaker: 'user' | 'interviewer'
  isSpeaking: boolean
  silenceDurationMs: number
}

export interface SpeechTimingData {
  isSpeaking: boolean
  silenceDurationMs: number
}

interface AudioCaptureResult {
  startCapture: () => Promise<boolean>
  stopCapture: () => void
  setStreamingMode: (enabled: boolean) => void
  isCapturing: boolean
  micLevel: number
  error: string | null
}

/**
 * Capture system audio via getDisplayMedia.
 * In Electron, the main process setDisplayMediaRequestHandler auto-selects
 * the screen + loopback audio, so no picker dialog appears.
 */
async function captureSystemAudio(): Promise<MediaStream | null> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,  // Required by the API, but we discard it
      audio: true,
    })

    // Drop video track immediately — we only need audio
    stream.getVideoTracks().forEach((t) => t.stop())

    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop())
      console.warn('[Audio] getDisplayMedia returned no audio tracks')
      return null
    }

    console.log('[Audio] Captured system audio via getDisplayMedia:', stream.getAudioTracks()[0].label)
    return stream
  } catch (err) {
    console.warn('[Audio] getDisplayMedia failed:', err)
    return null
  }
}

/**
 * Fallback: capture via a loopback device (Stereo Mix, What U Hear, etc.).
 * Needs a preliminary getUserMedia to unlock device labels.
 */
async function captureViaLoopbackDevice(): Promise<MediaStream | null> {
  let tempStream: MediaStream | null = null
  try {
    tempStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    console.warn('[Audio] Could not get temp mic stream to unlock device labels')
    return null
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    tempStream.getTracks().forEach((t) => t.stop())

    console.log(
      '[Audio] Audio input devices:',
      devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => `${d.label} (${d.deviceId.slice(0, 8)})`)
    )

    const loopbackDevice = devices.find(
      (d) =>
        d.kind === 'audioinput' &&
        (d.label.toLowerCase().includes('stereo mix') ||
          d.label.toLowerCase().includes('loopback') ||
          d.label.toLowerCase().includes('what u hear') ||
          d.label.toLowerCase().includes('wave out'))
    )

    if (!loopbackDevice) {
      console.warn('[Audio] No loopback audio device found')
      return null
    }

    console.log('[Audio] Found loopback device:', loopbackDevice.label)
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: loopbackDevice.deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  } catch (err) {
    tempStream?.getTracks().forEach((t) => t.stop())
    console.warn('[Audio] Loopback device capture failed:', err)
    return null
  }
}

export function useAudioCapture(
  onAudioDataRef: React.MutableRefObject<((data: ArrayBuffer) => void) | undefined>,
  onAudioChunkRef?: React.MutableRefObject<((chunk: AudioChunkData) => void) | undefined>,
  onSpeechTimingRef?: React.MutableRefObject<((timing: SpeechTimingData) => void) | undefined>
): AudioCaptureResult {
  const [isCapturing, setIsCapturing] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const systemStreamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)

  const startCapture = useCallback(async (): Promise<boolean> => {
    setError(null)

    try {
      let systemStream: MediaStream | null = null

      // Strategy 1: getDisplayMedia with Electron's auto-selection (no dialog)
      systemStream = await captureSystemAudio()

      // Strategy 2: Loopback device (Stereo Mix / What U Hear)
      if (!systemStream) {
        systemStream = await captureViaLoopbackDevice()
      }

      if (!systemStream || systemStream.getAudioTracks().length === 0) {
        setError(
          'Could not capture system audio. Please enable "Stereo Mix" in Windows Sound settings: ' +
          'Right-click speaker icon > Sounds > Recording tab > right-click > Show Disabled Devices > Enable Stereo Mix'
        )
        return false
      }

      console.log('[Audio] System audio track:', systemStream.getAudioTracks()[0].label)
      systemStreamRef.current = systemStream

      const audioContext = new AudioContext({ sampleRate: 24000 })
      audioContextRef.current = audioContext

      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      // Load audio worklet processor
      // When running on dev server (localhost), use relative URL served by webpack devServer.
      // When running from packaged files (file://), resolve via Electron's resource path.
      let workletUrl = '/audio-worklet-processor.js'
      const isLocalFile = window.location.protocol === 'file:'
      if (isLocalFile && window.electronAPI?.getResourcePath) {
        const resourcePath = await window.electronAPI.getResourcePath('audio-worklet-processor.js')
        workletUrl = `file://${resourcePath.replace(/\\/g, '/')}`
      }
      await audioContext.audioWorklet.addModule(workletUrl)
      console.log('[Audio] Worklet module loaded')

      const systemSource = audioContext.createMediaStreamSource(systemStream)

      // The candidate's microphone is optional: without it the session still
      // works, it just cannot hear what the candidate says.
      let micStream: MediaStream | null = null
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // Echo cancellation keeps the interviewer's voice, playing through
            // the speakers, from being picked up again as the candidate
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
        micStreamRef.current = micStream
        console.log('[Audio] Microphone track:', micStream.getAudioTracks()[0]?.label)
      } catch (err) {
        console.warn('[Audio] Microphone not available, continuing with system audio only:', err)
      }

      const merger = audioContext.createChannelMerger(2)
      if (micStream) {
        // Channel 0: microphone (candidate). Channel 1: system audio (interviewer).
        audioContext.createMediaStreamSource(micStream).connect(merger, 0, 0)
        systemSource.connect(merger, 0, 1)
      } else {
        // Route system audio to both channels of the merger so the worklet's
        // mixed signal (ch0*0.5 + ch1*0.5) equals the original system level.
        systemSource.connect(merger, 0, 0)
        systemSource.connect(merger, 0, 1)
      }

      const workletNode = new AudioWorkletNode(
        audioContext,
        'audio-merger-processor'
      )
      workletNodeRef.current = workletNode

      workletNode.port.onmessage = (event) => {
        const msg = event.data
        if (msg.type === 'audio') {
          onAudioDataRef.current?.(msg.data)
          onAudioChunkRef?.current?.({
            data: msg.data,
            // With a microphone the worklet says who is louder; without one
            // everything heard is the interviewer.
            speaker: micStream && msg.speaker === 'user' ? 'user' : 'interviewer',
            isSpeaking: msg.isSpeaking ?? true,
            silenceDurationMs: msg.silenceDurationMs ?? 0,
          })
        } else if (msg.type === 'speechTiming') {
          // Forward real-time speech timing from worklet (every ~500ms)
          // so the backend gets timely silence notifications for turn detection
          onSpeechTimingRef?.current?.({
            isSpeaking: msg.isSpeaking ?? true,
            silenceDurationMs: msg.silenceDurationMs ?? 0,
          })
        } else if (msg.type === 'levels') {
          setMicLevel(msg.system || msg.mic)
        }
      }

      merger.connect(workletNode)
      workletNode.connect(audioContext.destination)

      // System audio mode: always send audio chunks to the backend (no VAD gating),
      // but keep VAD active at a low threshold for speech timing (turn detection).
      // The backend needs isSpeaking=false + silenceDurationMs>=1500 to trigger suggestions.
      workletNode.port.postMessage({ type: 'setSystemAudioMode', threshold: 0.001 })
      workletNode.port.postMessage({ type: 'setMicConnected', enabled: !!micStream })

      systemStream.getAudioTracks()[0]?.addEventListener('ended', () => {
        stopCapture()
      })

      console.log(`[Audio] Pipeline connected: ${micStream ? 'mic + ' : ''}system audio → merger → worklet → destination`)
      setIsCapturing(true)
      return true
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to capture audio'
      setError(message)
      console.error('[Audio] Capture error:', err)
      stopCapture()
      return false
    }
  }, [onAudioDataRef, onAudioChunkRef, onSpeechTimingRef])

  const stopCapture = useCallback(() => {
    systemStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current?.getTracks().forEach((track) => track.stop())
    micStreamRef.current = null
    workletNodeRef.current?.disconnect()
    audioContextRef.current?.close()

    systemStreamRef.current = null
    workletNodeRef.current = null
    audioContextRef.current = null

    setMicLevel(0)
    setIsCapturing(false)
  }, [])

  const setStreamingMode = useCallback((enabled: boolean) => {
    workletNodeRef.current?.port.postMessage({
      type: 'setStreamingMode',
      enabled,
    })
  }, [])

  return {
    startCapture,
    stopCapture,
    setStreamingMode,
    isCapturing,
    micLevel,
    error,
  }
}
