package orders

import "database/sql"

var db, _ = sql.Open("sqlite", "shop.db")

func FindAll() []string {
	rows, _ := db.Query("select id from orders")
	defer rows.Close()
	return nil
}

func Charge(id string) bool {
	return id != ""
}
