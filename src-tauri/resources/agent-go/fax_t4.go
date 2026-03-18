package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"time"
)

// T.4 Modified Huffman (MH) encoding for a test fax page.
// Standard resolution: 1728 pixels/line at 203 dpi, 98 lines/inch
// Fine resolution: 1728 pixels/line at 203 dpi, 196 lines/inch

const (
	lineWidth    = 1728 // A4 width in pixels at standard resolution
	stdLinesInch = 98   // standard resolution lines per inch
	pageHeightIn = 11   // US Letter height in inches
)

// generateT4TestPage creates a T.4 MH encoded test page.
// The page is a professional SIPalyzer test pattern.
func generateT4TestPage() []byte {
	return generateT4TestPageWithSettings(FaxSettings{
		BaudRate:   9600,
		Resolution: "standard",
		StationID:  "SIPalyzer",
	})
}

// generateT4TestPageWithSettings creates a T.4 test page incorporating the fax settings.
func generateT4TestPageWithSettings(settings FaxSettings) []byte {
	lpi := stdLinesInch
	if settings.Resolution == "fine" {
		lpi = stdLinesInch * 2
	}
	numLines := lpi * 6 // ~6 inches of page content

	bitmap := renderTestPageBitmap(settings, lineWidth, numLines)
	return encodeT4(bitmap, lineWidth, numLines)
}

