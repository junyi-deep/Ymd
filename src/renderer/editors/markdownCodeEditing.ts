import { isolateHistory } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { EditorState, MapMode, Prec, StateEffect, StateField, type SelectionRange } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import type { CodeBlockPreferences } from '../../shared/contracts'
import type { CodeDisplayOption } from './codeToolbar'

export function codeNodeAt(state: EditorState, at: number, side: -1 | 1) {
  let node: SyntaxNode | null = syntaxTree(state).resolve(at, side)
  while (node && node.name !== 'FencedCode' && node.name !== 'CodeBlock') node = node.parent
  return node
}

export function closedCodeFence(node: SyntaxNode) {
  return node.name === 'FencedCode' && node.lastChild?.name === 'CodeMark' && node.lastChild.from > node.from
}

export function deleteCodeBlock(view: EditorView, opening: number) {
  const { state } = view
  if (state.readOnly) return
  const node = codeNodeAt(state, opening, 1)
  if (node?.from !== opening || node.name === 'FencedCode' && !closedCodeFence(node)) return
  const first = state.doc.lineAt(opening)
  const last = state.doc.lineAt(node.to)
  const wholeLine = /^[ \t>]*$/.test(state.sliceDoc(first.from, opening))
  const from = wholeLine ? first.from : opening
  const end = state.sliceDoc(node.to, last.to).trim() ? node.to : last.to
  const to = wholeLine && end === last.to && end < state.doc.length ? end + 1 : end
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, scrollIntoView: true,
    userEvent: 'delete.code', annotations: isolateHistory.of('full') })
  view.focus()
}

const changeDisplay = StateEffect.define<{ opening: number; option: CodeDisplayOption; value: boolean }>()
export const codeDisplayOverrides = StateField.define<Map<number, Partial<CodeBlockPreferences>>>({
  create: () => new Map(),
  update(value, transaction) {
    const display = transaction.effects.filter(effect => effect.is(changeDisplay))
    if (!display.length && (!transaction.docChanged || !value.size)) return value
    const updated = new Map<number, Partial<CodeBlockPreferences>>()
    for (const [position, preferences] of value) {
      const opening = transaction.changes.mapPos(position, 1, MapMode.TrackAfter)
      if (opening !== null) updated.set(opening, preferences)
    }
    for (const { value: { opening, option, value } } of display) updated.set(opening, { ...updated.get(opening), [option]: value })
    return updated
  },
})

export function toggleCodeDisplay(view: EditorView, opening: number, option: CodeDisplayOption, value: boolean) {
  const retainFocus = view.root.activeElement instanceof HTMLElement &&
    view.root.activeElement.dataset.codeOption === option && view.dom.contains(view.root.activeElement)
  view.dispatch({ effects: changeDisplay.of({ opening, option, value }) })
  if (retainFocus) view.dom.querySelector<HTMLElement>(
    '[data-code-opening="' + opening + '"] [data-code-option="' + option + '"]',
  )?.focus({ preventScroll: true })
}

const continuation = (prefix: string) => prefix.replace(/[^ \t>]/g, ' ')

function typeAboveFence(view: EditorView, selection: SelectionRange, text: string) {
  if (view.state.readOnly || !selection.empty) return false
  const { state } = view
  const at = selection.from
  const block = codeNodeAt(state, at, 1)
  if (block?.name !== 'FencedCode' || block.from !== at) return false
  const line = state.doc.lineAt(at)
  const prefix = continuation(state.sliceDoc(line.from, at))
  const above = text === '\n' ? '' : text
  view.dispatch({ changes: { from: at, insert: above + '\n' + prefix },
    selection: { anchor: at + above.length }, scrollIntoView: true, userEvent: 'input.type' })
  return true
}

function pairTypedFence(view: EditorView, at: number, text: string) {
  if (text !== '`' && text !== '```') return false
  const { state } = view
  const line = state.doc.lineAt(at)
  if (at !== line.to || codeNodeAt(state, at, -1)) return false
  const opening = /^((?:[ \t>]|[-+*][ \t]+|\d{1,9}[.)][ \t]+)*)```$/.exec(line.text + text)
  if (!opening) return false
  const prefix = continuation(opening[1])
  if (line.number < state.doc.lines && /^`{3,}[ \t]*$/.test(state.doc.line(line.number + 1).text.slice(prefix.length)) &&
      state.doc.line(line.number + 1).text.startsWith(prefix)) return false
  view.dispatch({ changes: { from: at, insert: text + '\n' + prefix + '```' },
    selection: { anchor: at + text.length }, scrollIntoView: true, userEvent: 'input.type' })
  return true
}

export const markdownCodeInput = [
  Prec.highest(keymap.of([{ key: 'Enter', run: view =>
    view.state.selection.ranges.length === 1 && typeAboveFence(view, view.state.selection.main, '\n') }])),
  EditorView.inputHandler.of((view, from, to, text) => {
    const { state } = view
    if (!text || state.readOnly || from !== to || state.selection.ranges.length !== 1 || state.selection.main.from !== from) return false
    return typeAboveFence(view, state.selection.main, text) || pairTypedFence(view, from, text)
  }),
]
