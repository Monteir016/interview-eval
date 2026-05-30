interface Props {
  isListening: boolean
  onStart: () => void
  onStop: () => void
  disabled?: boolean
}

export function RecordButton({ isListening, onStart, onStop, disabled }: Props) {
  return (
    <button
      onClick={isListening ? onStop : onStart}
      disabled={disabled}
      className={`rounded-full px-6 py-3 font-semibold text-white transition-colors disabled:opacity-40 ${
        isListening
          ? 'bg-red-500 hover:bg-red-600 animate-pulse'
          : 'bg-indigo-600 hover:bg-indigo-700'
      }`}
    >
      {isListening ? 'Stop recording' : 'Start recording'}
    </button>
  )
}
