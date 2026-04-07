//! TIFF file handling for fax.
//!
//! SpanDSP requires TIFF files in a specific format for fax transmission.
//! This module handles conversion from common image formats to fax-compatible TIFF.
//!
//! ## Fax TIFF Requirements (ITU-T T.4 / T.6)
//! - 1-bit per pixel (black and white)
//! - 204 DPI horizontal (A4 width = 1728 pixels)
//! - 98 DPI vertical (standard) or 196 DPI vertical (fine)
//! - CCITT Group 3 (T.4 MH) or Group 4 (T.6 MMR) compression
//! - PhotometricInterpretation = 0 (WhiteIsZero)

use image::{DynamicImage, GenericImageView, GrayImage};
use std::path::Path;

/// Standard fax width in pixels at 204 DPI (A4 = 8.27 inches, Letter = 8.5 inches)
const FAX_WIDTH: u32 = 1728;

/// Standard resolution fax height (A4 at 98 DPI = ~1145 lines)
const FAX_HEIGHT_STANDARD: u32 = 1145;

/// Fine resolution fax height (A4 at 196 DPI = ~2290 lines)
const FAX_HEIGHT_FINE: u32 = 2290;

/// Fax resolution modes
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaxResolution {
    /// Standard resolution: 204 x 98 DPI
    Standard,
    /// Fine resolution: 204 x 196 DPI
    Fine,
}

impl Default for FaxResolution {
    fn default() -> Self {
        FaxResolution::Fine // Fine is better for text
    }
}

impl FaxResolution {
    fn y_dpi(&self) -> f32 {
        match self {
            FaxResolution::Standard => 98.0,
            FaxResolution::Fine => 196.0,
        }
    }

    fn page_height(&self) -> u32 {
        match self {
            FaxResolution::Standard => FAX_HEIGHT_STANDARD,
            FaxResolution::Fine => FAX_HEIGHT_FINE,
        }
    }
}

/// Convert an image file to fax-compatible TIFF format.
///
/// Supports PNG, JPEG, and existing TIFF files.
/// Output: 1-bit black and white, A4 width, no compression (SpanDSP handles T.4/T.6).
pub fn convert_to_fax_tiff(
    input_path: &str,
    output_path: &str,
    resolution: FaxResolution,
) -> Result<(), String> {
    let input = Path::new(input_path);

    if !input.exists() {
        return Err(format!("Input file not found: {}", input_path));
    }

    let extension = input
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();

    match extension.as_str() {
        "tiff" | "tif" => {
            // Check if already fax-compatible, otherwise convert
            convert_tiff_to_fax_tiff(input_path, output_path, resolution)
        }
        "png" | "jpg" | "jpeg" | "bmp" | "gif" | "webp" => {
            convert_image_to_fax_tiff(input_path, output_path, resolution)
        }
        "pdf" => {
            Err("PDF conversion not yet supported. Please convert to PNG/JPEG first.".to_string())
        }
        _ => Err(format!("Unsupported file format: .{}", extension)),
    }
}

/// Convert a TIFF file to fax-compatible format
fn convert_tiff_to_fax_tiff(
    input_path: &str,
    output_path: &str,
    resolution: FaxResolution,
) -> Result<(), String> {
    // Load and convert like any other image
    let img = image::open(input_path).map_err(|e| format!("Failed to open TIFF: {}", e))?;

    write_fax_tiff(&img, output_path, resolution)
}

/// Convert a raster image (PNG/JPEG) to fax-compatible TIFF
fn convert_image_to_fax_tiff(
    input_path: &str,
    output_path: &str,
    resolution: FaxResolution,
) -> Result<(), String> {
    let img = image::open(input_path).map_err(|e| format!("Failed to open image: {}", e))?;

    write_fax_tiff(&img, output_path, resolution)
}

/// Convert a DynamicImage to fax-compatible TIFF and write to disk.
/// Steps: grayscale -> resize to A4 width -> Floyd-Steinberg dither -> 1-bit TIFF
fn write_fax_tiff(
    img: &DynamicImage,
    output_path: &str,
    resolution: FaxResolution,
) -> Result<(), String> {
    let (src_w, src_h) = img.dimensions();

    // Calculate target dimensions maintaining aspect ratio
    let scale = FAX_WIDTH as f64 / src_w as f64;
    let target_h = (src_h as f64 * scale).round() as u32;
    let target_h = target_h.min(resolution.page_height());

    // Resize to A4 width
    let resized = img.resize_exact(FAX_WIDTH, target_h, image::imageops::FilterType::Lanczos3);
    let gray = resized.to_luma8();

    // Apply Floyd-Steinberg dithering for 1-bit conversion
    let bitmap = floyd_steinberg_dither(&gray);

    // Write as uncompressed 1-bit TIFF (SpanDSP applies its own T.4/T.6 compression)
    write_1bit_tiff(output_path, &bitmap, FAX_WIDTH, target_h, resolution)
}

/// Floyd-Steinberg dithering: convert grayscale to 1-bit with good quality
fn floyd_steinberg_dither(gray: &GrayImage) -> Vec<u8> {
    let (w, h) = gray.dimensions();
    let mut errors = vec![0.0f32; (w * h) as usize];

    // Initialize with pixel values
    for y in 0..h {
        for x in 0..w {
            let idx = (y * w + x) as usize;
            errors[idx] = gray.get_pixel(x, y)[0] as f32;
        }
    }

    // Packed 1-bit output: 0 = white, 1 = black (fax convention: WhiteIsZero)
    let bytes_per_row = ((w + 7) / 8) as usize;
    let mut bitmap = vec![0u8; bytes_per_row * h as usize];

    for y in 0..h {
        for x in 0..w {
            let idx = (y * w + x) as usize;
            let old_pixel = errors[idx].clamp(0.0, 255.0);

            // Threshold: < 128 -> black (1), >= 128 -> white (0)
            let new_pixel = if old_pixel < 128.0 { 0.0 } else { 255.0 };
            let error = old_pixel - new_pixel;

            // Set bit (1 = black in WhiteIsZero)
            if new_pixel == 0.0 {
                let byte_idx = y as usize * bytes_per_row + (x / 8) as usize;
                let bit_idx = 7 - (x % 8);
                bitmap[byte_idx] |= 1 << bit_idx;
            }

            // Distribute error to neighbors
            if x + 1 < w {
                errors[idx + 1] += error * 7.0 / 16.0;
            }
            if y + 1 < h {
                if x > 0 {
                    errors[idx + w as usize - 1] += error * 3.0 / 16.0;
                }
                errors[idx + w as usize] += error * 5.0 / 16.0;
                if x + 1 < w {
                    errors[idx + w as usize + 1] += error * 1.0 / 16.0;
                }
            }
        }
    }

    bitmap
}

