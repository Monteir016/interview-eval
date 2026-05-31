import { useEffect, useState } from 'react'
import { getSessionAnswers } from '../api/client'
import type { AnswerHistoryItem } from '../types'

interface Props {
  sessionId: number
  onBack: () => void
}

const DIMS = ['specificity', 'evidence', 'relevance', 'structure'] as const

export function SessionDetail({ sessionId, onBack }: Props) {
  const [answers, setAnswers] = useState<AnswerHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSessionAnswers(sessionId)
      .then(setAnswers)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load answers.'))
      .finally(() => setLoading(false))
  }, [sessionId])

  const avgOverall =
    answers.length
      ? (answers.reduce((s, a) => s + a.overall_score, 0) / answers.length).toFixed(1)
      : null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800">
            ← History
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Session #{sessionId}</h1>
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

        {answers.map((a, i) => (
          <div
            key={a.id}
            className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-1">
                <p className="text-xs font-medium text-gray-400">Q{i + 1}</p>
                <p className="font-medium text-gray-900">{a.question}</p>
              </div>
              <span className="text-xl font-bold text-indigo-600 shrink-0">
                {a.overall_score.toFixed(1)}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-3">
              {DIMS.map((dim) => (
                <div key={dim}>
                  <p className="text-xs text-gray-400 capitalize mb-1">{dim}</p>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <div
                        key={n}
                        className={`h-1.5 flex-1 rounded-sm ${
                          n <= a[dim] ? 'bg-indigo-400' : 'bg-gray-100'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {a.evaluation.key_strength && (
              <p className="text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                <span className="font-semibold">Strength: </span>
                {a.evaluation.key_strength}
              </p>
            )}
            {a.evaluation.key_improvement && (
              <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                <span className="font-semibold">Improve: </span>
                {a.evaluation.key_improvement}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
