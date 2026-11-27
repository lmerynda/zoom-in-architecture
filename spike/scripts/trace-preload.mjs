// Loaded into every Node process a traced command starts (zoom trace puts it in NODE_OPTIONS), so
// the trace can say which test made a request without changing the project. It does nothing except
// in a node:test file's own process: there it names the file (by its full path) in
// OTEL_RESOURCE_ATTRIBUTES, which a server the file starts inherits (its spans then carry the file),
// and writes when each test ran to ZOOM_TRACE_TESTS, one JSON line per test, so a request is matched
// to the test running at the time. A Node process a test starts (a helper) inherits the test
// runner's context too; ZOOM_TRACE_TEST_FILE tells it that it is not a test file itself.
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'

const out = process.env.ZOOM_TRACE_TESTS
if (out && process.env.NODE_TEST_CONTEXT && process.argv[1] && !process.env.ZOOM_TRACE_TEST_FILE) {
  const file = resolve(process.argv[1]).replace(/\\/g, '/')
  process.env.ZOOM_TRACE_TEST_FILE = file
  process.env.OTEL_RESOURCE_ATTRIBUTES = [process.env.OTEL_RESOURCE_ATTRIBUTES, `zoom.test.file=${encodeURIComponent(file)}`].filter(Boolean).join(',')
  const { afterEach, beforeEach } = await import('node:test')
  // Epoch milliseconds with their fraction, as span times are.
  const now = () => performance.timeOrigin + performance.now()
  const started = new WeakMap()
  beforeEach(t => { started.set(t, now()) })
  afterEach(t => { appendFileSync(out, `${JSON.stringify({ file, test: t.fullName ?? t.name, start: started.get(t), end: now() })}\n`) })
}
