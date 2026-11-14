import { net } from 'electron'
import type { VersionStatus } from '../shared/contracts'

const repositoryUrl = 'https://github.com/junyi-deep/Ymd/releases/tag/'
const versionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

function compare(left: RegExpExecArray, right: RegExpExecArray) {
  const difference = [1, 2, 3].map(index => Number(left[index]) - Number(right[index])).find(Boolean)
  if (difference) return difference
  if (!left[4] || !right[4]) return Number(!left[4]) - Number(!right[4])
  const a = left[4].split('.')
  const b = right[4].split('.')
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] === b[index]) continue
    const aNumeric = /^\d+$/.test(a[index])
    const bNumeric = /^\d+$/.test(b[index])
    if (aNumeric && bNumeric) return Number(a[index]) - Number(b[index])
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a[index] < b[index] ? -1 : 1
  }
  return a.length - b.length
}

export async function readReleaseStatus(current: string): Promise<VersionStatus> {
  const installed = versionPattern.exec(current)
  if (!installed) return { current }
  const response = await net.fetch('https://api.github.com/repos/junyi-deep/Ymd/releases?per_page=20', {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error('GitHub 更新检查失败（HTTP ' + response.status + '）。')
  const releases: { tag_name?: string; draft?: boolean; prerelease?: boolean }[] = await response.json()
  const candidate = releases.flatMap(release => {
    const tag = release.tag_name
    const parsed = tag && versionPattern.exec(tag)
    return parsed && !release.draft && (installed[4] || !release.prerelease && !parsed[4]) && compare(parsed, installed) > 0
      ? [{ tag, parsed }] : []
  }).sort((a, b) => compare(b.parsed, a.parsed))[0]
  return candidate ? { current, update: { version: candidate.tag.replace(/^v/, ''), url: repositoryUrl + encodeURIComponent(candidate.tag) } } : { current }
}
