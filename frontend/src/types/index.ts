export type Dimension = 'specificity' | 'evidence' | 'relevance' | 'structure'

export interface DimensionScore {
  score: number
  feedback: string
}

export interface AnswerEvaluation {
  question: string
  transcript_clean: string
  specificity: DimensionScore
  evidence: DimensionScore
  relevance: DimensionScore
  structure: DimensionScore
  overall_score: number
  key_strength: string
  key_improvement: string
}

export interface SessionSummary {
  session_id: number
  avg_specificity: number
  avg_evidence: number
  avg_relevance: number
  avg_structure: number
  avg_overall: number
  weakest_dimension: Dimension
  top_improvements: string[]
  full_transcript: string
}

export interface Question {
  text: string
  category: string
  target_experience?: string
}

export interface QuestionSet {
  company: string
  role: string
  questions: Question[]
}

export interface SessionListItem {
  id: number
  created_at: string
  question_set: string | null
  name: string | null
  avg_overall: number | null
  answer_count: number
}

export interface AnswerHistoryItem {
  id: number
  session_id: number
  question: string
  transcript_raw: string | null
  transcript_clean: string | null
  specificity: number | null
  evidence: number | null
  relevance: number | null
  structure: number | null
  overall_score: number | null
  evaluation: Partial<AnswerEvaluation>
  created_at: string
}
