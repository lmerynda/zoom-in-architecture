/** The cart shown on every page. */
import { load } from '../api'
export const cart = () => load().then(items => localStorage.setItem('cart', JSON.stringify(items)))
