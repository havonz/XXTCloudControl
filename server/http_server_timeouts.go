package main

import "time"

const (
	httpServerReadHeaderTimeout = 10 * time.Second
	httpServerReadTimeout       = 5 * time.Minute
	httpServerWriteTimeout      = 10 * time.Minute
	httpServerIdleTimeout       = 2 * time.Minute
)
