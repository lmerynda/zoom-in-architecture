// Live status from the server and the worker.
export function listen(socket: WebSocket) {
  socket.onmessage = e => console.log(e.data)
  window.addEventListener('message', e => console.log(e.data))
}
