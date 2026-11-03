// Command server serves the shop.
package main

import (
	"net/http"

	"example.com/shop/internal/store"
)

func main() {
	s := store.Open("shop.db")
	http.HandleFunc("/orders", handler(s))
	http.ListenAndServe(":8080", nil)
}
