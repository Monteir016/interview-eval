const BASE = '/api'

async function checkOk(res: Response, label: string): Promise<Response> {
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${label} failed (${res.status}): ${body.slice(0, 200)}`)
  }
  return res
}

export async function cleanTranscript(raw: string): Promise<string> {
  const res = await checkOk(
    await fetch(`${BASE}/transcription/clean`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    }),
    'cleanTranscript'
  )
  const data = await res.json()
  return data.clean
}

export async function* streamEvaluation(
  question: string,
  transcript_clean: string
): AsyncGenerator<Record<string, unknown>> {
  const res = await checkOk(
    await fetch(`${BASE}/evaluation/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, transcript_clean }),
    }),
    'streamEvaluation'
  )
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ') || line.includes('[DONE]')) continue
        try {
          yield JSON.parse(line.slice(6)) as Record<string, unknown>
        } catch {
          // skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function createSession(question_set?: string): Promise<number> {
  const res = await checkOk(
    await fetch(`${BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_set }),
    }),
    'createSession'
  )
  const data = await res.json()
  return data.session_id
}

export async function saveAnswer(payload: {
  session_id: number
  question: string
  transcript_raw: string
  transcript_clean: string
  evaluation_json: string
}): Promise<number> {
  const res = await checkOk(
    await fetch(`${BASE}/sessions/answers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
    'saveAnswer'
  )
  const data = await res.json()
  return data.answer_id
}

export async function fetchSessionSummary(
  session_id: number,
  evaluations: import('../types').AnswerEvaluation[]
): Promise<import('../types').SessionSummary> {
  const res = await checkOk(
    await fetch(`${BASE}/evaluation/session/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id, evaluations }),
    }),
    'fetchSessionSummary'
  )
  return res.json()
}

export async function generateQuestions(
  jd_url: string,
  count: number = 10,
  signal?: AbortSignal
): Promise<import('../types').QuestionSet> {
  const res = await checkOk(
    await fetch(`${BASE}/questions/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jd_url, count }),
      signal,
    }),
    'generateQuestions'
  )
  return res.json()
}

export async function deleteSession(session_id: number): Promise<void> {
  await checkOk(
    await fetch(`${BASE}/sessions/${session_id}`, { method: 'DELETE' }),
    'deleteSession'
  )
}

export async function listSessions(): Promise<import('../types').SessionListItem[]> {
  const res = await checkOk(await fetch(`${BASE}/sessions`), 'listSessions')
  return res.json()
}

export async function getSessionAnswers(
  session_id: number
): Promise<import('../types').AnswerHistoryItem[]> {
  const res = await checkOk(
    await fetch(`${BASE}/sessions/${session_id}/answers`),
    'getSessionAnswers'
  )
  const rows: Array<Record<string, unknown>> = await res.json()
  return rows.map((r) => {
    let evaluation: Partial<import('../types').AnswerEvaluation> = {}
    try {
      if (typeof r.evaluation_json === 'string') evaluation = JSON.parse(r.evaluation_json)
    } catch { /* ignore */ }
    return {
      id: r.id as number,
      session_id: r.session_id as number,
      question: r.question as string,
      specificity: r.specificity as number,
      evidence: r.evidence as number,
      relevance: r.relevance as number,
      structure: r.structure as number,
      overall_score: r.overall_score as number,
      evaluation,
      created_at: r.created_at as string,
    }
  })
}
