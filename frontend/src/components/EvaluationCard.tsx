import type { AnswerEvaluation } from '../types'

interface Props {
  evaluation: Partial<AnswerEvaluation>
  streaming?: boolean
}

const DIMENSIONS = ['specificity', 'evidence', 'relevance', 'structure'] as const

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <div
          key={n}
          className={`h-2 w-6 rounded-full ${n <= score ? 'bg-indigo-500' : 'bg-gray-200'}`}
        />
      ))}
    </div>
  )
}

export function EvaluationCard({ evaluation, streaming }: Props) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
      {streaming && (
        <p className="text-sm text-indigo-500 animate-pulse">Evaluating…</p>
      )}
      {DIMENSIONS.map((dim) => {
        const d = evaluation[dim]
        if (!d) return null
        return (
          <div key={dim}>
            <div className="flex items-center justify-between mb-1">
              <span className="capitalize font-medium text-sm text-gray-700">{dim}</span>
              <ScoreBar score={d.score} />
            </div>
            <p className="text-sm text-gray-500">{d.feedback}</p>
          </div>
        )
      })}
      {evaluation.key_strength && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
          <span className="font-semibold">Strength: </span>{evaluation.key_strength}
        </div>
      )}
      {evaluation.key_improvement && (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          <span className="font-semibold">Improve: </span>{evaluation.key_improvement}
        </div>
      )}
    </div>
  )
}
