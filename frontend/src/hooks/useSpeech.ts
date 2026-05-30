import { useCallback, useEffect, useRef, useState } from 'react'

interface UseSpeechReturn {
  transcript: string
  isListening: boolean
  start: () => void
  stop: () => void
  reset: () => void
  supported: boolean
}

export function useSpeech(): UseSpeechReturn {
  const [transcript, setTranscript] = useState('')
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  const supported =
    typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  useEffect(() => {
    if (!supported) return
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
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
    rec.onend = () => setIsListening(false)
    recognitionRef.current = rec
  }, [supported])

  const start = useCallback(() => {
    recognitionRef.current?.start()
    setIsListening(true)
  }, [])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }, [])

  const reset = useCallback(() => {
    setTranscript('')
  }, [])

  return { transcript, isListening, start, stop, reset, supported }
}