/// Write a 1-bit TIFF file (uncompressed, suitable for SpanDSP)
fn write_1bit_tiff(
    path: &str,
    bitmap: &[u8],
    width: u32,
    height: u32,
    resolution: FaxResolution,
) -> Result<(), String> {
    let bytes_per_row = ((width + 7) / 8) as usize;
    let image_data_size = bytes_per_row * height as usize;

    if bitmap.len() < image_data_size {
        return Err(format!(
            "Bitmap too small: {} < {}",
            bitmap.len(),
            image_data_size
        ));
    }

    let mut tiff = Vec::with_capacity(512 + image_data_size);

    // TIFF Header (little-endian)
    tiff.extend_from_slice(b"II");
    tiff.extend_from_slice(&42u16.to_le_bytes());
    tiff.extend_from_slice(&8u32.to_le_bytes()); // IFD offset

    // IFD
    let num_entries: u16 = 12;
    tiff.extend_from_slice(&num_entries.to_le_bytes());

    let ifd_size = 2 + num_entries as u32 * 12 + 4;
    let values_offset = 8 + ifd_size;
    let strip_offset = values_offset + 16; // 16 bytes for resolution rationals

    // IFD Entries
    write_ifd_entry(&mut tiff, 256, 3, 1, width); // ImageWidth
    write_ifd_entry(&mut tiff, 257, 3, 1, height); // ImageLength
    write_ifd_entry(&mut tiff, 258, 3, 1, 1); // BitsPerSample
    write_ifd_entry(&mut tiff, 259, 3, 1, 1); // Compression (1=None)
    write_ifd_entry(&mut tiff, 262, 3, 1, 0); // PhotometricInterpretation (WhiteIsZero)
    write_ifd_entry(&mut tiff, 273, 4, 1, strip_offset); // StripOffsets
    write_ifd_entry(&mut tiff, 277, 3, 1, 1); // SamplesPerPixel
    write_ifd_entry(&mut tiff, 278, 3, 1, height); // RowsPerStrip
    write_ifd_entry(&mut tiff, 279, 4, 1, image_data_size as u32); // StripByteCounts
    write_ifd_entry(&mut tiff, 282, 5, 1, values_offset); // XResolution
    write_ifd_entry(&mut tiff, 283, 5, 1, values_offset + 8); // YResolution
    write_ifd_entry(&mut tiff, 296, 3, 1, 2); // ResolutionUnit (inches)

    // Next IFD (0 = none)
    tiff.extend_from_slice(&0u32.to_le_bytes());

    // Resolution rational values
    tiff.extend_from_slice(&204u32.to_le_bytes()); // XResolution num
    tiff.extend_from_slice(&1u32.to_le_bytes()); // XResolution den
    let y_res = resolution.y_dpi() as u32;
    tiff.extend_from_slice(&y_res.to_le_bytes()); // YResolution num
    tiff.extend_from_slice(&1u32.to_le_bytes()); // YResolution den

    // Pad to strip offset
    while tiff.len() < strip_offset as usize {
        tiff.push(0);
    }

    // Image data
    tiff.extend_from_slice(&bitmap[..image_data_size]);

    std::fs::write(path, &tiff).map_err(|e| format!("Failed to write TIFF: {}", e))?;

    Ok(())
}

