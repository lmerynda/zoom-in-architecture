export const load = async () => (await fetch('/api/orders')).json()
