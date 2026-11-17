import { useRef } from 'react'

export function RenameInput({ name, label, className, busy, change, save, cancel }: {
  name: string; label: string; className?: string; busy: boolean
  change: (name: string) => void; save: (name: string) => void; cancel: () => void
}) {
  const cancelled = useRef(false)
  return <input type="text" className={className} aria-label={label} value={name} readOnly={busy} autoFocus
    onFocus={event => { cancelled.current = false; event.currentTarget.select() }}
    onChange={event => change(event.currentTarget.value)}
    onBlur={event => { if (!cancelled.current && !busy) save(event.currentTarget.value) }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || busy) return
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
      if (event.key === 'Escape') {
        event.stopPropagation()
        cancelled.current = true
        cancel()
      }
    }} />
}
