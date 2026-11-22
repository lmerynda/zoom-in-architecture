package orders

import "github.com/gin-gonic/gin"

func Pay(c *gin.Context) {
	c.JSON(200, Charge(c.Param("id")))
}

func Note(c *gin.Context) {
	c.JSON(200, SaveNote(c.Param("id"), nil))
}