/// Combine multiple single-page TIFFs (produced by `write_1bit_tiff`) into one multi-page TIFF.
///
/// This works by rewriting IFD next-pointers so each page's IFD chains to the next.
/// Assumes each input TIFF is little-endian and produced by our `write_1bit_tiff`.
pub fn combine_single_page_tiffs(pages: &[&[u8]]) -> Result<Vec<u8>, String> {
    if pages.is_empty() {
        return Err("No pages to combine".to_string());
    }
    if pages.len() == 1 {
        return Ok(pages[0].to_vec());
    }

    let mut output = Vec::new();

    // Write TIFF header from first page (first 8 bytes: byte order + magic + IFD offset)
    // But we need to adjust IFD offsets for all pages after the first.
    // Strategy: concatenate all page data, adjusting IFD offsets.

    // First page goes in verbatim (almost — we patch its next-IFD pointer)
    output.extend_from_slice(pages[0]);

    for (i, page) in pages.iter().enumerate().skip(1) {
        // The current page starts at this offset in the output
        let page_start = output.len() as u32;

        // Skip the 8-byte TIFF header of this page
        if page.len() < 8 {
            return Err(format!("Page {} too small", i + 1));
        }
        let page_ifd_offset = u32::from_le_bytes([page[4], page[5], page[6], page[7]]);
        let adjusted_ifd_offset = page_start + page_ifd_offset - 8;

        // Patch previous page's "next IFD" pointer to point to this page's IFD
        // Find the previous page's IFD: read its "next IFD" location
        // In our format, the IFD starts at offset 8, num_entries is first 2 bytes,
        // then num_entries * 12 bytes of entries, then 4 bytes of next-IFD pointer.
        let prev_page_start = if i == 1 {
            0u32
        } else {
            // We need to track where previous pages started.
            // For simplicity, find the next-IFD pointer location by walking the IFD.
            // Actually, for our specific TIFF format (12 entries), the next-IFD is at:
            // header(8) + num_entries(2) + 12*num_entries + 0 bytes = offset to next-IFD pointer
            // But pages after the first start at different offsets.
            // Let's just track it.
            0 // Will be overridden below
        };
        let _ = prev_page_start;

        // Append page data (skip 8-byte header)
        output.extend_from_slice(&page[8..]);

        // Now fix the next-IFD pointer of the previous page to point to adjusted_ifd_offset
        // We need to find where that pointer is. For the first page, it's at the known location.
        // For subsequent pages, we track it.
        //
        // The next-IFD pointer is right after the IFD entries.
        // IFD structure: [num_entries: u16] [entries: num_entries * 12 bytes] [next_ifd: u32]
        //
        // For page i-1, find its IFD start in output, read num_entries, then jump to next_ifd location.
        let prev_ifd_start = if i == 1 {
            8usize // first page IFD is at offset 8
        } else {
            // The previous page's IFD offset was patched to point to its adjusted location
            // We stored it... actually let me just walk through pages[i-1]
            // The IFD offset for the "previous page in the output" can be found by:
            // - For page 0: offset 8
            // - For page j>0: the adjusted_ifd_offset we computed when we added page j
            // We need to track these. Let me restructure.
            // For now, use a simpler approach: walk the IFD chain from the start.
            let mut ifd_off =
                u32::from_le_bytes([output[4], output[5], output[6], output[7]]) as usize;
            for _ in 0..i - 1 {
                if ifd_off + 2 > output.len() {
                    break;
                }
                let n = u16::from_le_bytes([output[ifd_off], output[ifd_off + 1]]) as usize;
                let next_ptr_off = ifd_off + 2 + n * 12;
                if next_ptr_off + 4 > output.len() {
                    break;
                }
                ifd_off = u32::from_le_bytes([
                    output[next_ptr_off],
                    output[next_ptr_off + 1],
                    output[next_ptr_off + 2],
                    output[next_ptr_off + 3],
                ]) as usize;
            }
            ifd_off
        };

        // Read num_entries at prev_ifd_start
        if prev_ifd_start + 2 > output.len() {
            return Err("IFD parsing error".to_string());
        }
        let num_entries =
            u16::from_le_bytes([output[prev_ifd_start], output[prev_ifd_start + 1]]) as usize;
        let next_ifd_ptr_offset = prev_ifd_start + 2 + num_entries * 12;
        if next_ifd_ptr_offset + 4 > output.len() {
            return Err("IFD next pointer out of bounds".to_string());
        }

        // Patch next-IFD pointer to point to the new page's IFD
        let bytes = adjusted_ifd_offset.to_le_bytes();
        output[next_ifd_ptr_offset] = bytes[0];
        output[next_ifd_ptr_offset + 1] = bytes[1];
        output[next_ifd_ptr_offset + 2] = bytes[2];
        output[next_ifd_ptr_offset + 3] = bytes[3];

        // Also need to adjust the strip offset and resolution pointers in the new page's IFD
        // since they were relative to the original file.
        // Walk the new page's IFD entries and add page_start - 8 to offset-type values.
        let delta = page_start as i64 - 8;
        let new_ifd_start = adjusted_ifd_offset as usize;
        if new_ifd_start + 2 > output.len() {
            return Err("New IFD out of bounds".to_string());
        }
        let new_num_entries =
            u16::from_le_bytes([output[new_ifd_start], output[new_ifd_start + 1]]) as usize;

        for e in 0..new_num_entries {
            let entry_off = new_ifd_start + 2 + e * 12;
            if entry_off + 12 > output.len() {
                break;
            }
            let tag = u16::from_le_bytes([output[entry_off], output[entry_off + 1]]);
            let typ = u16::from_le_bytes([output[entry_off + 2], output[entry_off + 3]]);

            // Tags with offset values that need adjustment:
            // 273 = StripOffsets (LONG), 282 = XResolution (RATIONAL offset), 283 = YResolution (RATIONAL offset)
            match tag {
                273 | 282 | 283 => {
                    // These store a LONG or offset value
                    let val_off = entry_off + 8;
                    let old_val = u32::from_le_bytes([
                        output[val_off],
                        output[val_off + 1],
                        output[val_off + 2],
                        output[val_off + 3],
                    ]);
                    let new_val = (old_val as i64 + delta) as u32;
                    let bytes = new_val.to_le_bytes();
                    output[val_off] = bytes[0];
                    output[val_off + 1] = bytes[1];
                    output[val_off + 2] = bytes[2];
                    output[val_off + 3] = bytes[3];
                }
                _ => {
                    // For type=5 (RATIONAL) with count > inline, also adjust, but our
                    // standard IFD entries use inline values for most tags.
                    // StripByteCounts (279) is inline, no adjustment needed.
                    if typ == 5 {
                        // RATIONAL type values are always offsets (8 bytes each)
                        // but we already handle 282/283 above
                    }
                }
            }
        }
    }

    Ok(output)
}

/// Write an IFD entry (12 bytes)
fn write_ifd_entry(tiff: &mut Vec<u8>, tag: u16, typ: u16, count: u32, value: u32) {
    tiff.extend_from_slice(&tag.to_le_bytes());
    tiff.extend_from_slice(&typ.to_le_bytes());
    tiff.extend_from_slice(&count.to_le_bytes());
    tiff.extend_from_slice(&value.to_le_bytes());
}

// ─── Bitmap drawing helpers ────────────────────────────────────────────
// These are used by the test page generators.

struct Bitmap {
    data: Vec<u8>,
    width: u32,
    height: u32,
    bytes_per_row: usize,
}

impl Bitmap {
    fn new(width: u32, height: u32) -> Self {
        let bytes_per_row = ((width + 7) / 8) as usize;
        Self {
            data: vec![0u8; bytes_per_row * height as usize],
            width,
            height,
            bytes_per_row,
        }
    }

    fn set_pixel(&mut self, x: u32, y: u32) {
        if x < self.width && y < self.height {
            let byte_idx = y as usize * self.bytes_per_row + (x / 8) as usize;
            let bit_idx = 7 - (x % 8);
            self.data[byte_idx] |= 1 << bit_idx;
        }
    }

    fn hline(&mut self, y: u32, x1: u32, x2: u32) {
        for x in x1..=x2.min(self.width.saturating_sub(1)) {
            self.set_pixel(x, y);
        }
    }

