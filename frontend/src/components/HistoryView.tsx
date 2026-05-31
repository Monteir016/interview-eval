import { useEffect, useState } from 'react'
import { listSessions } from '../api/client'
import type { SessionListItem } from '../types'
import { Sparkline } from './Sparkline'

interface Props {
  onBack: () => void
  onSelectSession: (id: number) => void
}

function formatDate(s: string) {
  const d = new Date(s.replace(' ', 'T') + 'Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function HistoryView({ onBack, onSelectSession }: Props) {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load history.'))
      .finally(() => setLoading(false))
  }, [])

  // Sparkline reads sessions oldest-first so the trend goes left→right
  const trendScores = [...sessions]
    .reverse()
    .flatMap((s) => (s.avg_overall != null ? [s.avg_overall] : []))

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800">
            ← Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900">History</h1>
        </div>

        {loading && (
          <p className="text-sm text-gray-400 animate-pulse">Loading sessions…</p>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {trendScores.length >= 2 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Overall score trend</p>
                <p className="text-xs text-gray-400">{sessions.length} sessions</p>
              </div>
              <Sparkline scores={trendScores} width={160} height={48} />
            </div>
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <p className="text-sm text-gray-500">
            No sessions yet. Complete a session to see your history.
          </p>
        )}

        <div className="space-y-3">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelectSession(s.id)}
              className="w-full bg-white rounded-xl border border-gray-200 p-5 shadow-sm text-left hover:border-indigo-200 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{formatDate(s.created_at)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {s.answer_count}{' '}
                    {s.answer_count === 1 ? 'answer' : 'answers'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-indigo-600">
                    {s.avg_overall != null ? s.avg_overall.toFixed(1) : '—'}
                  </p>
                  <p className="text-xs text-gray-400">/ 5</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
