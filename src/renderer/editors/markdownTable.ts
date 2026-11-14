import { isolateHistory } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { EditorState, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { markdownInlineHtml } from './markdownHtml'
import type { ContextMenuItem } from '../../shared/contracts'

type Alignment = 'left' | 'center' | 'right' | ''
type Cell = { row: number; column: number }
type Table = { rows: string[][]; alignment: Alignment[] }
type Navigation = { next: Cell; change?: (table: Table) => void; edit?: boolean }

function splitRow(line: string) {
  const source = line.trim().replace(/^\|/, '')
  const cells = ['']
  for (let offset = 0; offset < source.length; offset++) {
    const char = source[offset]
    if (char === '\\' && source[offset + 1]) cells[cells.length - 1] += char + source[++offset]
    else if (char === '|') {
      if (offset !== source.length - 1) cells.push('')
    } else cells[cells.length - 1] += char
  }
  return cells.map(cell => cell.trim())
}

function parseTable(text: string): Table | undefined {
  const [header, divider, ...body] = text.split('\n')
  if (!divider) return
  const alignment = splitRow(divider).map((marker): Alignment => marker.endsWith(':') ? marker.startsWith(':') ? 'center' : 'right' : marker.startsWith(':') ? 'left' : '')
  const rows = [header, ...body].map(splitRow)
  if (rows[0].length !== alignment.length || rows.some(row => row.length > alignment.length)) return
  return { alignment, rows: rows.map(row => [...row, ...Array(alignment.length - row.length).fill('')]) }
}

function writeTable({ rows, alignment }: Table) {
  const line = (row: string[]) => '| ' + row.join(' | ') + ' |'
  const divider = alignment.map(side => ({ left: ':---', center: ':---:', right: '---:', '': '---' }[side]))
  return [line(rows[0]), line(divider), ...rows.slice(1).map(line)].join('\n')
}

function cellText(input: string) {
  return input.trim().replaceAll('\n', '<br>').replace(/(?<!\\)((?:\\\\)*)\|/g, '$1\\|')
}

type TableAction = { label: string; run: () => void; disabled?: boolean; separator?: boolean }
const editRange = (table: HTMLElement, cell: Cell) =>
  table.querySelector<HTMLTableCellElement>('[data-row="' + cell.row + '"][data-column="' + cell.column + '"]')

function focusCell(table: HTMLElement, cell: Cell, edit?: boolean) {
  const element = editRange(table, cell)
  if (edit) element?.click()
  else element?.focus()
}

function emptyRow(table: Table) {
  return Array<string>(table.alignment.length).fill('')
}

function navigate(event: KeyboardEvent, cell: Cell, data: Table): Navigation | undefined {
  const mod = event.metaKey || event.ctrlKey
  if (mod && event.key === 'Enter') return {
    next: { row: cell.row + 1, column: cell.column }, edit: true,
    change: table => table.rows.splice(cell.row + 1, 0, emptyRow(table)),
  }
  if (mod && event.shiftKey && event.key === 'Backspace' && cell.row > 0) return {
    next: { row: Math.min(cell.row, data.rows.length - 2), column: cell.column },
    change: table => table.rows.splice(cell.row, 1),
  }
  if (event.key !== 'Tab' || mod || event.altKey) return
  const columns = data.alignment.length
  const index = cell.row * columns + cell.column + (event.shiftKey ? -1 : 1)
  if (index < 0) return
  const next = { row: Math.floor(index / columns), column: index % columns }
  return next.row === data.rows.length
    ? { next, edit: true, change: table => table.rows.push(emptyRow(table)) }
    : { next, edit: true }
}

class EditableTable extends WidgetType {
  constructor(readonly start: number, readonly text: string, readonly readOnly: boolean) { super() }

  eq(other: EditableTable) { return this.start === other.start && this.text === other.text && this.readOnly === other.readOnly }

  toDOM(view: EditorView) {
    const data = parseTable(this.text)!
    const figure = document.createElement('figure')
    figure.className = 'markdown-table-widget'
    figure.dataset.table = String(this.start)
    const table = document.createElement('table')
    table.setAttribute('aria-label', 'Markdown 表格')
    const head = table.createTHead()
    const body = table.createTBody()
    let active: Cell = { row: 0, column: 0 }
    let editor: HTMLInputElement | undefined

    const commit = (data: Table, next?: Cell, remove = false, edit?: boolean) => {
      const pos = this.start
      if (view.state.readOnly || view.state.sliceDoc(pos, pos + this.text.length) !== this.text) return
      view.dispatch({
        changes: { from: pos, to: pos + this.text.length, insert: remove ? '' : writeTable(data) },
        annotations: isolateHistory.of('full'),
        userEvent: 'input.table',
      })
      if (next) {
        const updatedTable = view.dom.querySelector<HTMLElement>('.markdown-table-widget[data-table="' + pos + '"]')
        if (updatedTable) focusCell(updatedTable, next, edit)
      }
    }
    const update = (change: (data: Table) => void, next?: Cell, edit?: boolean) => {
      const copy = structuredClone(data)
      change(copy)
      commit(copy, next, false, edit)
    }
    const addRow = (index: number) => update(copy => copy.rows.splice(index, 0, emptyRow(copy)), { row: index, column: active.column })
    const addColumn = (index: number) => update(copy => {
      copy.alignment.splice(index, 0, '')
      copy.rows.forEach(row => row.splice(index, 0, ''))
    }, { row: active.row, column: index })

    function attachEditor(cell: HTMLTableCellElement, coord: Cell, value: string) {
      active = coord
      if (editor && cell.contains(editor)) { editor.focus(); return }
      const input = document.createElement('input')
      input.type = 'text'
      input.value = value.replace(/<br\s*\/?>/gi, ' ')
      const initial = input.value
      input.setAttribute('aria-label', '第 ' + (coord.row + 1) + ' 行第 ' + (coord.column + 1) + ' 列')
      const before = cell.innerHTML
      editor = input
      cell.replaceChildren(input)
      const finish = (save: boolean, navigation?: Navigation) => {
        if (editor !== input) return
        editor = undefined
        const result = input.value
        cell.innerHTML = before
        if (save && (result !== initial || navigation?.change)) update(copy => {
          if (result !== initial) copy.rows[coord.row][coord.column] = cellText(result)
          navigation?.change?.(copy)
        }, navigation?.next, navigation?.edit)
        else if (navigation) focusCell(table, navigation.next, navigation.edit)
      }
      input.addEventListener('blur', () => finish(true), { once: true })
      input.addEventListener('keydown', event => {
        if (event.isComposing) return
        const navigation = navigate(event, coord, data)
        if (!navigation && event.key !== 'Enter' && event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        finish(event.key !== 'Escape', navigation ?? { next: coord })
      })
      input.focus()
    }

    const tableActions = (): TableAction[] => {
      const { row, column } = active
      return [
        { label: '上方插入行', disabled: row === 0, run: () => addRow(row) },
        { label: '下方插入行', run: () => addRow(row + 1) },
        { label: '左侧插入列', run: () => addColumn(column) },
        { label: '右侧插入列', run: () => addColumn(column + 1) },
        { label: '向上移动表格行', separator: true, disabled: row < 2, run: () => update(copy => {
          [copy.rows[row - 1], copy.rows[row]] = [copy.rows[row], copy.rows[row - 1]]
        }, { row: row - 1, column }) },
        { label: '向下移动表格行', disabled: row === 0 || row >= data.rows.length - 1, run: () => update(copy => {
          [copy.rows[row + 1], copy.rows[row]] = [copy.rows[row], copy.rows[row + 1]]
        }, { row: row + 1, column }) },
        ...([-1, 1] as const).map(offset => ({
          label: offset < 0 ? '向左移动表格列' : '向右移动表格列',
          disabled: column + offset < 0 || column + offset >= data.alignment.length,
          run: () => update(copy => {
            const other = column + offset
            const swap = <T>(list: T[]) => { [list[column], list[other]] = [list[other], list[column]] }
            copy.rows.forEach(swap)
            swap(copy.alignment)
          }, { row, column: column + offset }),
        })),
        ...(['left', 'center', 'right'] as const).map((side, index) => ({
          label: ['左对齐', '居中', '右对齐'][index], separator: index === 0,
          run: () => update(copy => { copy.alignment[column] = side }, active),
        })),
        { label: '复制表格', separator: true, run: () => { void navigator.clipboard.writeText(this.text).catch(() => {}) } },
        { label: '格式化表格源码', run: () => update(() => {}) },
        { label: '删除行', disabled: row === 0, run: () => update(copy => copy.rows.splice(row, 1)) },
        { label: '删除列', disabled: data.alignment.length === 1, run: () => update(copy => {
          copy.alignment.splice(column, 1)
          copy.rows.forEach(row => row.splice(column, 1))
        }) },
        { label: '删除表格', run: () => commit(data, undefined, true) },
      ]
    }

    function openMenu(x: number, y: number) {
      if (view.state.readOnly) return
      const actions = tableActions()
      const menu: ContextMenuItem[] = actions.map(({ label, disabled, separator }, id) => ({ label, disabled, separator, id }))
      void window.desktop.markdownContextMenu(x, y, menu)
        .then(id => { if (id !== null && figure.isConnected && !actions[id]?.disabled) actions[id]?.run() })
        .catch(() => {})
    }

    if (!this.readOnly) {
      const bar = document.createElement('div')
      bar.className = 'markdown-table-tools'
      const button = (label: string, action: (button: HTMLButtonElement) => void) => {
        const element = document.createElement('button')
        element.type = 'button'
        element.textContent = label
        element.className = 'tool-button'
        element.addEventListener('click', () => action(element))
        bar.append(element)
      }
      button('表格操作', element => {
        const rect = element.getBoundingClientRect()
        openMenu(rect.left, rect.bottom)
      })
      button('编辑表格源码', () => {
        view.dispatch({ selection: { anchor: this.start }, scrollIntoView: true })
        view.focus()
      })
      figure.append(bar)
    }
    for (const [rowIndex, values] of data.rows.entries()) {
      const row = (rowIndex === 0 ? head : body).insertRow()
      for (const [column, text] of values.entries()) {
        const cell = document.createElement(rowIndex === 0 ? 'th' : 'td')
        if (rowIndex === 0) cell.scope = 'col'
        cell.style.textAlign = data.alignment[column] || 'left'
        cell.innerHTML = markdownInlineHtml(text)
        row.append(cell)
        if (this.readOnly) continue
        cell.dataset.row = String(rowIndex)
        cell.dataset.column = String(column)
        cell.tabIndex = 0
        const coord = { row: rowIndex, column }
        cell.addEventListener('focus', () => { active = coord })
        cell.addEventListener('click', event => { event.preventDefault(); attachEditor(cell, coord, text) })
        cell.addEventListener('keydown', event => {
          if (event.target !== cell || event.isComposing) return
          const navigation = event.key === 'Tab' ? undefined : navigate(event, coord, data)
          if (!navigation && event.key !== 'Enter' && event.key !== 'F2') return
          event.preventDefault()
          event.stopPropagation()
          if (navigation?.change) update(navigation.change, navigation.next, navigation.edit)
          else if (navigation) focusCell(table, navigation.next, navigation.edit)
          else attachEditor(cell, coord, text)
        })
        cell.addEventListener('contextmenu', event => {
          event.preventDefault(); event.stopPropagation(); active = coord; openMenu(event.clientX, event.clientY)
        })
      }
    }
    figure.append(table)
    return figure
  }
}

function decorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== 'Table') return
    if (state.doc.lineAt(node.from).from !== node.from ||
        !state.readOnly && state.selection.ranges.some(range => range.from <= node.to && range.to >= node.from)) return false
    const text = state.sliceDoc(node.from, node.to)
    if (parseTable(text)) ranges.push(Decoration.replace({ block: true, widget: new EditableTable(node.from, text, state.readOnly) }).range(node.from, node.to))
    return false
  } })
  return Decoration.set(ranges)
}

export const markdownTable = StateField.define({
  create: decorations,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection || transaction.startState.readOnly !== transaction.state.readOnly ||
      syntaxTree(transaction.startState) !== syntaxTree(transaction.state) ? decorations(transaction.state) : value
  },
  provide: field => EditorView.decorations.from(field),
})

export function insertTable(view: EditorView, rowCount: number, columnCount: number) {
  if (view.state.readOnly) return
  const align = Array<Alignment>(columnCount).fill('')
  const header = Array.from({ length: columnCount }, (_, index) => '列 ' + (index + 1))
  const rows = [header, ...Array.from({ length: rowCount - 1 }, () => header.map(() => ''))]
  const line = view.state.doc.lineAt(view.state.selection.main.to)
  const insert = (line.length ? '\n\n' : '') + writeTable({ rows, alignment: align }) + '\n\n'
  view.dispatch({
    changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length },
    annotations: isolateHistory.of('full'), scrollIntoView: true, userEvent: 'input.table',
  })
  view.focus()
}
