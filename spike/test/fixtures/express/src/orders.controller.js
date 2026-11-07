const router = require('express').Router()
const service = require('./orders.service')

router.get(
  '/orders',
  async (req, res) => {
    res.json(await service.list())
  },
)

router.post('/orders', create)

async function create(req, res) {
  res.json(await service.add(req.body))
}

module.exports = router
