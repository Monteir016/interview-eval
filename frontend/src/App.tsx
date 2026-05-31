import { useState, useEffect, useRef } from 'react'
import type { AnswerEvaluation, Question, QuestionSet, SessionSummary } from './types'
import { useSpeech } from './hooks/useSpeech'
import { EvaluationCard } from './components/EvaluationCard'
import { HistoryView } from './components/HistoryView'
import { SessionDetail } from './components/SessionDetail'
import { cleanTranscript, streamEvaluation, createSession, saveAnswer, fetchSessionSummary, generateQuestions, patchSession } from './api/client'

type View = 'setup' | 'session' | 'done' | 'history'

const GENERATING_STEPS = ['Fetching job description…', 'Researching company…', 'Crafting questions…']

export default function App() {
  const [view, setView] = useState<View>('setup')
  const [questions, setQuestions] = useState<Question[]>([])
  const [qIndex, setQIndex] = useState(0)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [evaluation, setEvaluation] = useState<Partial<AnswerEvaluation>>({})
  const [streaming, setStreaming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [evaluationsList, setEvaluationsList] = useState<AnswerEvaluation[]>([])
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [networkError, setNetworkError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [generatedSet, setGeneratedSet] = useState<QuestionSet | null>(null)
  const [jdUrl, setJdUrl] = useState('')
  const [generating, setGenerating] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null)
  const [selectedSessionName, setSelectedSessionName] = useState<string | null>(null)
  const [generatingStep, setGeneratingStep] = useState(0)
  const [generateAbort, setGenerateAbort] = useState<AbortController | null>(null)
  const [setupStep, setSetupStep] = useState<'choose' | 'manual' | 'generated'>('choose')
  const [manualText, setManualText] = useState('')
  const [questionCount, setQuestionCount] = useState(10)
  const [copied, setCopied] = useState(false)
  const [recordElapsed, setRecordElapsed] = useState(0)
  const recordStartedAtRef = useRef(0)
  const [showTranscript, setShowTranscript] = useState(true)
  const [answersLog, setAnswersLog] = useState<Array<{ question: string; transcript: string; evaluated: boolean }>>([])
  const [submitting, setSubmitting] = useState(false)
  const [copiedAnswers, setCopiedAnswers] = useState(false)
  const [sessionName, setSessionName] = useState('')
  const [sessionNameSaving, setSessionNameSaving] = useState(false)
  const [editingTranscript, setEditingTranscript] = useState(false)
  const [editTranscriptValue, setEditTranscriptValue] = useState('')
  const [manualTranscript, setManualTranscript] = useState<string | null>(null)
  const [editingAnswerIndex, setEditingAnswerIndex] = useState<number | null>(null)
  const [editAnswerValue, setEditAnswerValue] = useState('')

  useEffect(() => {
    if (!generating) return
    const id = setInterval(() => setGeneratingStep(s => (s + 1) % GENERATING_STEPS.length), 5000)
    return () => clearInterval(id)
  }, [generating])

  const { transcript, isListening, start, stop, reset, supported, error: speechError } = useSpeech()
  const effectiveTranscript = manualTranscript ?? transcript

  useEffect(() => {
    if (!isListening) return
    const id = setInterval(() => {
      setRecordElapsed(Math.floor((Date.now() - recordStartedAtRef.current) / 1000))
    }, 250)
    return () => clearInterval(id)
  }, [isListening])

  function formatTime(s: number) {
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  }

  function handleStartRecording() {
    reset()
    setManualTranscript(null)
    setEditingTranscript(false)
    setRecordElapsed(0)
    recordStartedAtRef.current = Date.now()
    start()
  }

  function handleRestartRecording() {
    reset()
    setManualTranscript(null)
    setEditingTranscript(false)
    setRecordElapsed(0)
    recordStartedAtRef.current = Date.now()
    start()
  }

  function handleSkipQuestion() {
    if (isListening) stop()
    goToNextOrFinish()
  }

  function parseManualText(text: string): Question[] {
    const entries = text
      .split(/\n(?=-)/)
      .map(chunk => chunk.replace(/^-\s*/, '').trim())
      .filter(Boolean)
    if (entries.length === 0) throw new Error('Add at least one question starting with -')
    if (entries.length > 10) throw new Error('Maximum is 10 questions.')
    return entries.map((entry, i) => {
      const sep = entry.lastIndexOf('|')
      if (sep === -1) {
        throw new Error(`Question ${i + 1} is missing "| category"`)
      }
      const textPart = entry.slice(0, sep).trim()
      const categoryPart = entry.slice(sep + 1).trim()
      if (!textPart) throw new Error(`Question ${i + 1} is missing question text.`)
      if (!categoryPart) throw new Error(`Question ${i + 1} is missing the category.`)
      return { text: textPart, category: categoryPart }
    })
  }

  async function loadManualFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setManualText(text)
    setLoadError(null)
    e.target.value = ''
  }

  function submitManual() {
    setLoadError(null)
    try {
      const list = parseManualText(manualText)
      setQuestions(list)
      setGeneratedSet(null)
      startSession()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not parse questions.')
    }
  }

  function cancelGeneration() {
    generateAbort?.abort()
  }

  async function generateFromJd() {
    const url = jdUrl.trim()
    if (!url) return
    setLoadError(null)
    setGenerating(true)
    const ctrl = new AbortController()
    setGenerateAbort(ctrl)
    let lastErr: string | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      if (ctrl.signal.aborted) break
      if (attempt === 1) setGeneratingStep(0)
      try {
        const set = await generateQuestions(url, questionCount, ctrl.signal)
        if (!set.questions?.length) throw new Error('No questions returned.')
        setGeneratedSet(set)
        setQuestions(set.questions)
        setGeneratingStep(0)
        setGenerating(false)
        setGenerateAbort(null)
        return
      } catch (err) {
        if (err instanceof Error && (err.name === 'AbortError' || ctrl.signal.aborted)) break
        lastErr = err instanceof Error ? err.message : 'Could not generate questions.'
      }
    }
    setQuestions([])
    setGeneratedSet(null)
    if (!ctrl.signal.aborted) setLoadError(lastErr ?? 'Could not generate questions.')
    setGeneratingStep(0)
    setGenerating(false)
    setGenerateAbort(null)
  }

  function downloadGeneratedSet() {
    if (!generatedSet) return
    const blob = new Blob([JSON.stringify(generatedSet, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const filename = `${generatedSet.company}-${generatedSet.role}`
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '_') + '.json'
    const a = document.createElement('a')
    a.href = href
    a.download = filename
    a.click()
    URL.revokeObjectURL(href)
  }

  async function startSession() {
    setNetworkError(null)
    try {
      const id = await createSession()
      const autoName = `Session #${id}`
      setSessionId(id)
      setSessionName(autoName)
      patchSession(id, autoName).catch(() => {/* best effort */})
      setQIndex(0)
      setView('session')
    } catch (err) {
      setNetworkError(err instanceof Error ? err.message : 'Could not start session.')
    }
  }

  async function finishSession() {
    setView('done')
    if (evaluationsList.length === 0) return
    setNetworkError(null)
    setSummaryLoading(true)
    try {
      const s = await fetchSessionSummary(sessionId!, evaluationsList)
      setSummary(s)
    } catch (err) {
      setNetworkError(err instanceof Error ? err.message : 'Could not load summary.')
    } finally {
      setSummaryLoading(false)
    }
  }

  async function evaluateAnswer() {
    if (!effectiveTranscript || sessionId === null) return
    const question = questions[qIndex]
    const raw = effectiveTranscript
    stop()
    setNetworkError(null)

    try {
      const clean = await cleanTranscript(raw)
      setEvaluation({})
      setStreaming(true)

      const accumulated: Partial<AnswerEvaluation> = {}
      for await (const chunk of streamEvaluation(question.text, clean)) {
        Object.assign(accumulated, chunk)
        setEvaluation({ ...accumulated })
      }
      setStreaming(false)
      setSaving(true)

      await saveAnswer({
        session_id: sessionId,
        question: question.text,
        transcript_raw: raw,
        transcript_clean: clean,
        evaluation_json: JSON.stringify(accumulated),
      })
      setEvaluationsList(prev => [...prev, accumulated as AnswerEvaluation])
      setAnswersLog(prev => [...prev, { question: question.text, transcript: clean, evaluated: true }])
      setSaving(false)
    } catch (err) {
      setStreaming(false)
      setSaving(false)
      setNetworkError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  async function submitWithoutEval() {
    if (!effectiveTranscript || sessionId === null) return
    const question = questions[qIndex]
    const raw = effectiveTranscript
    if (isListening) stop()
    setSubmitting(true)
    setNetworkError(null)
    setAnswersLog(prev => [...prev, { question: question.text, transcript: raw, evaluated: false }])
    try {
      await saveAnswer({
        session_id: sessionId,
        question: question.text,
        transcript_raw: raw,
        transcript_clean: raw,
        evaluation_json: null,
      })
    } catch (err) {
      setNetworkError(err instanceof Error ? err.message : 'Could not save answer.')
    } finally {
      setSubmitting(false)
      goToNextOrFinish()
    }
  }

  function goToNextOrFinish() {
    setEvaluation({})
    reset()
    setManualTranscript(null)
    setEditingTranscript(false)
    setRecordElapsed(0)
    if (qIndex + 1 >= questions.length) {
      finishSession()
    } else {
      setQIndex(i => i + 1)
    }
  }

  async function nextQuestion() {
    setNetworkError(null)
    goToNextOrFinish()
  }

  if (view === 'history') {
    if (selectedSessionId !== null) {
      return (
        <SessionDetail
          sessionId={selectedSessionId}
          sessionName={selectedSessionName ?? `Session #${selectedSessionId}`}
          onBack={() => setSelectedSessionId(null)}
        />
      )
    }
    return (
      <HistoryView
        onBack={() => setView('setup')}
        onSelectSession={(id, name) => { setSelectedSessionId(id); setSelectedSessionName(name) }}
      />
    )
  }

  if (view === 'setup') {
    const manualLineCount = manualText.split(/\n(?=-)/).map(chunk => chunk.replace(/^-\s*/, '').trim()).filter(Boolean).length

    return (
      <div className="min-h-screen bg-gray-50 flex items-start justify-center p-6 pt-16">
        <div className="w-full max-w-xl space-y-5">
          <div className="flex items-center justify-between px-1">
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Prepwise</h1>
            <button
              onClick={() => { setSelectedSessionId(null); setView('history') }}
              aria-label="History"
              title="History"
              className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            {!supported ? (
              <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                <p className="font-semibold mb-1">Browser not supported</p>
                <p>Prepwise needs the Web Speech API. Please open this page in Chrome on desktop.</p>
              </div>
            ) : setupStep === 'choose' ? (
              <div key="choose" className="animate-fade-in-up space-y-4">
                <p className="text-sm text-gray-500">How do you want your questions?</p>
                <button
                  onClick={() => { setSetupStep('manual'); setLoadError(null); setNetworkError(null) }}
                  className="group w-full flex items-center gap-4 rounded-xl border border-gray-200 p-5 text-left hover:border-indigo-300 hover:bg-indigo-50/40 hover:shadow-sm transition-all"
                >
                  <span className="shrink-0 w-11 h-11 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                    </svg>
                  </span>
                  <span className="flex-1">
                    <span className="block text-base font-semibold text-gray-900">Manual Questions</span>
                    <span className="block text-xs text-gray-500 mt-0.5">Write or paste your own questions.</span>
                  </span>
                </button>

                <button
                  onClick={() => { setSetupStep('generated'); setLoadError(null); setNetworkError(null) }}
                  className="group w-full flex items-center gap-4 rounded-xl border border-gray-200 p-5 text-left hover:border-indigo-300 hover:bg-indigo-50/40 hover:shadow-sm transition-all"
                >
                  <span className="shrink-0 w-11 h-11 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-5 h-5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.847.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
                    </svg>
                  </span>
                  <span className="flex-1">
                    <span className="block text-base font-semibold text-gray-900">Generated Questions</span>
                    <span className="block text-xs text-gray-500 mt-0.5">From a JD URL, tailored to you.</span>
                  </span>
                </button>
              </div>
            ) : setupStep === 'manual' ? (
              <div key="manual" className="animate-fade-in-up space-y-4">
                <button
                  onClick={() => { setSetupStep('choose'); setLoadError(null) }}
                  aria-label="Back"
                  className="p-1 -ml-1 text-gray-400 hover:text-gray-700 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                </button>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Manual Questions</h2>
                    <p className="text-xs text-gray-500 mt-1">Each question starts with format: - question text | category</p>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText('The format of the questions is: - question text | category. Each question starts with a dash. Output only the lines, nothing else.')
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                    title="Copy prompt for AI chat"
                    aria-label="Copy prompt for AI chat"
                    className="shrink-0 p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-colors"
                  >
                    {copied ? (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4 text-green-500">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                      </svg>
                    )}
                  </button>
                </div>
                <textarea
                  value={manualText}
                  onChange={(e) => { setManualText(e.target.value); setLoadError(null) }}
                  rows={8}
                  placeholder={'- Tell me about a project you led | behavioral\n- How would you scale a real-time chat? | system design'}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-indigo-400 focus:outline-none resize-y min-h-48"
                />
                <div className="flex items-center justify-between text-xs">
                  <span className={`${manualLineCount > 10 ? 'text-red-500' : 'text-gray-400'}`}>
                    {manualLineCount} / 10 questions
                  </span>
                  <label className="text-indigo-600 hover:text-indigo-800 cursor-pointer">
                    <input type="file" accept=".txt,.md,text/plain" onChange={loadManualFile} className="hidden" />
                    Load from file
                  </label>
                </div>
                {loadError && <p className="text-sm text-red-600">{loadError}</p>}
                {networkError && <p className="text-sm text-red-600">{networkError}</p>}
                <button
                  onClick={submitManual}
                  disabled={!manualText.trim() || manualLineCount > 10}
                  className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                >
                  Start session
                </button>
              </div>
            ) : (
              <div key="generated" className="animate-fade-in-up space-y-4">
                <button
                  onClick={() => { if (!generating) { setSetupStep('choose'); setLoadError(null); setQuestions([]); setGeneratedSet(null) } }}
                  disabled={generating}
                  aria-label="Back"
                  className="p-1 -ml-1 text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-40"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                </button>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Generated Questions</h2>
                  <p className="text-xs text-gray-500 mt-1">Paste a JD URL — we tailor questions to it and your background.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-600">JD URL</label>
                  <input
                    type="url"
                    value={jdUrl}
                    onChange={(e) => setJdUrl(e.target.value)}
                    placeholder="https://boards.greenhouse.io/…"
                    disabled={generating}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none disabled:bg-gray-50"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-600">Number of questions</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={questionCount}
                      onChange={(e) => setQuestionCount(Number(e.target.value))}
                      disabled={generating}
                      className="flex-1 accent-indigo-600"
                    />
                    <span className="w-10 text-center text-sm font-semibold text-indigo-600 tabular-nums">{questionCount}</span>
                  </div>
                </div>

                {generating ? (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-500 select-none">
                      <svg className="animate-spin h-4 w-4 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span key={generatingStep} className="animate-fade-in-up">{GENERATING_STEPS[generatingStep]}</span>
                    </div>
                    <button
                      onClick={cancelGeneration}
                      title="Stop"
                      aria-label="Stop generation"
                      className="p-2.5 rounded-lg border border-red-200 bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                        <rect x="6" y="6" width="12" height="12" rx="1.5" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={generateFromJd}
                    disabled={!jdUrl.trim()}
                    className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-40 transition-colors"
                  >
                    Generate questions
                  </button>
                )}

                {loadError && <p className="text-sm text-red-600">{loadError}</p>}
                {networkError && <p className="text-sm text-red-600">{networkError}</p>}

                {generatedSet && questions.length > 0 && (
                  <div className="animate-fade-in-up space-y-3 pt-2 border-t border-gray-100">
                    <p className="text-sm text-green-600">
                      ✓ {questions.length} questions ready — <span className="text-gray-500">{generatedSet.company} / {generatedSet.role}</span>
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={startSession}
                        className="flex-1 rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700 transition-colors"
                      >
                        Start session
                      </button>
                      <button
                        onClick={downloadGeneratedSet}
                        title="Download JSON"
                        aria-label="Download JSON"
                        className="p-3 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-4 h-4">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (view === 'done') {
    const dimAverages = summary ? {
      specificity: summary.avg_specificity,
      evidence: summary.avg_evidence,
      relevance: summary.avg_relevance,
      structure: summary.avg_structure,
    } : null

    async function saveSessionName() {
      if (!sessionId) return
      setSessionNameSaving(true)
      try { await patchSession(sessionId, sessionName.trim() || null) } catch { /* ignore */ }
      finally { setSessionNameSaving(false) }
    }

    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">Session complete</h1>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={sessionName}
                onChange={e => setSessionName(e.target.value)}
                onBlur={saveSessionName}
                onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
                placeholder="Add a name to this session…"
                className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              {sessionNameSaving && (
                <span className="text-xs text-gray-400">Saving…</span>
              )}
            </div>
          </div>

          {summaryLoading && (
            <p className="text-sm text-indigo-500 animate-pulse">Generating summary…</p>
          )}

          {networkError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {networkError}
            </p>
          )}

          {summary && dimAverages && (
            <>
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
                <h2 className="font-semibold text-gray-900">Scores</h2>
                {(['specificity', 'evidence', 'relevance', 'structure'] as const).map((dim) => {
                  const avg = dimAverages[dim]
                  const isWeakest = summary.weakest_dimension === dim
                  return (
                    <div key={dim}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`capitalize text-sm font-medium ${isWeakest ? 'text-amber-600' : 'text-gray-700'}`}>
                          {dim}{isWeakest ? ' ← weakest' : ''}
                        </span>
                        <span className="text-sm text-gray-500">{avg.toFixed(1)} / 5</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-2 rounded-full ${isWeakest ? 'bg-amber-400' : 'bg-indigo-400'}`}
                          style={{ width: `${(avg / 5) * 100}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
                <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">Overall</span>
                  <span className="text-sm font-semibold text-gray-700">{summary.avg_overall.toFixed(1)} / 5</span>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <h2 className="font-semibold text-gray-900 mb-3">Top improvements</h2>
                <ol className="space-y-2">
                  {summary.top_improvements.map((tip, i) => (
                    <li key={i} className="flex gap-3 text-sm text-gray-700">
                      <span className="text-amber-500 font-bold shrink-0">{i + 1}.</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ol>
              </div>

            </>
          )}

          {answersLog.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900">Questions & answers</h2>
                <button
                  onClick={() => {
                    const text = answersLog
                      .map((a, i) => `${i + 1}. ${a.question}\n${a.transcript}`)
                      .join('\n\n')
                    navigator.clipboard.writeText(text)
                    setCopiedAnswers(true)
                    setTimeout(() => setCopiedAnswers(false), 2000)
                  }}
                  title="Copy all to clipboard"
                  aria-label="Copy all to clipboard"
                  className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-colors"
                >
                  {copiedAnswers ? (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-4 h-4 text-green-500">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                    </svg>
                  )}
                </button>
              </div>
              <ol className="space-y-4">
                {answersLog.map((a, i) => (
                  <li key={i} className="border-b border-gray-100 last:border-0 pb-3 last:pb-0">
                    <p className="text-sm font-medium text-gray-900">
                      <span className="text-indigo-500 mr-2">{i + 1}.</span>{a.question}
                    </p>
                    {editingAnswerIndex === i ? (
                      <div className="mt-1 space-y-1">
                        <textarea
                          value={editAnswerValue}
                          onChange={e => setEditAnswerValue(e.target.value)}
                          rows={3}
                          autoFocus
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              setAnswersLog(prev => prev.map((x, j) => j === i ? { ...x, transcript: editAnswerValue } : x))
                              setEditingAnswerIndex(null)
                            }}
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setEditingAnswerIndex(null)}
                            className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 mt-1 group">
                        <p className="flex-1 text-sm text-gray-600 whitespace-pre-wrap">{a.transcript}</p>
                        <button
                          onClick={() => { setEditAnswerValue(a.transcript); setEditingAnswerIndex(i) }}
                          aria-label="Edit answer"
                          title="Edit answer"
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-indigo-600 transition-all shrink-0"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-3.5 h-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <button
            onClick={() => { setView('setup'); setSetupStep('choose'); setManualText(''); setJdUrl(''); setQuestions([]); setEvaluationsList([]); setAnswersLog([]); setSummary(null); setLoadError(null); setNetworkError(null); setRecordElapsed(0); setSessionName(''); setEditingAnswerIndex(null); reset() }}
            className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm hover:bg-gray-50"
          >
            New session
          </button>
        </div>
      </div>
    )
  }

  const currentQuestion = questions[qIndex]
  const hasStarted = isListening || effectiveTranscript.length > 0
  const evalDone = evaluation.overall_score !== undefined && !streaming
  const showActions = effectiveTranscript && !streaming && !evalDone && !submitting && !editingTranscript

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-10">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Prepwise</h1>
          <span className="text-sm text-gray-400">{qIndex + 1} / {questions.length}</span>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <p className="text-xs font-medium text-indigo-500 uppercase tracking-wide mb-2">
            {currentQuestion.category}
          </p>
          <p className="text-gray-900 font-medium">{currentQuestion.text}</p>
        </div>

        {(speechError || networkError) && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {speechError ?? networkError}
          </p>
        )}

        <div className="flex flex-col items-center gap-5">
          <div className="flex items-center justify-center gap-6">
            {/* Skip or Restart */}
            <button
              onClick={hasStarted ? handleRestartRecording : handleSkipQuestion}
              disabled={!supported || streaming || submitting}
              aria-label={hasStarted ? 'Restart recording' : 'Skip question'}
              title={hasStarted ? 'Restart recording' : 'Skip question'}
              className="w-12 h-12 rounded-full border border-gray-200 bg-white text-gray-500 flex items-center justify-center hover:text-gray-800 hover:border-gray-300 hover:bg-gray-50 transition-all disabled:opacity-40"
            >
              {hasStarted ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12a7.5 7.5 0 11-2.197-5.303M19.5 4.5v4.5h-4.5" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689c0-.864.933-1.405 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.405 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z" />
                </svg>
              )}
            </button>

            {/* Record / Stop (main, bigger) */}
            <button
              onClick={isListening ? stop : handleStartRecording}
              disabled={!supported || streaming || submitting}
              aria-label={isListening ? 'Stop recording' : 'Start recording'}
              title={isListening ? 'Stop recording' : 'Start recording'}
              className={`w-20 h-20 rounded-full flex items-center justify-center text-white shadow-md transition-colors disabled:opacity-40 ${
                isListening
                  ? 'bg-red-500 hover:bg-red-600'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {isListening ? (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8">
                  <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                  <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.71v2.29h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.29a6.751 6.751 0 01-6-6.71v-1.5A.75.75 0 016 10.5z" />
                </svg>
              )}
            </button>

            {/* Show / Hide transcript */}
            <button
              onClick={() => setShowTranscript(s => !s)}
              disabled={!effectiveTranscript}
              aria-label={showTranscript ? 'Hide transcript' : 'Show transcript'}
              title={showTranscript ? 'Hide transcript' : 'Show transcript'}
              className="w-12 h-12 rounded-full border border-gray-200 bg-white text-gray-500 flex items-center justify-center hover:text-gray-800 hover:border-gray-300 hover:bg-gray-50 transition-all disabled:opacity-40"
            >
              {showTranscript ? (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.243 4.243l-4.243-4.243" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
            </button>
          </div>

          <span className="text-sm text-gray-500 tabular-nums">{formatTime(recordElapsed)}</span>

          {effectiveTranscript && showTranscript && !editingTranscript && (
            <p className="text-sm text-gray-500 text-center max-w-lg animate-fade-in-up">{effectiveTranscript}</p>
          )}
        </div>

        {/* Inline transcript editor */}
        {editingTranscript && effectiveTranscript && (
          <div className="space-y-2">
            <textarea
              value={editTranscriptValue}
              onChange={e => setEditTranscriptValue(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 resize-none"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setManualTranscript(editTranscriptValue); setEditingTranscript(false) }}
                className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => setEditingTranscript(false)}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {showActions && (
          <div className="flex items-center gap-3">
            <button
              onClick={submitWithoutEval}
              className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-3 font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Submit
            </button>
            <button
              onClick={evaluateAnswer}
              className="flex-1 rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              Evaluate
            </button>
            {/* Edit transcript */}
            <button
              onClick={() => { setEditTranscriptValue(effectiveTranscript); setEditingTranscript(true); setShowTranscript(false) }}
              aria-label="Edit transcript"
              title="Edit transcript"
              className="w-12 h-12 rounded-lg border border-gray-200 bg-white text-gray-400 flex items-center justify-center hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-colors shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </button>
          </div>
        )}

        {(streaming || evaluation.overall_score !== undefined) && (
          <EvaluationCard evaluation={evaluation} streaming={streaming} />
        )}

        {evalDone && (
          <button
            onClick={nextQuestion}
            disabled={saving}
            className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : qIndex + 1 >= questions.length ? 'Finish session' : 'Next question →'}
          </button>
        )}
      </div>
    </div>
  )
}
