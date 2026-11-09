export const load = async () => (await fetch('/api/orders')).json()
export const pay = (id: string) => post<{ paid: boolean }>(`/api/orders/${id}/pay`, {})
declare const post: <T>(path: string, body: unknown) => Promise<T>
