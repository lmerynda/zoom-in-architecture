// Command sync copies jobs between regions.
package main

import "time"

func main() {
	t := time.NewTicker(time.Minute)
	defer t.Stop()
}
