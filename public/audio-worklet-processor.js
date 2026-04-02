/**
 * AudioWorklet processor for merging mic and system audio
 * with Voice Activity Detection (VAD) and smart chunking.
 *
 * Supports two modes:
 * - CHUNKED (default): VAD-based, sends 2-second chunks only during speech (for Whisper)
 * - STREAMING: Sends all audio continuously in 200ms packets (for Deepgram)
 *
 * Features:
 * - VAD: Only sends audio when speech is detected in chunked mode (saves 70% bandwidth)
 * - 2-second chunking with 0.5-second overlap for word boundary handling (chunked mode)
 * - 200ms continuous packets including silence (streaming mode, Deepgram handles VAD)
 * - Converts to PCM16 format at 16kHz for STT compatibility
 */

class AudioMergerProcessor extends AudioWorkletProcessor {
  constructor() {
    super()

    // Audio parameters
    this.inputSampleRate = 24000  // AudioContext sample rate
    this.outputSampleRate = 16000 // STT expects 16kHz
    this.resampleRatio = this.outputSampleRate / this.inputSampleRate

    // Chunking configuration (in samples at output rate) — for chunked/Whisper mode
    this.chunkDurationSec = 2       // Send 2-second chunks for lower latency
    this.overlapDurationSec = 0.5   // 0.5-second overlap for word boundaries
    this.chunkSamples = this.outputSampleRate * this.chunkDurationSec  // 32000 samples
    this.overlapSamples = this.outputSampleRate * this.overlapDurationSec  // 8000 samples

    // Main audio buffer (holds up to chunk + overlap) — for chunked mode
    this.buffer = new Float32Array(this.chunkSamples + this.overlapSamples)
    this.bufferIndex = 0

    // Streaming mode configuration (for Deepgram continuous streaming)
    this.streamingMode = false
    this.streamChunkMs = 200  // Send 200ms packets
    this.streamChunkSamples = Math.floor(this.outputSampleRate * this.streamChunkMs / 1000)  // 3200 samples
    this.streamBuffer = new Float32Array(this.streamChunkSamples)
    this.streamBufferIndex = 0

    // VAD configuration
    // Note: VAD runs on the mixed signal (mic*0.5 + system*0.5), so raw mic RMS is halved.
    // 0.015 means raw mic needs ~0.03 RMS to trigger — filters ambient noise but catches normal speech.
    this.vadThreshold = 0.015       // RMS threshold for speech detection
    this.vadHangoverMs = 300        // Keep recording 300ms after speech ends
    this.vadHangoverSamples = Math.floor(this.outputSampleRate * this.vadHangoverMs / 1000)
    this.silenceSamples = 0         // Counter for silence duration
    this.isSpeaking = false
    this.speechStarted = false

    // Statistics for debugging
    this.frameCount = 0
    this.audioChunksSent = 0
    this.silenceSkipped = 0

    // Speaker detection - accumulate energy per chunk
    this.chunkMicEnergy = 0
    this.chunkSystemEnergy = 0

    // Speech timing for accurate turn detection (Option B1) — chunked mode only
    // Use frame counting for accurate timing (each frame = 128 samples at inputSampleRate)
    this.speechEndFrame = null  // Frame number when speech ended
    this.lastSpeechFrame = 0  // Frame number of last speech detected
    this.msPerFrame = (128 / this.inputSampleRate) * 1000  // ~5.33ms per frame at 24kHz

    // Listen for configuration changes from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'setStreamingMode') {
        this.streamingMode = event.data.enabled
        if (this.streamingMode) {
          // Reset streaming buffer
          this.streamBuffer = new Float32Array(this.streamChunkSamples)
          this.streamBufferIndex = 0
          console.log('[AudioWorklet] Switched to STREAMING mode (200ms continuous packets for Deepgram)')
        } else {
          console.log('[AudioWorklet] Switched to CHUNKED mode (VAD-based for Whisper)')
        }
      } else if (event.data.type === 'setVadThreshold') {
        this.vadThreshold = event.data.threshold
        console.log('[AudioWorklet] VAD threshold set to', this.vadThreshold)
      } else if (event.data.type === 'setSystemAudioMode') {
        // System audio mode: always send audio chunks (no VAD gating on send),
        // but still track speech/silence for turn detection timing.
        this.systemAudioMode = true
        this.vadThreshold = event.data.threshold || 0.001
        console.log('[AudioWorklet] System audio mode enabled — sending all audio, VAD threshold for timing:', this.vadThreshold)
      }
    }
  }

  /**
   * Calculate RMS level for audio data (for VAD and UI meters)
   */
  calculateLevel(samples) {
    if (!samples || samples.length === 0) return 0
    let sum = 0
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i]
    }
    return Math.sqrt(sum / samples.length)
  }

  /**
   * Simple linear resampling from input rate to output rate
   */
  resample(inputSamples) {
    const outputLength = Math.floor(inputSamples.length * this.resampleRatio)
    const output = new Float32Array(outputLength)

    for (let i = 0; i < outputLength; i++) {
      const srcIdx = i / this.resampleRatio
      const idx = Math.floor(srcIdx)
      const frac = srcIdx - idx

      const sample0 = inputSamples[idx] || 0
      const sample1 = inputSamples[idx + 1] || sample0

      output[i] = sample0 * (1 - frac) + sample1 * frac
    }

    return output
  }

  /**
   * Convert Float32 audio to PCM16
   */
  floatToPCM16(float32Array) {
    const pcm16 = new Int16Array(float32Array.length)
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]))
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return pcm16
  }

  /**
   * Send audio chunk to main thread (chunked/Whisper mode)
   */
  sendChunk(includeOverlap = false) {
    if (this.bufferIndex < this.outputSampleRate * 0.5) {
      // Don't send chunks shorter than 0.5 seconds
      return
    }

    // Copy buffer data for sending
    const dataToSend = new Float32Array(this.bufferIndex)
    dataToSend.set(this.buffer.subarray(0, this.bufferIndex))

    // Convert to PCM16
    const pcm16 = this.floatToPCM16(dataToSend)

    // Determine dominant speaker based on accumulated levels for this chunk
    // Mic picks up speaker bleed from the interviewer's audio, so require mic
    // energy to be significantly higher (3x) before classifying as 'user'.
    const dominantSpeaker = this.chunkMicEnergy > this.chunkSystemEnergy * 3 ? 'user' : 'interviewer'

    // Calculate silence duration using frame counting (more accurate than sample counting)
    let silenceDurationMs = 0
    if (this.speechEndFrame !== null) {
      // Speech has ended - calculate how long ago
      const framesSinceSpeechEnd = this.frameCount - this.speechEndFrame
      silenceDurationMs = framesSinceSpeechEnd * this.msPerFrame
    } else if (!this.isSpeaking && this.lastSpeechFrame > 0) {
      // Never detected speech end properly, use lastSpeechFrame
      const framesSinceLastSpeech = this.frameCount - this.lastSpeechFrame
      silenceDurationMs = framesSinceLastSpeech * this.msPerFrame
    }

    // Send to main thread with speech timing for accurate turn detection
    this.port.postMessage(
      {
        type: 'audio',
        data: pcm16.buffer,
        duration: this.bufferIndex / this.outputSampleRate,
        speechDetected: this.speechStarted,
        speaker: dominantSpeaker,
        micEnergy: this.chunkMicEnergy,
        systemEnergy: this.chunkSystemEnergy,
        // Speech timing for Option B1 turn detection
        isSpeaking: this.isSpeaking,  // Whether speech is currently active
        silenceDurationMs: silenceDurationMs,  // How long silence has lasted (accurate)
      },
      [pcm16.buffer]
    )

    this.audioChunksSent++
    // Reset chunk energy counters
    this.chunkMicEnergy = 0
    this.chunkSystemEnergy = 0

    // Keep overlap for next chunk (last 0.5 seconds)
    if (includeOverlap && this.bufferIndex > this.overlapSamples) {
      const overlap = this.buffer.subarray(this.bufferIndex - this.overlapSamples, this.bufferIndex)
      this.buffer.set(overlap)
      this.bufferIndex = this.overlapSamples
    } else {
      this.buffer = new Float32Array(this.chunkSamples + this.overlapSamples)
      this.bufferIndex = 0
    }

    this.speechStarted = false
  }

  /**
   * Send streaming audio packet to main thread (streaming/Deepgram mode)
   */
  sendStreamPacket() {
    if (this.streamBufferIndex === 0) return

    const dataToSend = this.streamBuffer.subarray(0, this.streamBufferIndex)
    const pcm16 = this.floatToPCM16(dataToSend)
    const dominantSpeaker = this.chunkMicEnergy > this.chunkSystemEnergy ? 'user' : 'interviewer'

    this.port.postMessage(
      {
        type: 'audio',
        data: pcm16.buffer,
        duration: this.streamBufferIndex / this.outputSampleRate,
        speechDetected: true,  // Always true in streaming mode (Deepgram handles VAD)
        speaker: dominantSpeaker,
        micEnergy: this.chunkMicEnergy,
        systemEnergy: this.chunkSystemEnergy,
        isSpeaking: this.isSpeaking,
        silenceDurationMs: 0,
      },
      [pcm16.buffer]
    )

    this.audioChunksSent++
    this.chunkMicEnergy = 0
    this.chunkSystemEnergy = 0
    this.streamBuffer = new Float32Array(this.streamChunkSamples)
    this.streamBufferIndex = 0
  }

  process(inputs, outputs, parameters) {
    // The ChannelMerger combines both sources into a single input with 2 channels:
    // - Channel 0: Microphone audio
    // - Channel 1: System audio (from screen share)
    const input = inputs[0]
    const micInput = input?.[0] || new Float32Array(128)
    const systemInput = input?.[1] || new Float32Array(128)

    // Calculate levels for UI meters
    const micLevel = this.calculateLevel(micInput)
    const systemLevel = this.calculateLevel(systemInput)

    // Accumulate energy for speaker detection per chunk
    this.chunkMicEnergy += micLevel * micLevel * micInput.length
    this.chunkSystemEnergy += systemLevel * systemLevel * systemInput.length

    // Send levels every 10th frame to reduce message frequency
    this.frameCount++
    if (this.frameCount % 10 === 0) {
      this.port.postMessage({
        type: 'levels',
        mic: micLevel,
        system: systemLevel,
      })

      // Send speech timing updates only in chunked mode (Deepgram handles turn detection)
      if (!this.streamingMode) {
        let silenceDurationMs = 0
        if (this.speechEndFrame !== null) {
          const framesSinceSpeechEnd = this.frameCount - this.speechEndFrame
          silenceDurationMs = framesSinceSpeechEnd * this.msPerFrame
        } else if (!this.isSpeaking && this.lastSpeechFrame > 0) {
          const framesSinceLastSpeech = this.frameCount - this.lastSpeechFrame
          silenceDurationMs = framesSinceLastSpeech * this.msPerFrame
        }

        this.port.postMessage({
          type: 'speechTiming',
          isSpeaking: this.isSpeaking,
          silenceDurationMs: silenceDurationMs,
        })
      }
    }

    // Mix both inputs
    const mixed = new Float32Array(micInput.length)
    for (let i = 0; i < micInput.length; i++) {
      mixed[i] = micInput[i] * 0.5 + systemInput[i] * 0.5
    }

    // VAD detection — used for speech timing (turn detection) and chunked mode gating
    const mixedLevel = this.calculateLevel(mixed)
    const speechDetected = mixedLevel > this.vadThreshold

    if (speechDetected) {
      this.isSpeaking = true
      this.speechStarted = true
      this.silenceSamples = 0
      // Reset speech end tracking when speech resumes
      this.speechEndFrame = null
      this.lastSpeechFrame = this.frameCount
    } else if (this.isSpeaking) {
      // In hangover period - keep recording briefly after speech ends
      this.silenceSamples += mixed.length
      // vadHangoverSamples is at output rate, silenceSamples at input rate
      // Convert: hangover at input rate = vadHangoverSamples * (inputRate/outputRate)
      const hangoverSamplesAtInputRate = this.vadHangoverSamples * (this.inputSampleRate / this.outputSampleRate)
      if (this.silenceSamples > hangoverSamplesAtInputRate) {
        this.isSpeaking = false
        // Speech ended - record the frame number
        this.speechEndFrame = this.frameCount
        // In chunked mode (non-system-audio): send what we have when speech ends
        if (!this.streamingMode && !this.systemAudioMode && this.bufferIndex > 0) {
          this.sendChunk(false)  // Don't overlap after speech ends
        }
      }
    }

    if (this.streamingMode) {
      // STREAMING MODE: Send all audio continuously in 200ms packets
      // Deepgram handles VAD, endpointing, and utterance detection
      const resampled = this.resample(mixed)
      for (let i = 0; i < resampled.length; i++) {
        this.streamBuffer[this.streamBufferIndex++] = resampled[i]
        if (this.streamBufferIndex >= this.streamChunkSamples) {
          this.sendStreamPacket()
        }
      }
    } else if (this.systemAudioMode) {
      // SYSTEM AUDIO MODE: Always send audio chunks (backend needs continuous data),
      // but VAD still tracks isSpeaking/silence for turn detection timing.
      // Use smaller chunks (0.5s) for lower latency instead of the default 2s.
      const resampled = this.resample(mixed)
      const systemChunkSamples = this.outputSampleRate * 0.5  // 8000 samples = 0.5s
      for (let i = 0; i < resampled.length; i++) {
        this.buffer[this.bufferIndex++] = resampled[i]
        if (this.bufferIndex >= systemChunkSamples) {
          this.sendChunk(false)  // No overlap needed for small chunks
        }
      }
    } else if (this.isSpeaking || speechDetected) {
      // CHUNKED MODE: Only buffer audio during speech (or hangover period)
      // Resample to 16kHz for Whisper
      const resampled = this.resample(mixed)

      // Add to buffer
      for (let i = 0; i < resampled.length; i++) {
        this.buffer[this.bufferIndex++] = resampled[i]

        // When chunk is full, send it with overlap
        if (this.bufferIndex >= this.chunkSamples) {
          this.sendChunk(true)  // Include overlap for word boundaries
        }
      }
    } else {
      this.silenceSkipped++
    }

    // Debug log every 5 seconds
    if (this.frameCount % (24000 / 128 * 5) === 0) {
      const mode = this.streamingMode ? 'STREAMING' : 'CHUNKED'
      console.log(`[${mode}] Chunks sent: ${this.audioChunksSent}, Silence skipped: ${this.silenceSkipped} frames`)
    }

    return true // Keep processor alive
  }
}

registerProcessor('audio-merger-processor', AudioMergerProcessor)
