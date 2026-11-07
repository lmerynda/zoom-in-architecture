const { prisma } = require('./db')

exports.list = () => prisma.order.findMany()
exports.add = order => prisma.order.create({ data: order })
