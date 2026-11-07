package orders

import "github.com/gin-gonic/gin"

func Pay(c *gin.Context) {
	c.JSON(200, Charge(c.Param("id")))
}
