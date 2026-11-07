const { Router } = require('express')
const orders = require('./orders.controller')

const api = Router()
  .use(orders)

module.exports = Router().use('/api', api)
