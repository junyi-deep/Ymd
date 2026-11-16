export const equationExtension = 'org.xmind.ui.mathJax'
export const equationLimit = 4000

export function readEquation(value: unknown) {
  return typeof value === 'string' && value.trim() && value.length <= equationLimit ? value : undefined
}