// renderTestPageBitmap creates a 1-bit bitmap of the test page.
// Returns a flat []byte where 1=black, 0=white.
func renderTestPageBitmap(settings FaxSettings, width, height int) []byte {
	bmp := make([]byte, width*height)

	lpi := stdLinesInch
	if settings.Resolution == "fine" {
		lpi = stdLinesInch * 2
	}

	// All dimensions in scan lines
	margin := lpi / 4           // ~0.25 inch
	headerHeight := lpi * 3 / 8 // ~0.375 inch
	titleHeight := lpi * 3 / 4  // ~0.75 inch
	barHeight := lpi / 8        // ~0.125 inch
	infoHeight := lpi * 3 / 8
	patternHeight := lpi / 2    // ~0.5 inch

	y := 0

	// ── Top margin ──
	y += margin

	// ── Full-width top rule (2px thick) ──
	for dy := 0; dy < 2; dy++ {
		if y+dy < height {
			for x := 80; x < width-80; x++ {
				bmp[(y+dy)*width+x] = 1
			}
		}
	}
	y += 4

	// ── Header line: station ID + date ──
	dateStr := time.Now().Format("2006-01-02 15:04:05")
	headerLeft := settings.StationID
	headerRight := dateStr
	drawTextLine(bmp, width, y, 100, headerLeft, 1)
	rightX := width - 100 - len(headerRight)*8
	if rightX < 0 {
		rightX = 100
	}
	drawTextLine(bmp, width, y, rightX, headerRight, 1)
	y += headerHeight

	// ── Title: "SIPALYZER FAX TEST" in large block letters ──
	titleText := "SIPALYZER"
	subtitleText := "FAX TEST PAGE"
	drawLargeText(bmp, width, y, titleText, 3)
	y += titleHeight / 2
	drawLargeText(bmp, width, y, subtitleText, 2)
	y += titleHeight/2 + margin/2

	// ── Separator bar ──
	for dy := 0; dy < barHeight/2; dy++ {
		if y+dy < height {
			for x := 80; x < width-80; x++ {
				bmp[(y+dy)*width+x] = 1
			}
		}
	}
	y += barHeight

	// ── Settings info ──
	resLabel := "Standard (98 lpi)"
	if settings.Resolution == "fine" {
		resLabel = "Fine (196 lpi)"
	}
	ecmLabel := "Off"
	if settings.ECM {
		ecmLabel = "On"
	}
	line1 := fmt.Sprintf("Baud: %d bps   Resolution: %s   ECM: %s", settings.BaudRate, resLabel, ecmLabel)
	drawTextLine(bmp, width, y, 100, line1, 1)
	y += infoHeight / 2
	line2 := fmt.Sprintf("Station ID: %s   Page: 1 of 1", settings.StationID)
	drawTextLine(bmp, width, y, 100, line2, 1)
	y += infoHeight

	// ── Thin separator ──
	if y < height {
		for x := 80; x < width-80; x++ {
			bmp[y*width+x] = 1
		}
	}
	y += margin / 2

	// ── Test pattern 1: Horizontal bars of varying width ──
	drawTextLine(bmp, width, y, 100, "HORIZONTAL BAR TEST", 1)
	y += lpi / 4
	barWidths := []int{1, 2, 4, 8, 16}
	for _, bw := range barWidths {
		for dy := 0; dy < bw && y+dy < height; dy++ {
			for x := 100; x < width-100; x++ {
				bmp[(y+dy)*width+x] = 1
			}
		}
		y += bw * 2
		if bw < 4 {
			y += 2
		}
	}
	y += margin / 2

	// ── Test pattern 2: Alternating vertical bars ──
	drawTextLine(bmp, width, y, 100, "VERTICAL BAR TEST", 1)
	y += lpi / 4
	for dy := 0; dy < patternHeight && y+dy < height; dy++ {
		for x := 100; x < width-100; x++ {
			barPeriod := 2 + (x-100)*30/(width-200)
			if barPeriod < 2 {
				barPeriod = 2
			}
			if (x-100)%barPeriod < barPeriod/2 {
				bmp[(y+dy)*width+x] = 1
			}
		}
	}
	y += patternHeight + margin/2

	// ── Test pattern 3: Checkerboard ──
	drawTextLine(bmp, width, y, 100, "CHECKERBOARD", 1)
	y += lpi / 4
	checkSize := 8
	for dy := 0; dy < patternHeight/2 && y+dy < height; dy++ {
		for x := 100; x < width-100; x++ {
			cx := (x - 100) / checkSize
			cy := dy / checkSize
			if (cx+cy)%2 == 0 {
				bmp[(y+dy)*width+x] = 1
			}
		}
	}
	y += patternHeight/2 + margin/2

	// ── Test pattern 4: Diagonal lines ──
	drawTextLine(bmp, width, y, 100, "DIAGONAL", 1)
	y += lpi / 4
	for dy := 0; dy < patternHeight/2 && y+dy < height; dy++ {
		for x := 100; x < width-100; x++ {
			if (x+dy)%16 < 4 {
				bmp[(y+dy)*width+x] = 1
			}
		}
	}
	y += patternHeight/2 + margin/2

	// ── Bottom separator ──
	for dy := 0; dy < barHeight/2 && y+dy < height; dy++ {
		for x := 80; x < width-80; x++ {
			bmp[(y+dy)*width+x] = 1
		}
	}
	y += barHeight

	// ── Footer ──
	drawTextLine(bmp, width, y, 100, "End of test page - SIPalyzer (sipalyzer.com)", 1)

	return bmp
}

// drawTextLine draws a line of text using a simple 5x7 font at the given scale.
func drawTextLine(bmp []byte, bmpWidth, y, x int, text string, scale int) {
	for _, ch := range text {
		for row := 0; row < 7; row++ {
			bits := getCharRow(byte(ch), row)
			for col := 4; col >= 0; col-- {
				if bits&(1<<col) != 0 {
					for sy := 0; sy < scale; sy++ {
						for sx := 0; sx < scale; sx++ {
							px := x + sx
							py := y + row*scale + sy
							if px >= 0 && px < bmpWidth && py >= 0 && py < len(bmp)/bmpWidth {
								bmp[py*bmpWidth+px] = 1
							}
						}
					}
				}
				x += scale
			}
		}
		x -= 5 * scale // undo column advance from inner loop
		x += 6 * scale // character width + 1px gap
	}
}

