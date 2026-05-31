import { useEffect, useState } from 'react'
import { getSessionAnswers } from '../api/client'
import type { AnswerHistoryItem } from '../types'

interface Props {
  sessionId: number
  sessionName: string
  onBack: () => void
}

const DIMS = ['specificity', 'evidence', 'relevance', 'structure'] as const

export function SessionDetail({ sessionId, sessionName, onBack }: Props) {
  const [answers, setAnswers] = useState<AnswerHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSessionAnswers(sessionId)
      .then(setAnswers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load answers.'))
      .finally(() => setLoading(false))
  }, [sessionId])

  const scored = answers.filter((a) => a.overall_score !== null)
  const avgOverall =
    scored.length
      ? (scored.reduce((s, a) => s + (a.overall_score ?? 0), 0) / scored.length).toFixed(1)
      : null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            aria-label="Back"
            className="p-1 -ml-1 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">{sessionName}</h1>
            {avgOverall && (
              <p className="text-sm text-gray-500">avg overall: {avgOverall} / 5</p>
            )}
          </div>
        </div>

        {loading && (
          <p className="text-sm text-gray-400 animate-pulse">Loading answers…</p>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {!loading && answers.length === 0 && !error && (
          <p className="text-sm text-gray-500">No answers in this session.</p>
        )}

        {answers.map((a, i) => {
          const isEvaluated = a.overall_score !== null
          const answerText = a.transcript_clean ?? a.transcript_raw ?? ''
          return (
            <div
              key={a.id}
              className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-1">
                  <p className="text-xs font-medium text-gray-400">Q{i + 1}</p>
                  <p className="font-medium text-gray-900">{a.question}</p>
                </div>
                {isEvaluated ? (
                  <span className="text-xl font-bold text-indigo-600 shrink-0">
                    {a.overall_score!.toFixed(1)}
                  </span>
                ) : (
                  <span className="text-xs font-medium text-gray-400 shrink-0 px-2 py-1 bg-gray-100 rounded">
                    no eval
                  </span>
                )}
              </div>

              {answerText && (
                <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-lg px-3 py-2">
                  {answerText}
                </p>
              )}

              {isEvaluated && (
                <div className="grid grid-cols-4 gap-3">
                  {DIMS.map((dim) => (
                    <div key={dim}>
                      <p className="text-xs text-gray-400 capitalize mb-1">{dim}</p>
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <div
                            key={n}
                            className={`h-1.5 flex-1 rounded-sm ${
                              n <= (a[dim] ?? 0) ? 'bg-indigo-400' : 'bg-gray-100'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {isEvaluated && a.evaluation.key_strength && (
                <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                  <span className="font-semibold">Strength: </span>
                  {a.evaluation.key_strength}
                </p>
              )}
              {isEvaluated && a.evaluation.key_improvement && (
                <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                  <span className="font-semibold">Improve: </span>
                  {a.evaluation.key_improvement}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
