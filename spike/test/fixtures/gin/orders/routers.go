package orders

import "github.com/gin-gonic/gin"

func Register(router *gin.RouterGroup) {
	router.GET("", List)
	router.GET("/", List)
	router.POST("/:id/pay", Pay)
}

func List(c *gin.Context) {
	c.JSON(200, FindAll())
}