    fn vline(&mut self, x: u32, y1: u32, y2: u32) {
        for y in y1..=y2.min(self.height.saturating_sub(1)) {
            self.set_pixel(x, y);
        }
    }

    fn fill_rect(&mut self, x1: u32, y1: u32, x2: u32, y2: u32) {
        for y in y1..=y2.min(self.height.saturating_sub(1)) {
            for x in x1..=x2.min(self.width.saturating_sub(1)) {
                self.set_pixel(x, y);
            }
        }
    }

    /// Draw text at given scale (1 = 5×7 pixels per glyph, 3 = 15×21, etc.)
    fn text(&mut self, x: u32, y: u32, s: &str, scale: u32) {
        let char_w = 5 * scale;
        let spacing = char_w + scale; // inter-character gap
        let mut cx = x;
        for ch in s.chars() {
            if let Some(glyph) = get_glyph(ch) {
                for (row_idx, row) in glyph.iter().enumerate() {
                    for col in 0..5u32 {
                        if (row >> (4 - col)) & 1 == 1 {
                            for dy in 0..scale {
                                for dx in 0..scale {
                                    self.set_pixel(
                                        cx + col * scale + dx,
                                        y + row_idx as u32 * scale + dy,
                                    );
                                }
                            }
                        }
                    }
                }
            }
            cx += spacing;
        }
    }

    /// Measure text width at given scale
    fn text_width(s: &str, scale: u32) -> u32 {
        let char_w = 5 * scale;
        let spacing = char_w + scale;
        let n = s.chars().count() as u32;
        if n == 0 {
            0
        } else {
            n * spacing - scale
        }
    }

    /// Draw a section header with a label and a thin rule underneath
    fn section_header(&mut self, y: u32, margin: u32, label: &str) {
        self.text(margin, y, label, 3);
        self.hline(y + 26, margin, self.width - margin - 1);
    }

    /// Draw ordered-dither grayscale band (level 0..255) in a rectangle
    fn dither_rect(&mut self, x1: u32, y1: u32, x2: u32, y2: u32, level: u8) {
        // 4×4 Bayer matrix
        const BAYER: [[u8; 4]; 4] = [
            [0, 128, 32, 160],
            [192, 64, 224, 96],
            [48, 176, 16, 144],
            [240, 112, 208, 80],
        ];
        for y in y1..=y2.min(self.height.saturating_sub(1)) {
            for x in x1..=x2.min(self.width.saturating_sub(1)) {
                let threshold = BAYER[(y % 4) as usize][(x % 4) as usize];
                if level > threshold {
                    self.set_pixel(x, y);
                }
            }
        }
    }
}

/// Fax transmission settings embedded in the test page content.
#[derive(Clone, Debug)]
pub struct TestPageSettings {
    /// "T.38" or "G.711 u-law"
    pub protocol: String,
    /// Whether ECM is enabled
    pub ecm: bool,
    /// Baud rate in bps (e.g. 14400)
    pub baud_rate: u32,
    /// To number (e.g. "+15551234567")
    pub to: Option<String>,
}

impl Default for TestPageSettings {
    fn default() -> Self {
        Self {
            protocol: "T.38".to_string(),
            ecm: true,
            baud_rate: 14400,
            to: None,
        }
    }
}

