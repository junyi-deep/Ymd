import { useEffect, useRef, useState } from 'react'
import { Mic, Pause, Play, Square } from 'lucide-react'
import { audioTime } from './mapAudio'

type Phase = 'idle' | 'waiting' | 'recording' | 'paused' | 'stopping' | 'review' | 'saving'
type Recording = { audio: Blob; duration: number }
type Capture = {
  recorder: MediaRecorder
  stream: MediaStream
  accumulated: number
  started?: number
  stopped: boolean
}

function durationOf(capture: Capture) {
  const live = capture.started === undefined ? 0 : performance.now() - capture.started
  return (capture.accumulated + live) / 1000
}

function recorderError(error: unknown) {
  if (error instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error.name)) return '请在系统设置中允许 Ymd 使用麦克风。'
  if (error instanceof DOMException && error.name === 'NotFoundError') return '找不到可用的麦克风。'
  return error instanceof Error ? error.message : '无法使用麦克风。'
}

export function MindMapRecorder({ title, close, save }: {
  title: string
  close: () => void
  save: (audio: Blob, duration: number) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const live = useRef<Capture | undefined>(undefined)
  const mounted = useRef(false)
  const pending = useRef(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [recording, setRecording] = useState<Recording>()
  const [preview, setPreview] = useState('')
  const [problem, setProblem] = useState('')

  useEffect(() => {
    mounted.current = true
    dialog.current?.showModal()
    return () => {
      mounted.current = false
      const capture = live.current
      live.current = undefined
      if (capture) {
        if (capture.recorder.state !== 'inactive') capture.recorder.stop()
        capture.stream.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  useEffect(() => {
    if (phase !== 'recording') return
    const timer = window.setInterval(() => {
      if (live.current) setElapsed(durationOf(live.current))
    }, 150)
    return () => window.clearInterval(timer)
  }, [phase])

  useEffect(() => {
    if (!recording) return
    const url = URL.createObjectURL(recording.audio)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [recording])

  async function start() {
    if (pending.current || live.current) return
    pending.current = true
    setProblem('')
    setPhase('waiting')
    let stream: MediaStream | undefined
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return }
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 48000 })
      const capture: Capture = { recorder, stream, accumulated: 0, started: performance.now(), stopped: false }
      live.current = capture
      const chunks: Blob[] = []
      let failed = false
      recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data) })
      recorder.addEventListener('error', () => { failed = true; setProblem('录音中断，请重新录制。') })
      recorder.addEventListener('stop', () => {
        stream?.getTracks().forEach(track => track.stop())
        if (live.current !== capture) return
        live.current = undefined
        if (!mounted.current) return
        const audio = new Blob(chunks, { type: 'audio/webm' })
        const duration = durationOf(capture)
        if (failed || !audio.size) {
          setPhase('idle')
          if (!failed) setProblem('录音为空，请重新录制。')
        } else {
          setElapsed(duration)
          setRecording({ audio, duration })
          setPhase('review')
        }
      }, { once: true })
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => {
        if (live.current === capture) stop()
      }, { once: true }))
      recorder.start(1000)
      setRecording(undefined)
      setPreview('')
      setElapsed(0)
      setPhase('recording')
    } catch (error) {
      live.current = undefined
      stream?.getTracks().forEach(track => track.stop())
      if (mounted.current) { setProblem(recorderError(error)); setPhase(recording ? 'review' : 'idle') }
    } finally { pending.current = false }
  }

  function stop() {
    const capture = live.current
    if (!capture || capture.stopped || capture.recorder.state === 'inactive') return
    capture.accumulated = durationOf(capture) * 1000
    capture.started = undefined
    capture.stopped = true
    capture.recorder.stop()
    capture.stream.getTracks().forEach(track => track.stop())
    setPhase('stopping')
  }

  function pause() {
    const capture = live.current
    if (!capture || capture.stopped) return
    if (capture.recorder.state === 'recording') {
      capture.accumulated = durationOf(capture) * 1000
      capture.started = undefined
      capture.recorder.pause()
      setElapsed(capture.accumulated / 1000)
      setPhase('paused')
    } else if (capture.recorder.state === 'paused') {
      capture.started = performance.now()
      capture.recorder.resume()
      setPhase('recording')
    }
  }

  function exit() {
    if (phase === 'recording' || phase === 'paused') stop()
    else if (phase !== 'saving' && phase !== 'stopping') close()
  }

  async function addNote() {
    if (!recording || pending.current) return
    pending.current = true
    setPhase('saving')
    setProblem('')
    try { await save(recording.audio, recording.duration) }
    catch (error) {
      if (mounted.current) {
        setProblem(error instanceof Error ? error.message : '无法保存录音。')
        setPhase('review')
      }
    } finally { pending.current = false }
  }

  const capturing = phase === 'recording' || phase === 'paused'
  return <dialog ref={dialog} className="map-recorder" aria-labelledby="map-recorder-title"
    onCancel={event => { event.preventDefault(); exit() }}>
    <div>
      <h2 id="map-recorder-title">录音备注</h2>
      <p className="map-recorder-topic" title={title}>{title}</p>
      <div className="map-recorder-meter" data-recording={phase === 'recording'}>
        <Mic size={21} /><time>{audioTime(elapsed)}</time>
        {phase === 'waiting' && <span role="status">正在连接麦克风…</span>}
        {phase === 'paused' && <span role="status">已暂停</span>}
      </div>
      {phase === 'review' && preview && <audio src={preview} controls preload="metadata" aria-label="试听录音" />}
      {problem && <p className="map-recorder-problem" role="alert">{problem}</p>}
      <footer>
        {!capturing && <button type="button" onClick={exit} disabled={phase === 'saving' || phase === 'stopping'}>取消</button>}
        {phase === 'idle' && <button type="button" className="primary" autoFocus onClick={() => void start()}><Mic size={15} />开始录音</button>}
        {capturing && <>
          <button type="button" onClick={pause}>{phase === 'paused' ? <Play size={14} /> : <Pause size={14} />}
            {phase === 'paused' ? '继续录音' : '暂停录音'}</button>
          <button type="button" className="primary" onClick={stop}><Square size={14} />结束录音</button>
        </>}
        {phase === 'review' && <>
          <button type="button" onClick={() => void start()}>重新录音</button>
          <button type="button" className="primary" onClick={() => void addNote()}>保存备注</button>
        </>}
        {phase === 'saving' && <span role="status">正在保存…</span>}
      </footer>
    </div>
  </dialog>
}
