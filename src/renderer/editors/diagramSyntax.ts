export const codeLanguageToken = /^[^\s`{},]+/
export const plantUmlAliases = ['puml', 'pu', 'uml']
export type DiagramKind = 'mermaid' | 'plantuml'

export function diagramKind(info = ''): DiagramKind | undefined {
  const language = codeLanguageToken.exec(info.trimStart())?.[0].toLowerCase()
  if (language === 'mermaid') return 'mermaid'
  if (language && (language === 'plantuml' || plantUmlAliases.includes(language))) return 'plantuml'
}
