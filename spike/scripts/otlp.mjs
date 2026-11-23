// Receiving traces from a project's own end-to-end tests: a tiny OTLP/HTTP receiver that takes what
// an OpenTelemetry agent exports (protobuf, the agents' default) and keeps each span as plain JSON.
// Only the fields the map uses are decoded; the wire format is read by hand, so no dependency.
import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'

/** Reads protobuf wire format: each field as [number, wire type, value]. */
function* fields(buf) {
  let i = 0
  const varint = () => {
    let v = 0n, shift = 0n
    for (;;) {
      const b = buf[i++]
      v |= BigInt(b & 0x7f) << shift
      if (!(b & 0x80)) return v
      shift += 7n
    }
  }
  while (i < buf.length) {
    const key = Number(varint()), no = key >>> 3, type = key & 7
    if (type === 0) yield [no, 0, varint()]
    else if (type === 1) { yield [no, 1, buf.subarray(i, i + 8)]; i += 8 }
    else if (type === 2) { const n = Number(varint()); yield [no, 2, buf.subarray(i, i + n)]; i += n }
    else if (type === 5) { yield [no, 5, buf.subarray(i, i + 4)]; i += 4 }
    else throw new Error(`protobuf wire type ${type} is not supported`)
  }
}

const text = b => Buffer.from(b).toString('utf8')
const hex = b => Buffer.from(b).toString('hex')
const u64 = b => Buffer.from(b).readBigUInt64LE(0)

/** An OTLP AnyValue: string, bool, int, double, or an array of them. */
function anyValue(buf) {
  for (const [no, type, v] of fields(buf)) {
    if (no === 1) return text(v)
    if (no === 2) return v !== 0n
    // int64 as two's complement in a varint.
    if (no === 3) return Number(BigInt.asIntN(64, v))
    if (no === 4 && type === 1) return Buffer.from(v).readDoubleLE(0)
    if (no === 5) return [...fields(v)].filter(([n]) => n === 1).map(([, , x]) => anyValue(x))
  }
  return null
}

/** OTLP KeyValue list into an object. */
function attributes(list) {
  const out = {}
  for (const kv of list) {
    let key = '', value = null
    for (const [no, , v] of fields(kv)) {
      if (no === 1) key = text(v)
      if (no === 2) value = anyValue(v)
    }
    if (key) out[key] = value
  }
  return out
}

const KIND = ['unspecified', 'internal', 'server', 'client', 'producer', 'consumer']

/**
 * The spans of one ExportTraceServiceRequest, each with its resource's attributes:
 * { trace, id, parent, name, kind, start, end (ns, as numbers of ms with fraction), attrs, status, resource }.
 */
export function decodeTraces(buf) {
  const out = []
  for (const [no, , rs] of fields(buf)) {
    if (no !== 1) continue
    let resource = {}
    const scopes = []
    for (const [n, , v] of fields(rs)) {
      if (n === 1) resource = attributes([...fields(v)].filter(([k]) => k === 1).map(([, , x]) => x))
      if (n === 2) scopes.push(v)
    }
    for (const ss of scopes) for (const [n, , sp] of fields(ss)) {
      if (n !== 2) continue
      const span = { trace: '', id: '', parent: '', name: '', kind: 'unspecified', start: 0, end: 0, attrs: {}, status: 0, resource }
      const attrs = []
      for (const [k, , v] of fields(sp)) {
        if (k === 1) span.trace = hex(v)
        else if (k === 2) span.id = hex(v)
        else if (k === 4) span.parent = hex(v)
        else if (k === 5) span.name = text(v)
        else if (k === 6) span.kind = KIND[Number(v)] ?? 'unspecified'
        else if (k === 7) span.start = Number(u64(v) / 1000n) / 1000
        else if (k === 8) span.end = Number(u64(v) / 1000n) / 1000
        else if (k === 9) attrs.push(v)
        else if (k === 15) for (const [s, , c] of fields(v)) if (s === 3) span.status = Number(c)
      }
      span.attrs = attributes(attrs)
      out.push(span)
    }
  }
  return out
}

/**
 * Listens for OTLP/HTTP trace exports on a free local port and hands every span to `onSpans`.
 * Resolves with the endpoint to give the agent and a close().
 */
export function receive(onSpans) {
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try {
        let body = Buffer.concat(chunks)
        if (/gzip/.test(req.headers['content-encoding'] ?? '')) body = gunzipSync(body)
        if (req.url?.startsWith('/v1/traces')) onSpans(decodeTraces(body))
        // An empty ExportTraceServiceResponse: success.
        res.writeHead(200, { 'content-type': 'application/x-protobuf' })
        res.end()
      } catch (e) {
        res.writeHead(400)
        res.end(String(e))
      }
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ endpoint: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) })))
}
