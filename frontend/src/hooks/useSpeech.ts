import { useCallback, useEffect, useRef, useState } from 'react'

interface UseSpeechReturn {
  transcript: string
  isListening: boolean
  start: () => void
  stop: () => void
  reset: () => void
  supported: boolean
  error: string | null
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone permission denied. Allow it in the address bar and try again.',
  'service-not-allowed': 'Speech recognition blocked by browser settings.',
  'network': 'Network error reaching the speech service. Check your connection.',
  'audio-capture': 'No microphone detected.',
  'aborted': '',
  'no-speech': '',
}

export function useSpeech(): UseSpeechReturn {
  const [transcript, setTranscript] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  const supported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onresult = null
        recognitionRef.current.onstart = null
        recognitionRef.current.onend = null
        recognitionRef.current.onerror = null
        try { recognitionRef.current.abort() } catch { /* not started */ }
      }
    }
  }, [])

  const start = useCallback(() => {
    if (!supported) return
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SR) return

    // Tear down any existing instance so results buffer starts fresh
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null
      recognitionRef.current.onstart = null
      recognitionRef.current.onend = null
      recognitionRef.current.onerror = null
      try { recognitionRef.current.abort() } catch { /* ignore */ }
    }

    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      let full = ''
      for (let i = 0; i < e.results.length; i++) {
        full += e.results[i][0].transcript
      }
      setTranscript(full)
    }
    rec.onstart = () => setIsListening(true)
    rec.onend = () => setIsListening(false)
    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      const message = ERROR_MESSAGES[e.error]
      if (message === undefined) {
        setError(`Speech recognition error: ${e.error}`)
      } else if (message) {
        setError(message)
      }
      setIsListening(false)
    }

    recognitionRef.current = rec
    setError(null)
    try {
      rec.start()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start recording')
    }
  }, [supported])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const reset = useCallback(() => {
    setTranscript('')
    setError(null)
  }, [])

  return { transcript, isListening, start, stop, reset, supported, error }
}
