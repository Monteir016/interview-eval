import { useState } from 'react'
import type { AnswerEvaluation, Question } from './types'
import { useSpeech } from './hooks/useSpeech'
import { RecordButton } from './components/RecordButton'
import { EvaluationCard } from './components/EvaluationCard'
import { cleanTranscript, streamEvaluation, createSession, saveAnswer } from './api/client'

type View = 'setup' | 'session' | 'done'

export default function App() {
  const [view, setView] = useState<View>('setup')
  const [questions, setQuestions] = useState<Question[]>([])
  const [qIndex, setQIndex] = useState(0)
  const [sessionId, setSessionId] = useState<number | null>(null)
  const [evaluation, setEvaluation] = useState<Partial<AnswerEvaluation>>({})
  const [streaming, setStreaming] = useState(false)
  const [rawTranscript, setRawTranscript] = useState('')

  const { transcript, isListening, start, stop, reset, supported } = useSpeech()

  async function loadQuestions(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const data = JSON.parse(text)
    setQuestions(Array.isArray(data) ? data : data.questions)
  }

  async function startSession() {
    const id = await createSession()
    setSessionId(id)
    setQIndex(0)
    setView('session')
  }

  async function submitAnswer() {
    if (!transcript || sessionId === null) return
    const question = questions[qIndex]
    setRawTranscript(transcript)
    stop()

    const clean = await cleanTranscript(transcript)
    setEvaluation({})
    setStreaming(true)

    const accumulated: Partial<AnswerEvaluation> = {}
    for await (const chunk of streamEvaluation(question.text, clean)) {
      Object.assign(accumulated, chunk)
      setEvaluation({ ...accumulated })
    }
    setStreaming(false)

    await saveAnswer({
      session_id: sessionId,
      question: question.text,
      transcript_raw: rawTranscript,
      transcript_clean: clean,
      evaluation_json: JSON.stringify(accumulated),
    })
  }

  function nextQuestion() {
    if (qIndex + 1 >= questions.length) {
      setView('done')
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
          <p className="text-gray-500 text-sm">Load a question set JSON to begin.</p>
          <input type="file" accept=".json" onChange={loadQuestions} className="text-sm" />
          {questions.length > 0 && (
            <p className="text-sm text-green-600">{questions.length} questions loaded</p>
          )}
          <button
            onClick={startSession}
            disabled={questions.length === 0}
            className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            Start session
          </button>
        </div>
      </div>
    )
  }

  if (view === 'done') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-md space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">Session complete</h1>
          <p className="text-gray-500 text-sm">All {questions.length} questions answered.</p>
          <button
            onClick={() => { setView('setup'); setQuestions([]); reset() }}
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

        {!supported && (
          <p className="text-sm text-red-500">Web Speech API not supported in this browser.</p>
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
            className="w-full rounded-lg border border-gray-200 px-4 py-3 text-sm hover:bg-gray-50"
          >
            {qIndex + 1 >= questions.length ? 'Finish session' : 'Next question →'}
          </button>
        )}
      </div>
    </div>
  )
}
