//! ZSTD compression for archived PCAP captures.
//!
//! Provides efficient compression and decompression of PCAP files for
//! long-term storage. ZSTD offers excellent compression ratios with
//! fast decompression speeds.

use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use zstd::{Decoder, Encoder};

/// Default compression level (1-22, higher = better compression, slower).
const DEFAULT_COMPRESSION_LEVEL: i32 = 3;

/// Buffer size for I/O operations.
const BUFFER_SIZE: usize = 1024 * 1024; // 1MB

/// Archive file extension.
pub const ARCHIVE_EXTENSION: &str = ".pcap.zst";

/// Compression statistics.
#[derive(Debug, Clone, serde::Serialize)]
pub struct CompressionStats {
    pub original_size: u64,
    pub compressed_size: u64,
    pub compression_ratio: f64,
    pub duration_ms: u64,
}

/// Compress a PCAP file using ZSTD.
///
/// # Arguments
/// * `input_path` - Path to the input PCAP file.
/// * `output_path` - Path to the output compressed file. If None, adds `.zst` extension.
/// * `compression_level` - ZSTD compression level (1-22). None uses default.
/// * `delete_original` - Whether to delete the original file after compression.
///
/// # Returns
/// Compression statistics including ratio and duration.
pub fn compress_pcap(
    input_path: &Path,
    output_path: Option<&Path>,
    compression_level: Option<i32>,
    delete_original: bool,
) -> Result<CompressionStats> {
    let start_time = std::time::Instant::now();
    let level = compression_level.unwrap_or(DEFAULT_COMPRESSION_LEVEL);

    // Determine output path
    let out_path = match output_path {
        Some(p) => p.to_path_buf(),
        None => {
            let mut path = input_path.to_path_buf();
            path.set_extension("pcap.zst");
            path
        }
    };

    // Get original file size
    let original_size = std::fs::metadata(input_path)
        .context("Failed to get input file metadata")?
        .len();

    // Open input file
    let input_file = File::open(input_path)
        .with_context(|| format!("Failed to open input file: {:?}", input_path))?;
    let mut reader = BufReader::with_capacity(BUFFER_SIZE, input_file);

    // Create output file with compression
    let output_file = File::create(&out_path)
        .with_context(|| format!("Failed to create output file: {:?}", out_path))?;
    let writer = BufWriter::with_capacity(BUFFER_SIZE, output_file);
    let mut encoder = Encoder::new(writer, level)
        .context("Failed to create ZSTD encoder")?;

    // Compress data
    let mut buffer = vec![0u8; BUFFER_SIZE];
    loop {
        let bytes_read = reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        encoder.write_all(&buffer[..bytes_read])?;
    }

    encoder.finish()?;

    // Get compressed size
    let compressed_size = std::fs::metadata(&out_path)
        .context("Failed to get output file metadata")?
        .len();

    // Calculate compression ratio
    let compression_ratio = if original_size > 0 {
        1.0 - (compressed_size as f64 / original_size as f64)
    } else {
        0.0
    };

    // Delete original if requested
    if delete_original {
        std::fs::remove_file(input_path)
            .with_context(|| format!("Failed to delete original file: {:?}", input_path))?;
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;

    Ok(CompressionStats {
        original_size,
        compressed_size,
        compression_ratio,
        duration_ms,
    })
}

/// Decompress a ZSTD-compressed PCAP file.
///
/// # Arguments
/// * `input_path` - Path to the compressed file.
/// * `output_path` - Path to the output PCAP file. If None, removes `.zst` extension.
/// * `delete_compressed` - Whether to delete the compressed file after decompression.
///
/// # Returns
/// The path to the decompressed file.
pub fn decompress_pcap(
    input_path: &Path,
    output_path: Option<&Path>,
    delete_compressed: bool,
) -> Result<PathBuf> {
    // Determine output path
    let out_path = match output_path {
        Some(p) => p.to_path_buf(),
        None => {
            let name = input_path
                .file_name()
                .context("Invalid input path")?
                .to_string_lossy();
            let new_name = name
                .strip_suffix(".zst")
                .unwrap_or(&name)
                .to_string();
            input_path.with_file_name(new_name)
        }
    };

    // Open compressed file
    let input_file = File::open(input_path)
        .with_context(|| format!("Failed to open compressed file: {:?}", input_path))?;
    let reader = BufReader::with_capacity(BUFFER_SIZE, input_file);
    let mut decoder = Decoder::new(reader)
        .context("Failed to create ZSTD decoder")?;

    // Create output file
    let output_file = File::create(&out_path)
        .with_context(|| format!("Failed to create output file: {:?}", out_path))?;
    let mut writer = BufWriter::with_capacity(BUFFER_SIZE, output_file);

    // Decompress data
    let mut buffer = vec![0u8; BUFFER_SIZE];
    loop {
        let bytes_read = decoder.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        writer.write_all(&buffer[..bytes_read])?;
    }

    writer.flush()?;

    // Delete compressed file if requested
    if delete_compressed {
        std::fs::remove_file(input_path)
            .with_context(|| format!("Failed to delete compressed file: {:?}", input_path))?;
    }

    Ok(out_path)
}

/// Check if a file is ZSTD compressed.
pub fn is_compressed(path: &Path) -> bool {
    path.extension()
        .map(|ext| ext == "zst")
        .unwrap_or(false)
}

/// Get the uncompressed file path from a compressed path.
pub fn get_uncompressed_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let new_name = name
        .strip_suffix(".zst")
        .unwrap_or(&name)
        .to_string();
    path.with_file_name(new_name)
}

