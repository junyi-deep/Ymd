import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { plantUmlAliases } from './diagramSyntax'

const mermaid = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match(/^%%/)) { stream.skipToEnd(); return 'comment' }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'
    if (stream.match(/^(?:flowchart|graph|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|gitGraph|mindmap|timeline|quadrantChart|xychart(?:-beta)?|block(?:-beta)?|architecture-beta|packet-beta|kanban|sankey-beta|requirementDiagram|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|subgraph|end|participant|actor|as|autonumber|activate|deactivate|loop|alt|else|opt|par|and|rect|critical|option|break|note|section|class|style|classDef|linkStyle|click|direction|LR|RL|TB|TD|BT)\b/i)) return 'keyword'
    if (stream.match(/^(?:<?[=.-]+[>ox]?|:::+|[|{}()[\]])/)) return 'operatorKeyword'
    if (stream.match(/^\d+(?:\.\d+)?\b/)) return 'number'
    if (stream.match(/^[\p{L}_][\p{L}\p{N}_-]*/u)) return 'variableName'
    stream.next()
    return null
  },
})

const plantuml = StreamLanguage.define({
  startState: () => ({ comment: false }),
  token(stream, state) {
    if (state.comment || stream.match(/^\/'/)) {
      state.comment = !stream.match(/^.*?'\//)
      if (state.comment) stream.skipToEnd()
      return 'comment'
    }
    if (stream.eatSpace()) return null
    if (stream.match(/^'/)) { stream.skipToEnd(); return 'comment' }
    if (stream.match(/^@(?:start|end)\w+|^![\w]+/i)) return 'meta'
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'
    if (stream.match(/^#[\da-z]+\b/i)) return 'atom'
    if (stream.match(/^(?:actor|participant|boundary|control|entity|database|collections|queue|as|class|abstract|interface|enum|annotation|package|namespace|object|component|node|folder|frame|cloud|artifact|rectangle|state|usecase|title|caption|legend|skinparam|hide|show|remove|note|left|right|top|bottom|over|activate|deactivate|create|destroy|autonumber|group|alt|else|opt|loop|par|break|critical|end|start|stop|if|then|elseif|endif|while|endwhile|repeat|fork|split|switch|case|partition)\b/i)) return 'keyword'
    if (stream.match(/^(?:<?[.=-]+[>ox]?|[{}()[\]])/)) return 'operatorKeyword'
    if (stream.match(/^\d+(?:\.\d+)?\b/)) return 'number'
    if (stream.match(/^[\p{L}_][\p{L}\p{N}_-]*/u)) return 'variableName'
    stream.next()
    return null
  },
})

export const codeLanguages = [
  ...languages,
  LanguageDescription.of({ name: 'Mermaid', support: new LanguageSupport(mermaid) }),
  LanguageDescription.of({ name: 'PlantUML', alias: plantUmlAliases, support: new LanguageSupport(plantuml) }),
]
