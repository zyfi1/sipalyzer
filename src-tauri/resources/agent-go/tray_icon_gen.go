//go:build systray

package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"math"
	"runtime"
)

var (
	dotColorConnected  = color.RGBA{52, 211, 153, 255}
	dotColorConnecting = color.RGBA{251, 191, 36, 255}
	dotColorDisconnect = color.RGBA{248, 113, 113, 255}
)

func statusDotColor(status string) color.RGBA {
	switch status {
	case "connected":
		return dotColorConnected
	case "connecting":
		return dotColorConnecting
	default:
		return dotColorDisconnect
	}
}

// makeTrayIcon decodes the embedded app icon PNG, scales it to the appropriate
// menu-bar size, and composites a small coloured status dot in the bottom-right
// corner.  The full-colour app icon is used on all platforms (many modern
// macOS apps like Slack, Discord etc. use coloured menu-bar icons).
func makeTrayIcon(status string) []byte {
	size := 22
	if runtime.GOOS == "darwin" {
		size = 44 // @2x retina
	} else if runtime.GOOS == "windows" {
		size = 32
	}

	src, err := png.Decode(bytes.NewReader(embeddedIconPNG))
	if err != nil {
		return fallbackDotIcon(size, statusDotColor(status))
	}

	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	scaleBilinear(dst, src)

	dotRadius := math.Max(float64(size)*0.18, 3)
	cx := float64(size) - dotRadius - 1
	cy := float64(size) - dotRadius - 1
	// White ring behind the dot for visibility against any icon colour.
	fillCircle(dst, cx, cy, dotRadius+1.5, color.RGBA{255, 255, 255, 255})
	fillCircle(dst, cx, cy, dotRadius, statusDotColor(status))

	var buf bytes.Buffer
	_ = png.Encode(&buf, dst)
	return buf.Bytes()
}

// fillCircle draws an anti-aliased filled circle at (cx, cy) with the given
// radius and colour, composited over any existing content.
func fillCircle(img *image.RGBA, cx, cy, r float64, c color.RGBA) {
	x0 := int(math.Floor(cx - r - 1))
	y0 := int(math.Floor(cy - r - 1))
	x1 := int(math.Ceil(cx + r + 1))
	y1 := int(math.Ceil(cy + r + 1))
	b := img.Bounds()
	for py := y0; py <= y1; py++ {
		if py < b.Min.Y || py >= b.Max.Y {
			continue
		}
		for px := x0; px <= x1; px++ {
			if px < b.Min.X || px >= b.Max.X {
				continue
			}
			dx := float64(px) + 0.5 - cx
			dy := float64(py) + 0.5 - cy
			dist := math.Sqrt(dx*dx + dy*dy)
			if dist > r+0.7 {
				continue
			}
			alpha := 1.0
			if dist > r-0.7 {
				alpha = (r + 0.7 - dist) / 1.4
			}
			sc := color.RGBA{c.R, c.G, c.B, uint8(float64(c.A) * alpha)}
			img.SetRGBA(px, py, blendOver(img.RGBAAt(px, py), sc))
		}
	}
}

// scaleBilinear does a simple bilinear resize from src into dst.
func scaleBilinear(dst *image.RGBA, src image.Image) {
	db := dst.Bounds()
	sb := src.Bounds()
	sw := float64(sb.Dx())
	sh := float64(sb.Dy())
	dw := float64(db.Dx())
	dh := float64(db.Dy())

	for dy := 0; dy < db.Dy(); dy++ {
		for dx := 0; dx < db.Dx(); dx++ {
			sx := (float64(dx)+0.5)*sw/dw - 0.5
			sy := (float64(dy)+0.5)*sh/dh - 0.5

			x0 := int(math.Floor(sx))
			y0 := int(math.Floor(sy))
			x1 := x0 + 1
			y1 := y0 + 1
			fx := sx - float64(x0)
			fy := sy - float64(y0)

			c00 := clampSample(src, x0, y0, sb)
			c10 := clampSample(src, x1, y0, sb)
			c01 := clampSample(src, x0, y1, sb)
			c11 := clampSample(src, x1, y1, sb)

			r := lerp(lerp(float64(c00.R), float64(c10.R), fx), lerp(float64(c01.R), float64(c11.R), fx), fy)
			g := lerp(lerp(float64(c00.G), float64(c10.G), fx), lerp(float64(c01.G), float64(c11.G), fx), fy)
			bv := lerp(lerp(float64(c00.B), float64(c10.B), fx), lerp(float64(c01.B), float64(c11.B), fx), fy)
			a := lerp(lerp(float64(c00.A), float64(c10.A), fx), lerp(float64(c01.A), float64(c11.A), fx), fy)

			dst.SetRGBA(dx+db.Min.X, dy+db.Min.Y, color.RGBA{
				R: uint8(math.Round(r)),
				G: uint8(math.Round(g)),
				B: uint8(math.Round(bv)),
				A: uint8(math.Round(a)),
			})
		}
	}
}

func clampSample(img image.Image, x, y int, b image.Rectangle) color.RGBA {
	if x < b.Min.X {
		x = b.Min.X
	} else if x >= b.Max.X {
		x = b.Max.X - 1
	}
	if y < b.Min.Y {
		y = b.Min.Y
	} else if y >= b.Max.Y {
		y = b.Max.Y - 1
	}
	r, g, bv, a := img.At(x, y).RGBA()
	return color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(bv >> 8), uint8(a >> 8)}
}

func lerp(a, b, t float64) float64 { return a + (b-a)*t }

func blendOver(dst, src color.RGBA) color.RGBA {
	sa := float64(src.A) / 255
	da := float64(dst.A) / 255
	oa := sa + da*(1-sa)
	if oa == 0 {
		return color.RGBA{}
	}
	return color.RGBA{
		R: uint8((float64(src.R)*sa + float64(dst.R)*da*(1-sa)) / oa),
		G: uint8((float64(src.G)*sa + float64(dst.G)*da*(1-sa)) / oa),
		B: uint8((float64(src.B)*sa + float64(dst.B)*da*(1-sa)) / oa),
		A: uint8(oa * 255),
	}
}

// fallbackDotIcon produces a simple coloured circle if the embedded icon can't
// be decoded.
func fallbackDotIcon(size int, c color.RGBA) []byte {
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	r := float64(size) / 2 * 0.7
	cx := float64(size) / 2
	cy := float64(size) / 2
	fillCircle(img, cx, cy, r, c)
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}
