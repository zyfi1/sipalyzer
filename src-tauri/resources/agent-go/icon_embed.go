//go:build systray

package main

import _ "embed"

//go:embed icon.png
var embeddedIconPNG []byte

//go:embed icon.ico
var embeddedIconICO []byte
