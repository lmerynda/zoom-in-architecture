/**
 * Small synthesized UI sounds: a blip on select, a soft chime when a level opens, a filtered
 * whoosh on long flights. Off by default; M toggles.
 */
export class Sound {
  on = false
  private ctx: AudioContext | null = null
  private lastChime = 0

  toggle() {
    this.on = !this.on
    if (this.on && !this.ctx) this.ctx = new AudioContext()
    if (this.on) this.blip(880, 0.05)
    return this.on
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', glideTo?: number) {
    const ctx = this.ctx
    if (!this.on || !ctx) return
    const t = ctx.currentTime
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(ctx.destination)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  blip(freq = 660, dur = 0.07) { this.tone(freq, dur, 0.08, 'triangle', freq * 1.5) }

  select() { this.blip(620, 0.06); setTimeout(() => this.blip(930, 0.07), 45) }

  chime() {
    const now = performance.now()
    if (now - this.lastChime < 160) return
    this.lastChime = now
    this.tone(523, 0.35, 0.035)
    this.tone(784, 0.45, 0.025)
  }

  whoosh(seconds: number) {
    const ctx = this.ctx
    if (!this.on || !ctx || seconds < 0.5) return
    const t = ctx.currentTime
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain()
    src.buffer = buf
    f.type = 'bandpass'
    f.Q.value = 1.2
    f.frequency.setValueAtTime(300, t)
    f.frequency.exponentialRampToValueAtTime(2400, t + seconds * 0.5)
    f.frequency.exponentialRampToValueAtTime(400, t + seconds)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.05, t + seconds * 0.4)
    g.gain.linearRampToValueAtTime(0, t + seconds)
    src.connect(f).connect(g).connect(ctx.destination)
    src.start(t)
  }
}
