import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

interface Dimensions { rows: number; columns: number }
const cellPitch = 22

export function TableSizeGrid({ size, selection = size, preview, insert }: {
  size: Dimensions
  selection?: Dimensions
  preview: (size?: Dimensions) => void
  insert: (rows: number, columns: number) => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState({ rows: 8, columns: 10 })
  useLayoutEffect(() => {
    const element = viewport.current!
    const measure = () => {
      const rows = Math.max(1, Math.floor((element.clientHeight + 4) / cellPitch))
      const columns = Math.max(1, Math.floor((element.clientWidth + 4) / cellPitch))
      setVisible(current => current.rows === rows && current.columns === columns ? current : { rows, columns })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])

  const rows = Math.min(100, Math.max(visible.rows, size.rows || 0))
  const columns = Math.min(30, Math.max(visible.columns, size.columns || 0))
  return <div className="table-size-viewport" ref={viewport} onPointerLeave={() => preview()}>
    <div className="table-size-grid" aria-label="用鼠标选择表格大小" style={{ '--table-picker-columns': columns } as CSSProperties}
      onPointerOver={event => {
        const cell = event.target
        if (event.pointerType !== 'mouse' || !(cell instanceof HTMLButtonElement)) return
        preview({ rows: Number(cell.dataset.row), columns: Number(cell.dataset.column) })
      }} onClick={event => {
        const cell = event.target
        if (cell instanceof HTMLButtonElement) insert(Number(cell.dataset.row), Number(cell.dataset.column))
      }}>
      {Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => {
        const label = (row + 1) + ' 行 ' + (column + 1) + ' 列'
        return <button key={row + ':' + column} type="button" tabIndex={-1} aria-label={label} title={label}
          data-row={row + 1} data-column={column + 1} data-selected={row < selection.rows && column < selection.columns} />
      }))}
    </div>
  </div>
}
