// Starts the shop front end.
import { load } from './api'
import { cart } from '@/ui/cart'
import { money } from 'shared'
load().then(money).then(cart)
