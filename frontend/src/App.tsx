import { useState } from 'react'
import type { AnswerEvaluation, Question, SessionSummary } from './types'
import { useSpeech } from './hooks/useSpeech'
import { RecordButton } from './components/RecordButton'
import { EvaluationCard } from './components/EvaluationCard'
import { cleanTranscript, streamEvaluation, createSession, saveAnswer, fetchSessionSummary } from './api/client'

type View = 'setup' | 'session' | 'done'

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

  const { transcript, isListening, start, stop, reset, supported, error: speechError } = useSpeech()

  async function loadQuestions(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoadError(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const list: unknown = Array.isArray(data) ? data : data?.questions
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error('Expected an array of questions or a QuestionSet with `questions`.')
      }
      const valid = list.every(
        (q): q is Question =>
          typeof q === 'object' && q !== null &&
          typeof (q as Question).text === 'string' &&
          typeof (q as Question).category === 'string' &&
          typeof (q as Question).target_experience === 'string'
      )
      if (!valid) {
        throw new Error('Each question needs `text`, `category`, and `target_experience` strings.')
      }
      setQuestions(list)
    } catch (err) {
      setQuestions([])
      setLoadError(err instanceof Error ? err.message : 'Could not parse JSON.')
    }
  }

  async function startSession() {
    setNetworkError(null)
    try {
      const id = await createSession()
      setSessionId(id)
      setQIndex(0)
      setView('session')
    } catch (err) {
      setNetworkError(err instanceof Error ? err.message : 'Could not start session.')
    }
  }

  async function submitAnswer() {
    if (!transcript || sessionId === null) return
    const question = questions[qIndex]
    // Capture raw transcript immediately — state update is batched and
    // rawTranscript from state would still be stale when saveAnswer runs.
    const raw = transcript
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
      setSaving(false)
    } catch (err) {
      setStreaming(false)
      setSaving(false)
      setNetworkError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  async function nextQuestion() {
    setNetworkError(null)
    if (qIndex + 1 >= questions.length) {
      setSummaryLoading(true)
      setView('done')
      try {
        const s = await fetchSessionSummary(sessionId!, evaluationsList)
        setSummary(s)
      } catch (err) {
        setNetworkError(err instanceof Error ? err.message : 'Could not load summary.')
      } finally {
        setSummaryLoading(false)
      }
    } else {
      setQIndex((i) => i + 1)
      setEvaluation({})
      reset()
    }
  }

  if (view === 'setup') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-md space-y-6">
          <h1 className="text-2xl font-bold text-gray-900">Prepwise</h1>
          {!supported ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
              <p className="font-semibold mb-1">Browser not supported</p>
              <p>Prepwise needs the Web Speech API. Please open this page in Chrome on desktop.</p>
            </div>
          ) : (
            <>
              <p className="text-gray-500 text-sm">Load a question set JSON to begin.</p>
              <input type="file" accept=".json" onChange={loadQuestions} className="text-sm" />
              {loadError && (
                <p className="text-sm text-red-600">{loadError}</p>
              )}
              {questions.length > 0 && (
                <p className="text-sm text-green-600">{questions.length} questions loaded</p>
              )}
              {networkError && (
                <p className="text-sm text-red-600">{networkError}</p>
              )}
              <button
                onClick={startSession}
                disabled={questions.length === 0}
                className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                Start session
              </button>
            </>
          )}
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

    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <h1 className="text-2xl font-bold text-gray-900">Session complete</h1>

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

              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-gray-900">Full transcript</h2>
                  <button
                    onClick={() => navigator.clipboard.writeText(summary.full_transcript)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded px-2 py-1"
                  >
                    Copy
                  </button>
                </div>
                <pre className="text-sm text-gray-600 whitespace-pre-wrap font-sans leading-relaxed">{summary.full_transcript}</pre>
              </div>
            </>
          )}

          <button
            onClick={() => { setView('setup'); setQuestions([]); setEvaluationsList([]); setSummary(null); setNetworkError(null); reset() }}
            className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm hover:bg-gray-50"
          >
            New session
          </button>
        </div>
      </div>
    )
  }

  const currentQuestion = questions[qIndex]

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
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

        <div className="flex flex-col items-center gap-4">
          <RecordButton isListening={isListening} onStart={start} onStop={stop} disabled={!supported} />
          {transcript && (
            <p className="text-sm text-gray-500 text-center max-w-lg">{transcript}</p>
          )}
        </div>

        {transcript && !streaming && !evaluation.overall_score && (
          <button
            onClick={submitAnswer}
            className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700"
          >
            Submit & evaluate
          </button>
        )}

        {(streaming || evaluation.overall_score !== undefined) && (
          <EvaluationCard evaluation={evaluation} streaming={streaming} />
        )}

        {evaluation.overall_score !== undefined && !streaming && (
          <button
            onClick={nextQuestion}
            disabled={saving}
            className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm hover:bg-gray-50 disabled:opacity-40"
          >
            {saving ? 'Saving…' : qIndex + 1 >= questions.length ? 'Finish session' : 'Next question →'}
          </button>
        )}
      </div>
    </div>
  )
}
