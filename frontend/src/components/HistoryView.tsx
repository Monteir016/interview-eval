import { useEffect, useState } from 'react'
import { listSessions, deleteSession, patchSession } from '../api/client'
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
  const [confirmId, setConfirmId] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [editingNameId, setEditingNameId] = useState<number | null>(null)
  const [editingNameValue, setEditingNameValue] = useState('')

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load history.'))
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(id: number) {
    setDeleting(true)
    try {
      await deleteSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete session.')
    } finally {
      setDeleting(false)
      setConfirmId(null)
    }
  }

  async function saveSessionName(id: number, name: string) {
    const trimmed = name.trim() || null
    try {
      await patchSession(id, trimmed)
      setSessions(prev => prev.map(s => s.id === id ? { ...s, name: trimmed } : s))
    } catch { /* ignore */ }
    setEditingNameId(null)
  }

  const trendScores = [...sessions]
    .reverse()
    .flatMap((s) => (s.avg_overall != null ? [s.avg_overall] : []))

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
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
            <div key={s.id} className="relative group">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:border-indigo-200 transition-colors">
                {/* Name row */}
                <div
                  className="px-5 pt-4 pb-1 flex items-center gap-2"
                  onClick={e => e.stopPropagation()}
                >
                  {editingNameId === s.id ? (
                    <input
                      autoFocus
                      value={editingNameValue}
                      onChange={e => setEditingNameValue(e.target.value)}
                      onBlur={() => saveSessionName(s.id, editingNameValue)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setEditingNameId(null)
                      }}
                      placeholder="Session name…"
                      className="flex-1 text-sm font-medium text-gray-900 bg-transparent border-b border-indigo-300 focus:outline-none pb-0.5"
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingNameValue(s.name ?? ''); setEditingNameId(s.id) }}
                      className="flex items-center gap-1.5 text-left group/name"
                      title="Edit session name"
                    >
                      {s.name ? (
                        <span className="text-sm font-semibold text-gray-900">{s.name}</span>
                      ) : (
                        <span className="text-sm text-gray-400 italic">Untitled session</span>
                      )}
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-3 h-3 text-gray-300 opacity-0 group-hover/name:opacity-100 transition-opacity">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Main content row — clickable to view detail */}
                <button
                  onClick={() => onSelectSession(s.id)}
                  className="w-full px-5 pb-4 pt-1 text-left"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500">{formatDate(s.created_at)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {s.answer_count}{' '}
                        {s.answer_count === 1 ? 'answer' : 'answers'}
                      </p>
                    </div>
                    <div className="text-right pr-8">
                      <p className="text-2xl font-bold text-indigo-600">
                        {s.avg_overall != null ? s.avg_overall.toFixed(1) : '—'}
                      </p>
                      <p className="text-xs text-gray-400">/ 5</p>
                    </div>
                  </div>
                </button>
              </div>

              <button
                onClick={(e) => { e.stopPropagation(); setConfirmId(s.id) }}
                aria-label="Delete session"
                title="Delete session"
                className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </div>

      {confirmId !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-6">
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-6 w-full max-w-sm space-y-4 animate-fade-in-up">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-full bg-red-100 text-red-500 flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </span>
              <div>
                <p className="font-semibold text-gray-900">Delete session?</p>
                <p className="text-sm text-gray-500">This removes all answers. Can't be undone.</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmId(null)}
                disabled={deleting}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmId)}
                disabled={deleting}
                className="flex-1 rounded-lg bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 transition-colors"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
