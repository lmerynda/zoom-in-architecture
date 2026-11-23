import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodeTraces, receive } from './otlp.mjs'

// A minimal protobuf encoder, to build the bytes an OpenTelemetry agent sends.
const varint = n => { const out = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b) } while (v); return Buffer.from(out) }
const key = (no, type) => varint((no << 3) | type)
const len = (no, buf) => Buffer.concat([key(no, 2), varint(buf.length), buf])
const str = (no, s) => len(no, Buffer.from(s, 'utf8'))
const num = (no, n) => Buffer.concat([key(no, 0), varint(n)])
const fixed64 = (no, n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return Buffer.concat([key(no, 1), b]) }
const kv = (k, v) => len(9, Buffer.concat([str(1, k), len(2, typeof v === 'number' ? num(3, v) : str(1, v))]))
const span = ({ trace, id, parent = '', name, kind, start, end, attrs = {}, status = 0 }) =>
  len(2, Buffer.concat([
    len(1, Buffer.from(trace, 'hex')), len(2, Buffer.from(id, 'hex')), ...(parent ? [len(4, Buffer.from(parent, 'hex'))] : []),
    str(5, name), num(6, kind), fixed64(7, start), fixed64(8, end),
    ...Object.entries(attrs).map(([k, v]) => kv(k, v)),
    ...(status ? [len(15, num(3, status))] : []),
  ]))
const request = spans => len(1, Buffer.concat([
  len(1, len(1, Buffer.concat([str(1, 'service.name'), len(2, str(1, 'kod'))]))),
  len(2, Buffer.concat(spans.map(span))),
]))

const server = { trace: 'aa'.repeat(16), id: '11'.repeat(8), name: 'POST /market/{id}/buy', kind: 2, start: 1_000_000_000, end: 1_005_000_000, attrs: { 'http.request.method': 'POST', 'http.route': '/market/{id}/buy', 'http.response.status_code': 200 } }
const db = { trace: 'aa'.repeat(16), id: '22'.repeat(8), parent: '11'.repeat(8), name: 'SELECT kod.market_offers', kind: 3, start: 1_001_000_000, end: 1_002_000_000, attrs: { 'db.system': 'h2', 'db.statement': 'select * from market_offers where id=?' }, status: 2 }

describe('decodeTraces', () => {
  it('reads spans, their parents, kinds, times, attributes and status from OTLP protobuf', () => {
    const spans = decodeTraces(request([server, db]))
    expect(spans.map(s => [s.name, s.kind, s.parent, s.status])).toEqual([
      ['POST /market/{id}/buy', 'server', '', 0],
      ['SELECT kod.market_offers', 'client', '11'.repeat(8), 2],
    ])
    expect(spans[0].attrs).toEqual({ 'http.request.method': 'POST', 'http.route': '/market/{id}/buy', 'http.response.status_code': 200 })
    expect([spans[0].start, spans[0].end]).toEqual([1000, 1005])
    expect(spans[1].resource).toEqual({ 'service.name': 'kod' })
  })

  it('reads nothing from an empty request', () => {
    expect(decodeTraces(Buffer.alloc(0))).toEqual([])
  })

  it('keeps non-ASCII attribute values', () => {
    expect(decodeTraces(request([{ ...server, attrs: { 'url.path': '/kingdom/Żółw' } }]))[0].attrs).toEqual({ 'url.path': '/kingdom/Żółw' })
  })
})

describe('receive', () => {
  it('takes OTLP/HTTP exports, gzipped or not, and answers them', async () => {
    const got = []
    const r = await receive(spans => got.push(...spans))
    try {
      const a = await fetch(`${r.endpoint}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf' }, body: request([server]) })
      const b = await fetch(`${r.endpoint}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf', 'content-encoding': 'gzip' }, body: gzipSync(request([db])) })
      const bad = await fetch(`${r.endpoint}/v1/traces`, { method: 'POST', body: Buffer.from([0x0f]) })
      expect([a.status, b.status, bad.status]).toEqual([200, 200, 400])
      expect(got.map(s => s.name)).toEqual(['POST /market/{id}/buy', 'SELECT kod.market_offers'])
    } finally { await r.close() }
  })
})
