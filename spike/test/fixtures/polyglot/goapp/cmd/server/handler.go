package main

import (
	"net/http"

	"example.com/shop/internal/store"
)

func handler(s *store.Store) http.HandlerFunc { return nil }