/// Create the Quick Test page (page 1).
///
/// Industry-standard fax transmission test — professional layout with header,
/// transmission info, resolution bars, character clarity, grayscale wedge,
/// pattern tests, and modem reference. Matches the frontend preview.
pub fn create_test_page(
    output_path: &str,
    station_id: Option<&str>,
    resolution: FaxResolution,
    settings: Option<&TestPageSettings>,
) -> Result<(), String> {
    let w = FAX_WIDTH; // 1728
    let h = resolution.page_height();
    let mut bm = Bitmap::new(w, h);
    let m: u32 = 100; // margin

    let sid = station_id.unwrap_or("SIPALYZER FAX TEST PAGE");
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let defaults = TestPageSettings::default();
    let s = settings.unwrap_or(&defaults);
    let baud_label = if s.baud_rate >= 1000 {
        format!("{:.1}k bps", s.baud_rate as f64 / 1000.0)
    } else {
        format!("{} bps", s.baud_rate)
    };
    let codec_label = if s.protocol.contains("G.711") {
        "PCMU (u-law)"
    } else {
        "UDPTL / IFP"
    };

    // ── Header ──────────────────────────────────────────────────────
    let hy: u32 = 50;
    // Brand square
    bm.fill_rect(m, hy, m + 50, hy + 50);
    // Title "SIPALYZER" (scale 6 = ~30px tall)
    bm.text(m + 65, hy, "SIPALYZER", 6);
    // Subtitle (scale 3)
    bm.text(m + 65, hy + 50, "VIRTUAL FAX - TRANSMISSION TEST", 3);
    // Protocol badge on the right — shows the actual selected protocol
    let badge_text = &s.protocol;
    bm.text(
        w - m - Bitmap::text_width(badge_text, 3),
        hy + 12,
        badge_text,
        3,
    );
    // Thick divider under header
    bm.fill_rect(m, hy + 78, w - m - 1, hy + 81);

    // ── Transmission Info ────────────────────────────────────────────
    let mut cy = hy + 100;
    let label_w = 120u32;
    let col2_x = (w - 2 * m) / 2 + m;
    let to_display = s.to.as_deref().unwrap_or("—");
    let info: Vec<(u32, &str, &str)> = vec![
        (m, "DATE:", &timestamp),
        (col2_x, "TO:", to_display),
        (m, "PAGES:", "1 of 1"),
        (col2_x, "MODE:", &s.protocol),
        (m, "ECM:", if s.ecm { "Enabled" } else { "Disabled" }),
        (col2_x, "BAUD:", &baud_label),
        (m, "CODEC:", codec_label),
    ];
    for (i, (ix, label, value)) in info.iter().enumerate() {
        let row_y = cy + (i as u32 / 2) * 28;
        bm.text(*ix, row_y, label, 3);
        bm.text(*ix + label_w, row_y, value, 3);
    }
    cy += 28 * 4 + 15;

    // ── Resolution Bars ─────────────────────────────────────────────
    bm.section_header(cy, m, "RESOLUTION");
    cy += 35;
    let bar_start = m + 280;
    let bar_len: u32 = 600;
    let bar_h: u32 = 22;
    for &(label, bar_w) in &[
        ("3.85 LP/MM  FINE", 1u32),
        ("1.93 LP/MM  STANDARD", 2),
        ("0.96 LP/MM  COARSE", 4),
    ] {
        bm.text(m, cy + 3, label, 2);
        // Draw alternating bars
        for x in 0..bar_len {
            if (x / bar_w) % 2 == 0 {
                bm.vline(bar_start + x, cy, cy + bar_h);
            }
        }
        cy += bar_h + 12;
    }

    // ── Character Clarity ────────────────────────────────────────────
    cy += 10;
    bm.section_header(cy, m, "CHARACTER CLARITY");
    cy += 35;
    bm.text(m, cy, "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 5);
    cy += 48;
    bm.text(m, cy, "abcdefghijklmnopqrstuvwxyz", 4);
    cy += 38;
    bm.text(m, cy, "0123456789 !@#$%()-+=.,:;/?", 4);
    cy += 40;
    bm.text(m, cy, "The quick brown fox jumps over the lazy dog.", 3);
    cy += 30;
    bm.text(
        m,
        cy,
        "MINIMUM LEGIBILITY - IF YOU CAN READ THIS LINE, FINE DETAIL IS INTACT.",
        2,
    );
    cy += 28;

    // ── Grayscale Wedge ──────────────────────────────────────────────
    cy += 10;
    bm.section_header(cy, m, "GRAYSCALE");
    cy += 35;
    let band_count: u32 = 10;
    let band_w = (w - 2 * m) / band_count;
    let band_h: u32 = 50;
    let levels: [u8; 10] = [0, 28, 56, 84, 112, 140, 168, 196, 224, 255];
    for (i, &level) in levels.iter().enumerate() {
        let bx = m + i as u32 * band_w;
        bm.dither_rect(bx, cy, bx + band_w - 2, cy + band_h, level);
    }
    cy += band_h + 5;
    for (i, &level) in levels.iter().enumerate() {
        let bx = m + i as u32 * band_w;
        let label = format!("{}%", (level as u32 * 100) / 255);
        bm.text(bx + 4, cy, &label, 2);
    }

    // ── Pattern Tests ────────────────────────────────────────────────
    cy += 28;
    bm.section_header(cy, m, "PATTERN TESTS");
    cy += 35;
    let pat_size: u32 = 60;
    let mut px = m;

    // 2×2
    bm.text(px, cy - 3, "2X2", 2);
    for py in 0..pat_size {
        for ppx in 0..pat_size {
            if ((ppx / 2) + (py / 2)) % 2 == 0 {
                bm.set_pixel(px + 50 + ppx, cy + py);
            }
        }
    }
    px += 140;

    // 4×4
    bm.text(px, cy - 3, "4X4", 2);
    for py in 0..pat_size {
        for ppx in 0..pat_size {
            if ((ppx / 4) + (py / 4)) % 2 == 0 {
                bm.set_pixel(px + 50 + ppx, cy + py);
            }
        }
    }
    px += 140;

    // 8×8
    bm.text(px, cy - 3, "8X8", 2);
    for py in 0..pat_size {
        for ppx in 0..pat_size {
            if ((ppx / 8) + (py / 8)) % 2 == 0 {
                bm.set_pixel(px + 50 + ppx, cy + py);
            }
        }
    }
    px += 140;

    // Diagonal
    bm.text(px, cy - 3, "DIAG", 2);
    for i in 0..pat_size {
        bm.set_pixel(px + 50 + i, cy + i);
        bm.set_pixel(px + 50 + i, cy + pat_size - 1 - i);
    }
    px += 140;

    // Radial (concentric circles approximation)
    bm.text(px, cy - 3, "RADIAL", 2);
    let cx_r = px + 50 + pat_size / 2;
    let cy_r = cy + pat_size / 2;
    for radius in [28u32, 22, 16, 10, 5] {
        // Bresenham circle
        let mut x: i32 = radius as i32;
        let mut y: i32 = 0;
        let mut err: i32 = 1 - x;
        while x >= y {
            for &(dx, dy) in &[
                (x, y),
                (y, x),
                (-x, y),
                (-y, x),
                (-x, -y),
                (-y, -x),
                (x, -y),
                (y, -x),
            ] {
                let px2 = cx_r as i32 + dx;
                let py2 = cy_r as i32 + dy;
                if px2 >= 0 && py2 >= 0 {
                    bm.set_pixel(px2 as u32, py2 as u32);
                }
            }
            y += 1;
            if err < 0 {
                err += 2 * y + 1;
            } else {
                x -= 1;
                err += 2 * (y - x) + 1;
            }
        }
    }
    // Cross through center
    bm.hline(cy_r, cx_r.saturating_sub(pat_size / 2), cx_r + pat_size / 2);
    bm.vline(cx_r, cy.saturating_sub(0), cy + pat_size);

    // ── Modem Reference ──────────────────────────────────────────────
    cy += pat_size + 30;
    bm.hline(cy, m, w - m - 1);
    cy += 12;
    let modems = [
        ("V.27TER", "4,800 bps"),
        ("V.29", "9,600 bps"),
        ("V.17", "14,400 bps"),
        ("V.34", "33,600 bps"),
    ];
    let modem_spacing = (w - 2 * m) / modems.len() as u32;
    for (i, (modem, speed)) in modems.iter().enumerate() {
        let mx = m + i as u32 * modem_spacing;
        bm.text(mx, cy, modem, 3);
        bm.text(mx + Bitmap::text_width(modem, 3) + 10, cy, speed, 2);
    }

    // ── Footer ───────────────────────────────────────────────────────
    let fy = h - 50;
    bm.fill_rect(m, fy - 5, w - m - 1, fy - 3); // thick rule
    bm.text(m, fy, "T.4 MH/MR  T.6 MMR  ITU-T T.30  204X196 DPI", 2);
    let footer_right = "SIPALYZER VIRTUAL FAX";
    let fr_w = Bitmap::text_width(footer_right, 3);
    bm.text(w - m - fr_w, fy, footer_right, 3);

    // Station ID centered above footer
    let sid_w = Bitmap::text_width(sid, 2);
    bm.text((w - sid_w) / 2, fy - 30, sid, 2);

    write_1bit_tiff(output_path, &bm.data, w, h, resolution)
}

/// Create a diagnostic page (page 2) — line quality & fill patterns.
pub fn create_diagnostic_page(output_path: &str, resolution: FaxResolution) -> Result<(), String> {
    let w = FAX_WIDTH;
    let h = resolution.page_height();
    let mut bm = Bitmap::new(w, h);
    let m: u32 = 100;
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // ── Page border ──
    bm.hline(0, 0, w - 1);
    bm.hline(h - 1, 0, w - 1);
    bm.vline(0, 0, h - 1);
    bm.vline(w - 1, 0, h - 1);

    // ── Header ──
    let hy: u32 = 30;
    bm.fill_rect(m, hy, m + 40, hy + 40);
    bm.text(m + 55, hy, "SIPALYZER LINE QUALITY", 5);
    bm.text(m + 55, hy + 42, &format!("PAGE 2  {}", timestamp), 3);

    let div_y = hy + 70;
    bm.fill_rect(m, div_y, w - m - 1, div_y + 2);

    // ── Fill Density ──
    let mut cy = div_y + 20;
    bm.section_header(cy, m, "FILL DENSITY");
    cy += 35;

    let densities: [u8; 8] = [13, 31, 64, 102, 140, 179, 217, 250];
    let labels = ["5%", "12%", "25%", "40%", "55%", "70%", "85%", "98%"];
    let band_w = (w - 2 * m) / 8;
    let band_h: u32 = 80;
    for (i, (&level, &label)) in densities.iter().zip(labels.iter()).enumerate() {
        let bx = m + i as u32 * band_w;
        // Border
        bm.hline(cy, bx, bx + band_w - 3);
        bm.hline(cy + band_h, bx, bx + band_w - 3);
        bm.vline(bx, cy, cy + band_h);
        bm.vline(bx + band_w - 3, cy, cy + band_h);
        // Fill
        bm.dither_rect(bx + 1, cy + 1, bx + band_w - 4, cy + band_h - 1, level);
        // Label
        bm.text(bx + 8, cy + band_h + 8, label, 2);
    }

    // ── Scanline Fidelity (horizontal line pairs) ──
    cy += band_h + 40;
    bm.section_header(cy, m, "SCANLINE FIDELITY");
    cy += 35;

    for thickness in [1u32, 2, 3, 4] {
        // Label
        let label = format!("{}PX", thickness);
        bm.text(m, cy + 4, &label, 2);

        let bar_x = m + 100;
        let bar_end = w - m - 1;
        let mut y = cy;
        let num_pairs = 8;
        for _pair in 0..num_pairs {
            // Black bar
            for dy in 0..thickness {
                bm.hline(y + dy, bar_x, bar_end);
            }
            y += thickness;
            // White gap (just skip)
            y += thickness;
        }
        cy += thickness * num_pairs * 2 + 10;
    }

    // ── Checkerboard & Radial ──
    cy += 10;
    bm.section_header(cy, m, "CHECKERBOARD");
    cy += 35;

    let check_size: u32 = 120;
    // 4×4 checkerboard
    bm.text(m, cy - 3, "4X4", 2);
    for py in 0..check_size {
        for px in 0..check_size {
            if ((px / 4) + (py / 4)) % 2 == 0 {
                bm.set_pixel(m + 60 + px, cy + py);
            }
        }
    }

    // 8×8 checkerboard
    let off2 = 250;
    bm.text(m + off2, cy - 3, "8X8", 2);
    for py in 0..check_size {
        for px in 0..check_size {
            if ((px / 8) + (py / 8)) % 2 == 0 {
                bm.set_pixel(m + off2 + 60 + px, cy + py);
            }
        }
    }

    // Concentric rings (radial test)
    let ring_cx = m + 680;
    let ring_cy_center = cy + check_size / 2;
    bm.text(ring_cx - 60, cy - 3, "RADIAL", 2);
    let r_max = check_size / 2;
    for py in 0..check_size {
        for px in 0..check_size {
            let dx = px as i32 - r_max as i32;
            let dy = py as i32 - r_max as i32;
            let dist = ((dx * dx + dy * dy) as f64).sqrt() as u32;
            // Concentric rings every 8 pixels
            if dist < r_max && (dist / 8) % 2 == 0 {
                bm.set_pixel(ring_cx + px, cy + py);
            }
        }
    }
    // Crosshair
    bm.hline(ring_cy_center, ring_cx, ring_cx + check_size - 1);
    bm.vline(ring_cx + r_max, cy, cy + check_size - 1);

    // ── Vertical Resolution bars ──
    cy += check_size + 30;
    bm.section_header(cy, m, "VERTICAL RESOLUTION");
    cy += 35;
    let vbar_h: u32 = 80;
    let mut vx = m;
    for thickness in [1u32, 2, 3, 4, 6, 8] {
        let label = format!("{}PX", thickness);
        bm.text(vx, cy + vbar_h + 5, &label, 2);
        for _pair in 0..6 {
            // Black bar
            for dx in 0..thickness {
                bm.vline(vx + dx, cy, cy + vbar_h);
            }
            vx += thickness;
            // White gap
            vx += thickness;
        }
        vx += 30; // spacing between groups
    }

    // ── Footer ──
    let fy = h - 40;
    bm.hline(fy - 5, m, w - m - 1);
    bm.text(m, fy, "T.4 MH/MR  T.6 MMR  204X196 DPI", 2);
    let footer_right = "SIPALYZER VIRTUAL FAX";
    let fr_w = Bitmap::text_width(footer_right, 2);
    bm.text(w - m - fr_w, fy, footer_right, 2);

    write_1bit_tiff(output_path, &bm.data, w, h, resolution)
}

// (draw_block_text removed — superseded by Bitmap::text method)

/// Get a 5x7 pixel glyph for a character.
/// Supports uppercase, lowercase, digits, and common punctuation.
fn get_glyph(ch: char) -> Option<[u8; 7]> {
    // 5x7 font — top 5 bits of each byte represent the columns (MSB = leftmost pixel)
    match ch {
        // Uppercase
        'A' => Some([
            0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ]),
        'B' => Some([
            0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110,
        ]),
        'C' => Some([
            0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110,
        ]),
        'D' => Some([
            0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110,
        ]),
        'E' => Some([
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111,
        ]),
        'F' => Some([
            0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000,
        ]),
        'G' => Some([
            0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110,
        ]),
        'H' => Some([
            0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001,
        ]),
        'I' => Some([
            0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110,
        ]),
        'J' => Some([
            0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100,
        ]),
        'K' => Some([
            0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001,
        ]),
        'L' => Some([
            0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111,
        ]),
        'M' => Some([
            0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001,
        ]),
        'N' => Some([
            0b10001, 0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001,
        ]),
        'O' => Some([
            0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ]),
        'P' => Some([
            0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000,
        ]),
        'Q' => Some([
            0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101,
        ]),
        'R' => Some([
            0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001,
        ]),
        'S' => Some([
            0b01110, 0b10001, 0b10000, 0b01110, 0b00001, 0b10001, 0b01110,
        ]),
        'T' => Some([
            0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100,
        ]),
        'U' => Some([
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110,
        ]),
        'V' => Some([
            0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100,
        ]),
        'W' => Some([
            0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010,
        ]),
        'X' => Some([
            0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001,
        ]),
        'Y' => Some([
            0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100,
        ]),
        'Z' => Some([
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111,
        ]),

        // Lowercase (descenders/ascenders approximated in 7-row grid)
        'a' => Some([
            0b00000, 0b00000, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111,
        ]),
        'b' => Some([
            0b10000, 0b10000, 0b10110, 0b11001, 0b10001, 0b10001, 0b11110,
        ]),
        'c' => Some([
            0b00000, 0b00000, 0b01110, 0b10000, 0b10000, 0b10001, 0b01110,
        ]),
        'd' => Some([
            0b00001, 0b00001, 0b01101, 0b10011, 0b10001, 0b10001, 0b01111,
        ]),
        'e' => Some([
            0b00000, 0b00000, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110,
        ]),
        'f' => Some([
            0b00110, 0b01001, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000,
        ]),
        'g' => Some([
            0b00000, 0b01111, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110,
        ]),
        'h' => Some([
            0b10000, 0b10000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001,
        ]),
        'i' => Some([
            0b00100, 0b00000, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110,
        ]),
        'j' => Some([
            0b00010, 0b00000, 0b00110, 0b00010, 0b00010, 0b10010, 0b01100,
        ]),
        'k' => Some([
            0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010,
        ]),
        'l' => Some([
            0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110,
        ]),
        'm' => Some([
            0b00000, 0b00000, 0b11010, 0b10101, 0b10101, 0b10001, 0b10001,
        ]),
        'n' => Some([
            0b00000, 0b00000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001,
        ]),
        'o' => Some([
            0b00000, 0b00000, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110,
        ]),
        'p' => Some([
            0b00000, 0b00000, 0b11110, 0b10001, 0b11110, 0b10000, 0b10000,
        ]),
        'q' => Some([
            0b00000, 0b00000, 0b01101, 0b10011, 0b01111, 0b00001, 0b00001,
        ]),
        'r' => Some([
            0b00000, 0b00000, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000,
        ]),
        's' => Some([
            0b00000, 0b00000, 0b01110, 0b10000, 0b01110, 0b00001, 0b11110,
        ]),
        't' => Some([
            0b01000, 0b01000, 0b11100, 0b01000, 0b01000, 0b01001, 0b00110,
        ]),
        'u' => Some([
            0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101,
        ]),
        'v' => Some([
            0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100,
        ]),
        'w' => Some([
            0b00000, 0b00000, 0b10001, 0b10001, 0b10101, 0b10101, 0b01010,
        ]),
        'x' => Some([
            0b00000, 0b00000, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001,
        ]),
        'y' => Some([
            0b00000, 0b00000, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110,
        ]),
        'z' => Some([
            0b00000, 0b00000, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111,
        ]),

        // Digits
        '0' => Some([
            0b01110, 0b10011, 0b10101, 0b10101, 0b10101, 0b11001, 0b01110,
        ]),
        '1' => Some([
            0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110,
        ]),
        '2' => Some([
            0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111,
        ]),
        '3' => Some([
            0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110,
        ]),
        '4' => Some([
            0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010,
        ]),
        '5' => Some([
            0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110,
        ]),
        '6' => Some([
            0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110,
        ]),
        '7' => Some([
            0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000,
        ]),
        '8' => Some([
            0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110,
        ]),
        '9' => Some([
            0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110,
        ]),

        // Punctuation & symbols
        ' ' => Some([
            0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000,
        ]),
        '.' => Some([
            0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100,
        ]),
        ',' => Some([
            0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100, 0b01000,
        ]),
        ':' => Some([
            0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000,
        ]),
        ';' => Some([
            0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b01000,
        ]),
        '-' => Some([
            0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000,
        ]),
        '_' => Some([
            0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111,
        ]),
        '!' => Some([
            0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100,
        ]),
        '?' => Some([
            0b01110, 0b10001, 0b00001, 0b00110, 0b00100, 0b00000, 0b00100,
        ]),
        '/' => Some([
            0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000,
        ]),
        '(' => Some([
            0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010,
        ]),
        ')' => Some([
            0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000,
        ]),
        '+' => Some([
            0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000,
        ]),
        '=' => Some([
            0b00000, 0b00000, 0b11111, 0b00000, 0b11111, 0b00000, 0b00000,
        ]),
        '@' => Some([
            0b01110, 0b10001, 0b10111, 0b10101, 0b10110, 0b10000, 0b01110,
        ]),
        '#' => Some([
            0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010,
        ]),
        '$' => Some([
            0b00100, 0b01111, 0b10100, 0b01110, 0b00101, 0b11110, 0b00100,
        ]),
        '%' => Some([
            0b11000, 0b11001, 0b00010, 0b00100, 0b01000, 0b10011, 0b00011,
        ]),
        '&' => Some([
            0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101,
        ]),
        '*' => Some([
            0b00000, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0b00000,
        ]),
        '\'' => Some([
            0b01100, 0b01100, 0b01000, 0b00000, 0b00000, 0b00000, 0b00000,
        ]),
        '"' => Some([
            0b01010, 0b01010, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000,
        ]),
        _ => Some([
            0b11111, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11111,
        ]), // Unknown = box
    }
}

/// Create a TIFF page from plain text content.
///
/// Renders text content onto a fax-compatible 1-bit TIFF (1728 px wide).
/// Used by the composed fax feature when the user types content in the editor.
pub fn create_text_page(
    output_path: &str,
    text: &str,
    resolution: FaxResolution,
) -> Result<(), String> {
    let w = FAX_WIDTH;
    let h = resolution.page_height();
    let mut bmp = Bitmap::new(w, h);

    let margin: u32 = 60;
    let mut y: u32 = margin;
    let scale: u32 = 3; // 15×21 px per glyph
    let line_height: u32 = 7 * scale + scale * 2; // glyph height + spacing

    // Header line
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M").to_string();
    bmp.text(margin, y, "FAX DOCUMENT", 4);
    let ts_w = Bitmap::text_width(&timestamp, 2);
    bmp.text(w - margin - ts_w, y + 8, &timestamp, 2);
    y += 40;
    bmp.hline(y, margin, w - margin - 1);
    y += 20;

    // Render text lines
    for line in text.lines() {
        if y + line_height > h - margin {
            break; // Out of page space
        }
        if line.trim().is_empty() {
            y += line_height / 2;
            continue;
        }
        // Word-wrap at page width
        let max_chars = ((w - 2 * margin) / (6 * scale)) as usize;
        let mut remaining = line;
        while !remaining.is_empty() {
            if y + line_height > h - margin {
                break;
            }
            let chunk_len = remaining.len().min(max_chars);
            // Try to break at a space
            let break_at = if chunk_len < remaining.len() {
                remaining[..chunk_len]
                    .rfind(' ')
                    .map(|p| p + 1)
                    .unwrap_or(chunk_len)
            } else {
                chunk_len
            };
            let chunk = &remaining[..break_at];
            bmp.text(margin, y, &chunk.to_uppercase(), scale);
            remaining = remaining[break_at..].trim_start();
            y += line_height;
        }
    }

    // Footer
    let footer_y = h - margin;
    bmp.hline(footer_y, margin, w - margin - 1);
    bmp.text(
        margin,
        footer_y + 6,
        "1-BIT TIFF  GROUP 4  A4  204X196 DPI",
        2,
    );
    let page_label = "PAGE 1";
    let pw = Bitmap::text_width(page_label, 2);
    bmp.text(w - margin - pw, footer_y + 6, page_label, 2);

    write_1bit_tiff(output_path, &bmp.data, w, h, resolution)
}

/// Get information about a TIFF file
pub struct TiffInfo {
    pub width: u32,
    pub height: u32,
    pub pages: u32,
    pub bits_per_pixel: u32,
    pub compression: String,
    pub x_resolution: f32,
    pub y_resolution: f32,
}

/// Read TIFF file information
pub fn get_tiff_info(path: &str) -> Result<TiffInfo, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Failed to open TIFF: {}", e))?;

    let mut decoder = tiff::decoder::Decoder::new(std::io::BufReader::new(file))
        .map_err(|e| format!("Failed to decode TIFF: {}", e))?;

    let (width, height) = decoder
        .dimensions()
        .map_err(|e| format!("Failed to get dimensions: {}", e))?;

    let color_type = decoder
        .colortype()
        .map_err(|e| format!("Failed to get color type: {}", e))?;

    let bpp = match color_type {
        tiff::ColorType::Gray(bits) => bits as u32,
        tiff::ColorType::RGB(bits) => bits as u32 * 3,
        tiff::ColorType::RGBA(bits) => bits as u32 * 4,
        _ => 8,
    };

    Ok(TiffInfo {
        width,
        height,
        pages: 1, // Multi-page detection would require iterating IFDs
        bits_per_pixel: bpp,
        compression: "Unknown".to_string(),
        x_resolution: 204.0,
        y_resolution: 98.0,
    })
}

