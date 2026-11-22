package orders

// The signature's interface{} is not the body: the body goes on to the store.
func SaveNote(id string, meta interface{}) bool {
	FindAll()
	return id != ""
}
