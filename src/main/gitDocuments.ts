import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { GitBranchInfo, GitCommit, GitFileHistory, GitFileVersion } from '../shared/contracts'
import { containsPath } from './files'

const exec = promisify(execFile)
const oid = /^(?:[\da-f]{40}|[\da-f]{64})$/i
const maxBytes = 16 * 1024 * 1024
const historyLimit = 80
const commitFormat = '%H%x00%h%x00%cI%x00%s%x00%b'
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)))
env.GIT_TERMINAL_PROMPT = '0'
env.GIT_OPTIONAL_LOCKS = '0'
env.GIT_NO_LAZY_FETCH = '1'
let executable: string | undefined

async function gitExecutable() {
  if (executable) return executable
  const windows = process.platform === 'win32'
  const directories = (process.env.PATH ?? '').split(path.delimiter).map(part => part.replace(/^"|"$/g, ''))
  if (windows) {
    for (const root of [process.env.ProgramFiles, process.env.ProgramW6432, process.env['ProgramFiles(x86)']]) {
      if (root) directories.push(path.join(root, 'Git', 'cmd'))
    }
    if (process.env.LOCALAPPDATA) directories.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd'))
  } else {
    directories.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin')
  }
  for (const directory of new Set(directories.filter(value => path.isAbsolute(value)))) {
    const candidate = path.join(directory, windows ? 'git.exe' : 'git')
    if (await access(candidate, constants.X_OK).then(() => true, () => false)) return executable = candidate
  }
}

async function hasGitDirectory(directory: string) {
  for (let current = directory;; current = path.dirname(current)) {
    if (await lstat(path.join(current, '.git')).then(() => true, () => false)) return true
    if (path.dirname(current) === current) return false
  }
}

async function command(git: string, cwd: string, args: string[]) {
  const { stdout } = await exec(git, [
    '--no-pager', '--no-replace-objects', '--literal-pathspecs', '-c', 'protocol.allow=never', ...args,
  ], { cwd, env, encoding: 'buffer', maxBuffer: maxBytes, timeout: 8000, windowsHide: true })
  return stdout
}

function line(output: Buffer) {
  return output.toString('utf8').replace(/\r?\n$/, '')
}

function commits(output: Buffer): GitCommit[] {
  const fields = output.toString('utf8').split('\0')
  const list: GitCommit[] = []
  for (let index = 0; index + 4 < fields.length; index += 5) {
    const [hash, short, committedAt, subject, body] = fields.slice(index, index + 5)
    if (!oid.test(hash) || !/^[\da-f]+$/i.test(short)) continue
    list.push({ hash, short, subject, body: body.trimEnd(), committedAt })
  }
  return list
}

async function worktree(file: string) {
  const cwd = path.dirname(file)
  if (!await hasGitDirectory(cwd)) return null
  const git = await gitExecutable()
  if (!git) return null
  const root = await command(git, cwd, ['rev-parse', '--show-toplevel']).then(line, () => '')
  if (!path.isAbsolute(root) || !containsPath(root, file)) return null
  const relative = path.relative(root, file).split(path.sep).join('/')
  return { relative, run: (args: string[]) => command(git, root, args) }
}

async function branchInfo(run: NonNullable<Awaited<ReturnType<typeof worktree>>>['run']): Promise<GitBranchInfo> {
  const [branch, head] = await Promise.all([
    run(['symbolic-ref', '--quiet', '--short', 'HEAD']).then(line, () => ''),
    run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']).then(line, () => ''),
  ])
  return { branch: branch || null, head: oid.test(head) ? head : null }
}

export async function readGitBranch(file: string): Promise<GitBranchInfo | null> {
  const repo = await worktree(file)
  return repo && branchInfo(repo.run)
}

export async function readGitHistory(file: string): Promise<GitFileHistory | null> {
  const repo = await worktree(file)
  if (!repo) return null
  const info = await branchInfo(repo.run)
  if (!info.head) return { ...info, commits: [], previous: null }
  const flags = ['log', '-z', '--no-show-signature', '--format=' + commitFormat]
  const history = commits(await repo.run([...flags, '--max-count=' + historyLimit, info.head, '--', repo.relative]))
  const previous = history[1]?.hash ?? null
  if (history[0]?.hash !== info.head) {
    history.unshift(...commits(await repo.run([...flags, '-1', info.head, '--'])))
  }
  return { ...info, commits: history, previous }
}

export async function readGitVersion(file: string, commit: string): Promise<GitFileVersion> {
  if (typeof commit !== 'string' || !oid.test(commit)) throw new Error('无效的 Git 提交。')
  const repo = await worktree(file)
  if (!repo) throw new Error('找不到文件所属的 Git 仓库。')
  try {
    const entries = await repo.run(['ls-tree', '--full-tree', '-z', commit + '^{commit}', '--', repo.relative])
    const blob = /^100(?:644|755) blob ([\da-f]{40}|[\da-f]{64})\t/i.exec(entries.toString('utf8'))?.[1]
    if (!blob) return { exists: false, text: '' }
    const content = await repo.run(['cat-file', 'blob', blob])
    if (content.includes(0)) throw new Error('binary')
    return { exists: true, text: decoder.decode(content) }
  } catch {
    throw new Error('无法读取该 Git 版本。请确认提交存在，且文件是 16 MB 以内的 UTF-8 文本。')
  }
}
