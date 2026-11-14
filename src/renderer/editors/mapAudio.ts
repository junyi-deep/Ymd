export interface AudioNote {
  id: string
  duration: number
}

export const audioTitle = '录音备注'

export function readAudioNote(value: unknown): AudioNote | undefined {
  if (!value || typeof value !== 'object') return
  const note = value as Partial<AudioNote>
  if (typeof note.id === 'string' && /^[a-f0-9-]{36}$/.test(note.id) &&
      typeof note.duration === 'number' && Number.isFinite(note.duration) && note.duration >= 0) {
    return { id: note.id, duration: note.duration }
  }
}

export function audioTime(seconds: number) {
  const elapsed = Math.floor(Math.max(0, seconds))
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0')
  return minutes + ':' + String(elapsed % 60).padStart(2, '0')
}

function storedAudio<T>(mode: IDBTransactionMode, action: (files: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const opening = indexedDB.open('ymd-map-audio', 1)
    opening.onupgradeneeded = () => { opening.result.createObjectStore('recordings') }
    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const database = opening.result
      const transaction = database.transaction('recordings', mode)
      const request = action(transaction.objectStore('recordings'))
      transaction.oncomplete = () => { database.close(); resolve(request.result) }
      transaction.onabort = () => { database.close(); reject(transaction.error ?? request.error) }
    }
  })
}

export function storeAudio(id: string, audio: Blob) {
  return storedAudio('readwrite', files => files.add(audio, id))
}

export async function loadAudio(id: string): Promise<Blob> {
  const audio: unknown = await storedAudio('readonly', files => files.get(id))
  if (!(audio instanceof Blob) || !audio.size) throw new Error('找不到此录音的音频文件。')
  return audio
}

export function forgetAudio(id: string) {
  return storedAudio('readwrite', files => files.delete(id))
}

export function audioButton(note: AudioNote, onPlay: () => void) {
  const element = document.createElement('button')
  element.type = 'button'
  element.dataset.audioNote = note.id
  element.className = 'map-audio-badge'
  element.style.cssText = 'display:block;width:76px;height:23px;border:0;border-radius:5px;background:#dceaff;color:#214768;text-align:center;font:600 11px system-ui;cursor:pointer;font-variant-numeric:tabular-nums;'
  element.textContent = '▶ ' + audioTime(note.duration)
  element.setAttribute('aria-label', '播放录音')
  for (const event of ['mousedown', 'pointerdown', 'dblclick']) element.addEventListener(event, input => input.stopPropagation())
  element.addEventListener('click', event => { event.stopPropagation(); onPlay() })
  return { el: element, width: 76, height: 23 }
}

export function createAudioPlayer(canvas: HTMLElement, error: (message: string) => void) {
  const player = new Audio()
  let url: string | undefined
  let active: AudioNote | undefined
  let revision = 0

  function display(button: HTMLButtonElement, note?: AudioNote) {
    const selected = !!active && active.id === button.dataset.audioNote
    const playing = selected && !player.paused
    const total = note?.duration ?? Number(button.dataset.duration ?? 0)
    button.dataset.duration = String(total)
    button.textContent = (playing ? 'Ⅱ ' : '▶ ') + audioTime(selected && player.currentTime > 0 ? player.currentTime : total)
    button.setAttribute('aria-label', playing ? '暂停录音' : '播放录音')
  }

  const refresh = () => canvas.querySelectorAll<HTMLButtonElement>('.map-audio-badge').forEach(button => display(button))
  function stop() {
    revision++
    active = undefined
    player.pause()
    if (url) {
      player.removeAttribute('src')
      player.load()
      URL.revokeObjectURL(url)
      url = undefined
    }
    refresh()
  }

  for (const type of ['play', 'pause', 'timeupdate']) player.addEventListener(type, refresh)
  player.addEventListener('ended', stop)
  player.addEventListener('error', () => {
    if (!url || !player.error) return
    stop()
    error('无法播放此录音。')
  })

  return {
    get activeId() { return active?.id },
    stop,
    decorate: display,
    async toggle(note: AudioNote) {
      if (active?.id === note.id) {
        if (!url) return
        if (!player.paused) { player.pause(); return }
        await player.play().catch(() => error('无法播放此录音。'))
        return
      }
      stop()
      const attempt = revision
      active = note
      try {
        const audio = await loadAudio(note.id)
        if (revision !== attempt) return
        url = URL.createObjectURL(audio)
        player.src = url
        await player.play()
      } catch (cause) {
        if (revision !== attempt) return
        stop()
        error(cause instanceof Error ? cause.message : '无法播放此录音。')
      }
    },
  }
}
