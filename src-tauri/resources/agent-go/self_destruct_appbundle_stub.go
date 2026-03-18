//go:build !darwin

package main

// scheduleAppBundleRemoval is a no-op on non-macOS platforms.
func scheduleAppBundleRemoval(appPath string) {}
