// Package store keeps orders.
package store

import "database/sql"

// Store wraps the database.
type Store struct{ db *sql.DB }

func Open(path string) *Store {
	db, _ := sql.Open("sqlite", path)
	return &Store{db: db}
}
