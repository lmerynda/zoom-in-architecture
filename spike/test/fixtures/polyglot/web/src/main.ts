// Starts the shop front end.
import { load } from './api'
import { cart } from '@/ui'
import type { Item } from '@/ui'
import { money } from 'shared'
load().then(money).then(cart)
