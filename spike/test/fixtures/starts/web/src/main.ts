// The status page.
import { listen } from './live'
const socket = new WebSocket('wss://jobs.example/live')
window.setInterval(() => refresh(), 30000)
listen(socket)
function refresh() {}
