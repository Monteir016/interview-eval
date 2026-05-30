const BASE = '/api'

export async function cleanTranscript(raw: string): Promise<string> {
  const res = await fetch(`${BASE}/transcription/clean`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  const data = await res.json()
  return data.clean
}

export async function* streamEvaluation(
  question: string,
  transcript_clean: string
): AsyncGenerator<Record<string, unknown>> {
  const res = await fetch(`${BASE}/evaluation/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, transcript_clean }),
  })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ') && !line.includes('[DONE]')) {
        yield JSON.parse(line.slice(6))
      }
    }
  }
}

export async function createSession(question_set?: string): Promise<number> {
  const res = await fetch(`${BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question_set }),
  })
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
  const res = await fetch(`${BASE}/sessions/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  return data.answer_id
}
