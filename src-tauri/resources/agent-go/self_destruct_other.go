//go:build !windows

package main

// performSelfDestructWindows is a no-op on non-Windows (only called when GOOS == "windows").
func performSelfDestructWindows(exe string) {}