/// Archive manager for PCAP files.
pub struct ArchiveManager {
    archive_dir: PathBuf,
    compression_level: i32,
}

impl ArchiveManager {
    /// Create a new archive manager.
    pub fn new(archive_dir: PathBuf) -> Self {
        Self {
            archive_dir,
            compression_level: DEFAULT_COMPRESSION_LEVEL,
        }
    }

    /// Set the compression level.
    pub fn with_compression_level(mut self, level: i32) -> Self {
        self.compression_level = level.clamp(1, 22);
        self
    }

    /// Ensure the archive directory exists.
    pub fn ensure_dir(&self) -> Result<()> {
        std::fs::create_dir_all(&self.archive_dir)
            .with_context(|| format!("Failed to create archive directory: {:?}", self.archive_dir))
    }

    /// Archive a PCAP file.
    pub fn archive(&self, pcap_path: &Path) -> Result<(PathBuf, CompressionStats)> {
        self.ensure_dir()?;

        let filename = pcap_path
            .file_name()
            .context("Invalid PCAP path")?
            .to_string_lossy();
        let archive_name = format!("{}.zst", filename);
        let archive_path = self.archive_dir.join(archive_name);

        let stats = compress_pcap(
            pcap_path,
            Some(&archive_path),
            Some(self.compression_level),
            false,
        )?;

        Ok((archive_path, stats))
    }

    /// Extract an archived PCAP file.
    pub fn extract(&self, archive_path: &Path, output_dir: Option<&Path>) -> Result<PathBuf> {
        let out_dir = output_dir.unwrap_or(&self.archive_dir);
        let filename = get_uncompressed_path(archive_path)
            .file_name()
            .context("Invalid archive path")?
            .to_string_lossy()
            .to_string();
        let output_path = out_dir.join(filename);

        decompress_pcap(archive_path, Some(&output_path), false)
    }

    /// List all archived files.
    pub fn list_archives(&self) -> Result<Vec<PathBuf>> {
        let mut archives = Vec::new();

        if !self.archive_dir.exists() {
            return Ok(archives);
        }

        for entry in std::fs::read_dir(&self.archive_dir)? {
            let entry = entry?;
            let path = entry.path();
            if is_compressed(&path) {
                archives.push(path);
            }
        }

        // Sort by modification time (newest first)
        archives.sort_by(|a, b| {
            let a_time = std::fs::metadata(a)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            let b_time = std::fs::metadata(b)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            b_time.cmp(&a_time)
        });

        Ok(archives)
    }

    /// Get total archive size.
    pub fn total_size(&self) -> Result<u64> {
        let mut total = 0u64;

        if !self.archive_dir.exists() {
            return Ok(0);
        }

        for entry in std::fs::read_dir(&self.archive_dir)? {
            let entry = entry?;
            if is_compressed(&entry.path()) {
                total += entry.metadata()?.len();
            }
        }

        Ok(total)
    }

    /// Delete old archives to maintain a size limit.
    pub fn cleanup(&self, max_size_bytes: u64) -> Result<Vec<PathBuf>> {
        let mut deleted = Vec::new();
        let archives = self.list_archives()?;
        let mut current_size = self.total_size()?;

        // Delete oldest archives until under limit
        for archive in archives.iter().rev() {
            if current_size <= max_size_bytes {
                break;
            }

            let file_size = std::fs::metadata(archive)?.len();
            std::fs::remove_file(archive)?;
            current_size -= file_size;
            deleted.push(archive.clone());
        }

        Ok(deleted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    fn create_test_file(dir: &Path, name: &str, size: usize) -> PathBuf {
        let path = dir.join(name);
        let mut file = File::create(&path).unwrap();
        // Write some repetitive data (compresses well)
        let data: Vec<u8> = (0..size).map(|i| (i % 256) as u8).collect();
        file.write_all(&data).unwrap();
        path
    }

    #[test]
    fn test_compress_decompress() {
        let dir = tempdir().unwrap();
        let input_path = create_test_file(dir.path(), "test.pcap", 10000);

        // Compress
        let stats = compress_pcap(&input_path, None, None, false).unwrap();
        assert!(stats.compression_ratio > 0.0);
        assert!(stats.compressed_size < stats.original_size);

        // Check compressed file exists
        let compressed_path = input_path.with_extension("pcap.zst");
        assert!(compressed_path.exists());

        // Decompress
        let decompressed_path = decompress_pcap(&compressed_path, None, false).unwrap();
        assert!(decompressed_path.exists());

        // Verify size matches original
        let decompressed_size = std::fs::metadata(&decompressed_path).unwrap().len();
        assert_eq!(decompressed_size, stats.original_size);
    }

    #[test]
    fn test_archive_manager() {
        let dir = tempdir().unwrap();
        let archive_dir = dir.path().join("archives");
        let manager = ArchiveManager::new(archive_dir.clone());

        // Create a test file
        let input_path = create_test_file(dir.path(), "capture.pcap", 10000);

        // Archive it
        let (archive_path, stats) = manager.archive(&input_path).unwrap();
        assert!(archive_path.exists());
        assert!(stats.compression_ratio > 0.0);

        // List archives
        let archives = manager.list_archives().unwrap();
        assert_eq!(archives.len(), 1);

        // Extract
        let extracted = manager.extract(&archive_path, None).unwrap();
        assert!(extracted.exists());
    }

    #[test]
    fn test_is_compressed() {
        assert!(is_compressed(Path::new("test.pcap.zst")));
        assert!(!is_compressed(Path::new("test.pcap")));
        assert!(!is_compressed(Path::new("test.zst.pcap")));
    }
}