/// Validate that a TIFF file is suitable for fax transmission
pub fn validate_fax_tiff(path: &str) -> Result<(), String> {
    let info = get_tiff_info(path)?;

    if info.width != FAX_WIDTH {
        return Err(format!(
            "TIFF width is {} but fax requires {} pixels",
            info.width, FAX_WIDTH
        ));
    }

    if info.bits_per_pixel != 1 {
        return Err(format!(
            "TIFF is {} bpp but fax requires 1 bpp",
            info.bits_per_pixel
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fax_resolution_default() {
        assert_eq!(FaxResolution::default(), FaxResolution::Fine);
    }

    #[test]
    fn test_create_test_page() {
        let temp = std::env::temp_dir().join("test_fax_page.tiff");
        let path = temp.to_string_lossy().to_string();
        create_test_page(&path, Some("TEST STATION"), FaxResolution::Standard, None).unwrap();

        // Verify file was created and has TIFF header
        let data = std::fs::read(&path).unwrap();
        assert_eq!(&data[0..2], b"II"); // Little-endian TIFF
        assert_eq!(u16::from_le_bytes([data[2], data[3]]), 42); // TIFF magic

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn test_floyd_steinberg_dither() {
        let gray = GrayImage::from_fn(100, 100, |x, _y| {
            image::Luma([(x as f32 / 100.0 * 255.0) as u8])
        });
        let bitmap = floyd_steinberg_dither(&gray);
        let bytes_per_row = (100 + 7) / 8;
        assert_eq!(bitmap.len(), bytes_per_row * 100);
    }
}
