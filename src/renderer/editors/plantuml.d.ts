declare module '@plantuml/core' {
  export function renderToString(lines: string[], success: (svg: string) => void, failure: (message: string) => void): void
}

declare module '@plantuml/core/themes.js' {}
declare module '@plantuml/core/openiconic.js' {}
declare module '@plantuml/core/emoji.js' {}
