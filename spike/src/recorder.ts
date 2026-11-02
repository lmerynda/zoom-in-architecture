import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, WebMOutputFormat, canEncodeVideo } from 'mediabunny'

/**
 * Encodes frames sent by scripts/record.mjs into a video with WebCodecs: H.264 MP4 when the
 * browser can encode it, else VP9 WebM. No ffmpeg needed.
 */
let output: Output | null = null
let source: CanvasSource | null = null
let n = 0
let fps = 30
const canvas = document.getElementById('frame') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

Object.assign(window, {
  rec: {
    async start(width: number, height: number, frameRate: number) {
      fps = frameRate
      n = 0
      canvas.width = width
      canvas.height = height
      const avc = await canEncodeVideo('avc', { width, height })
      const codec = avc ? 'avc' : 'vp9'
      output = new Output({ format: avc ? new Mp4OutputFormat() : new WebMOutputFormat(), target: new BufferTarget() })
      source = new CanvasSource(canvas, { codec, bitrate: 8e6, keyFrameInterval: 2 })
      output.addVideoTrack(source, { frameRate })
      await output.start()
      return avc ? 'mp4' : 'webm'
    },
    async frame(jpegBase64: string) {
      const blob = await (await fetch(`data:image/jpeg;base64,${jpegBase64}`)).blob()
      const img = await createImageBitmap(blob)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      img.close()
      await source!.add(n / fps, 1 / fps)
      n++
    },
    async finish(): Promise<string> {
      await output!.finalize()
      const buf = (output!.target as BufferTarget).buffer!
      const url: string = await new Promise(resolve => {
        const r = new FileReader()
        r.onload = () => resolve(r.result as string)
        r.readAsDataURL(new Blob([buf]))
      })
      return url.slice(url.indexOf(',') + 1)
    },
  },
})
