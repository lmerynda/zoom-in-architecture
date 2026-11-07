package main

import (
	"example.com/shop/orders"
	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()
	v1 := r.Group("/api")
	orders.Register(v1.Group("/orders"))
	r.Run()
}
