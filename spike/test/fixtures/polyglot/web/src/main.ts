// Starts the shop front end.
import { load } from './api'
import { money } from 'shared'
load().then(money)
