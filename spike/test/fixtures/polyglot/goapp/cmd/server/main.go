// Command server serves the shop.
package main

import (
	"net/http"

	"example.com/shop/internal/store"
	"example.com/shop/internal/view"
)

func main() {
	s := store.Open("shop.db")
	http.HandleFunc("/orders", handler(s))
	_ = view.Assets + view.IndexTemplate
	http.ListenAndServe(":8080", nil)
}