// drawLargeText draws centered large text.
func drawLargeText(bmp []byte, bmpWidth, y int, text string, scale int) {
	textWidth := len(text) * 6 * scale
	x := (bmpWidth - textWidth) / 2
	drawTextLine(bmp, bmpWidth, y, x, text, scale)
}

// GenerateTestPagePreview creates a small PNG preview of the test page.
// Returns base64-encoded PNG data.
func GenerateTestPagePreview(settings FaxSettings) string {
	// Render at reduced resolution for preview
	previewWidth := 432  // 1728/4
	previewLines := 280
	bmp := renderTestPageBitmap(settings, lineWidth, previewLines*4)

	img := image.NewGray(image.Rect(0, 0, previewWidth, previewLines))

	// Downsample 4:1
	for py := 0; py < previewLines; py++ {
		for px := 0; px < previewWidth; px++ {
			// Average a 4x4 block
			sum := 0
			for dy := 0; dy < 4; dy++ {
				for dx := 0; dx < 4; dx++ {
					srcX := px*4 + dx
					srcY := py*4 + dy
					if srcY < len(bmp)/lineWidth && srcX < lineWidth {
						sum += int(bmp[srcY*lineWidth+srcX])
					}
				}
			}
			// Convert: 0 black pixels = white (255), 16 = black (0)
			gray := 255 - (sum * 255 / 16)
			if gray < 0 {
				gray = 0
			}
			img.SetGray(px, py, color.Gray{Y: uint8(gray)})
		}
	}

	var buf bytes.Buffer
	png.Encode(&buf, img)
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

// ─── T.4 MH Encoding ────────────────────────────────────────────────────────

func encodeT4(bitmap []byte, width, height int) []byte {
	var encoded []byte
	var bits bitWriter

	for line := 0; line < height; line++ {
		// EOL code (11 zero bits + 1)
		bits.writeBits(&encoded, 0x001, 12)

		// Build runs from bitmap
		lineStart := line * width
		if lineStart >= len(bitmap) {
			break
		}

		isWhite := true
		runLen := 0
		for x := 0; x < width; x++ {
			idx := lineStart + x
			pixBlack := idx < len(bitmap) && bitmap[idx] != 0
			if pixBlack == isWhite {
				encodeRunLength(&bits, &encoded, runLen, isWhite)
				isWhite = !isWhite
				runLen = 1
			} else {
				runLen++
			}
		}
		encodeRunLength(&bits, &encoded, runLen, isWhite)
	}

	// RTC: 6 consecutive EOL codes
	for i := 0; i < 6; i++ {
		bits.writeBits(&encoded, 0x001, 12)
	}

	bits.flush(&encoded)
	return encoded
}

type run struct {
	white  bool
	length int
}

// getCharRow returns a 5-bit pattern for a character at a given row (0-6).
func getCharRow(ch byte, row int) byte {
	font := map[byte][7]byte{
		'A': {0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11},
		'B': {0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E},
		'C': {0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E},
		'D': {0x1E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1E},
		'E': {0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F},
		'F': {0x1F, 0x10, 0x1E, 0x10, 0x10, 0x10, 0x10},
		'G': {0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0E},
		'H': {0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11},
		'I': {0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E},
		'J': {0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C},
		'K': {0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11},
		'L': {0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F},
		'M': {0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11},
		'N': {0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11},
		'O': {0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E},
		'P': {0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10},
		'Q': {0x0E, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0D},
		'R': {0x1E, 0x11, 0x11, 0x1E, 0x14, 0x12, 0x11},
		'S': {0x0E, 0x11, 0x10, 0x0E, 0x01, 0x11, 0x0E},
		'T': {0x1F, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04},
		'U': {0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E},
		'V': {0x11, 0x11, 0x11, 0x11, 0x11, 0x0A, 0x04},
		'W': {0x11, 0x11, 0x11, 0x15, 0x15, 0x1B, 0x11},
		'X': {0x11, 0x11, 0x0A, 0x04, 0x0A, 0x11, 0x11},
		'Y': {0x11, 0x11, 0x0A, 0x04, 0x04, 0x04, 0x04},
		'Z': {0x1F, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1F},
		' ': {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00},
		'0': {0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E},
		'1': {0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E},
		'2': {0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F},
		'3': {0x0E, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0E},
		'4': {0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02},
		'5': {0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E},
		'6': {0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E},
		'7': {0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08},
		'8': {0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E},
		'9': {0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C},
		':': {0x00, 0x04, 0x04, 0x00, 0x04, 0x04, 0x00},
		'-': {0x00, 0x00, 0x00, 0x1F, 0x00, 0x00, 0x00},
		'.': {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04},
		'/': {0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10},
		'(': {0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02},
		')': {0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08},
		',': {0x00, 0x00, 0x00, 0x00, 0x04, 0x04, 0x08},
	}
	if rows, ok := font[ch]; ok && row >= 0 && row < 7 {
		return rows[row]
	}
	return 0
}

// ─── MH Huffman Encoding ────────────────────────────────────────────────────

func encodeRunLength(bits *bitWriter, buf *[]byte, length int, white bool) {
	colorIdx := 1 // black
	if white {
		colorIdx = 0
	}
	for length >= 1728 {
		bits.writeBits(buf, mhMakeup[colorIdx][1728], mhMakeupBits[colorIdx][1728])
		length -= 1728
	}
	for length >= 64 {
		makeup := (length / 64) * 64
		if makeup > 1728 {
			makeup = 1728
		}
		if code, ok := mhMakeup[colorIdx][makeup]; ok {
			bits.writeBits(buf, code, mhMakeupBits[colorIdx][makeup])
			length -= makeup
		} else {
			break
		}
	}
	if length >= 0 && length < 64 {
		if white {
			bits.writeBits(buf, whiteTermCodes[length], whiteTermBits[length])
		} else {
			bits.writeBits(buf, blackTermCodes[length], blackTermBits[length])
		}
	}
}

type bitWriter struct {
	current byte
	pos     int
}

func (w *bitWriter) writeBits(buf *[]byte, code uint32, numBits int) {
	for i := numBits - 1; i >= 0; i-- {
		bit := (code >> i) & 1
		w.current = (w.current << 1) | byte(bit)
		w.pos++
		if w.pos == 8 {
			*buf = append(*buf, w.current)
			w.current = 0
			w.pos = 0
		}
	}
}

func (w *bitWriter) flush(buf *[]byte) {
	if w.pos > 0 {
		w.current <<= (8 - w.pos)
		*buf = append(*buf, w.current)
		w.current = 0
		w.pos = 0
	}
}

// T.4 white terminating codes (0-63)
var whiteTermCodes = [64]uint32{
	0x35, 0x07, 0x07, 0x08, 0x0B, 0x0C, 0x0E, 0x0F,
	0x13, 0x14, 0x07, 0x08, 0x08, 0x03, 0x34, 0x35,
	0x2A, 0x2B, 0x27, 0x0C, 0x08, 0x17, 0x03, 0x04,
	0x28, 0x2B, 0x13, 0x24, 0x18, 0x02, 0x03, 0x1A,
	0x1B, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x28,
	0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x04, 0x05, 0x0A,
	0x0B, 0x52, 0x53, 0x54, 0x55, 0x24, 0x25, 0x58,
	0x59, 0x5A, 0x5B, 0x4A, 0x4B, 0x32, 0x33, 0x34,
}

var whiteTermBits = [64]int{
	8, 6, 4, 4, 4, 4, 4, 4,
	5, 5, 5, 5, 6, 6, 6, 6,
	6, 6, 7, 7, 7, 7, 7, 7,
	7, 7, 7, 7, 7, 8, 8, 8,
	8, 8, 8, 8, 8, 8, 8, 8,
	8, 8, 8, 8, 8, 8, 8, 8,
	8, 8, 8, 8, 8, 8, 8, 8,
	8, 8, 8, 8, 8, 8, 8, 8,
}

// T.4 black terminating codes (0-63)
var blackTermCodes = [64]uint32{
	0x37, 0x02, 0x03, 0x02, 0x03, 0x03, 0x02, 0x03,
	0x05, 0x04, 0x04, 0x05, 0x07, 0x04, 0x07, 0x18,
	0x17, 0x18, 0x08, 0x67, 0x68, 0x6C, 0x37, 0x28,
	0x17, 0x18, 0xCA, 0xCB, 0xCC, 0xCD, 0x68, 0x69,
	0x6A, 0x6B, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7,
	0x6C, 0x6D, 0xDA, 0xDB, 0x54, 0x55, 0x56, 0x57,
	0x64, 0x65, 0x52, 0x53, 0x24, 0x37, 0x38, 0x27,
	0x28, 0x58, 0x59, 0x2B, 0x2C, 0x5A, 0x66, 0x67,
}

var blackTermBits = [64]int{
	10, 3, 2, 3, 3, 4, 4, 5,
	6, 6, 7, 7, 7, 8, 8, 9,
	10, 10, 10, 11, 11, 11, 11, 11,
	11, 11, 12, 12, 12, 12, 12, 12,
	12, 12, 12, 12, 12, 12, 12, 12,
	12, 12, 12, 12, 12, 12, 12, 12,
	12, 12, 12, 12, 12, 12, 12, 12,
	12, 12, 12, 12, 12, 12, 12, 12,
}

// MH makeup codes
var mhMakeup = [2]map[int]uint32{
	{
		64: 0x1B, 128: 0x12, 192: 0x17, 256: 0x37, 320: 0x36, 384: 0x37,
		448: 0x64, 512: 0x65, 576: 0x68, 640: 0x67, 704: 0xCC, 768: 0xCD,
		832: 0xD2, 896: 0xD3, 960: 0xD4, 1024: 0xD5, 1088: 0xD6, 1152: 0xD7,
		1216: 0xD8, 1280: 0xD9, 1344: 0xDA, 1408: 0xDB, 1472: 0x98, 1536: 0x99,
		1600: 0x9A, 1664: 0x18, 1728: 0x9B,
	},
	{
		64: 0x0F, 128: 0xC8, 192: 0xC9, 256: 0x5B, 320: 0x33, 384: 0x34,
		448: 0x35, 512: 0x6C, 576: 0x6D, 640: 0x4A, 704: 0x4B, 768: 0x4C,
		832: 0x4D, 896: 0x72, 960: 0x73, 1024: 0x74, 1088: 0x75, 1152: 0x76,
		1216: 0x77, 1280: 0x52, 1344: 0x53, 1408: 0x54, 1472: 0x55, 1536: 0x5A,
		1600: 0x5B, 1664: 0x64, 1728: 0x65,
	},
}

var mhMakeupBits = [2]map[int]int{
	{
		64: 5, 128: 5, 192: 6, 256: 7, 320: 7, 384: 8,
		448: 8, 512: 8, 576: 8, 640: 8, 704: 9, 768: 9,
		832: 9, 896: 9, 960: 9, 1024: 9, 1088: 9, 1152: 9,
		1216: 9, 1280: 9, 1344: 9, 1408: 9, 1472: 9, 1536: 9,
		1600: 9, 1664: 6, 1728: 9,
	},
	{
		64: 10, 128: 12, 192: 12, 256: 12, 320: 12, 384: 12,
		448: 12, 512: 13, 576: 13, 640: 13, 704: 13, 768: 13,
		832: 13, 896: 13, 960: 13, 1024: 13, 1088: 13, 1152: 13,
		1216: 13, 1280: 13, 1344: 13, 1408: 13, 1472: 13, 1536: 13,
		1600: 13, 1664: 13, 1728: 13,
	},
}
