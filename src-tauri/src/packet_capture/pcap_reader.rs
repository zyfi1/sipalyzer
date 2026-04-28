//! Memory-mapped PCAP file reading for efficient large file access.
//!
//! Uses memory-mapped I/O to read PCAP files without loading them entirely
//! into memory. This enables efficient access to multi-gigabyte capture files.

use std::fs::File;
use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
use memmap2::{Mmap, MmapOptions};

use crate::packet_capture::packet_parser::PacketParser;
use crate::packet_capture::PacketInfo;

/// PCAP file magic numbers.
const PCAP_MAGIC_NATIVE: u32 = 0xa1b2c3d4;
const PCAP_MAGIC_SWAPPED: u32 = 0xd4c3b2a1;
const PCAP_MAGIC_NSEC_NATIVE: u32 = 0xa1b23c4d;
const PCAP_MAGIC_NSEC_SWAPPED: u32 = 0x4d3cb2a1;

/// PCAP file header (24 bytes).
#[derive(Debug, Clone)]
pub struct PcapHeader {
    pub magic: u32,
    pub version_major: u16,
    pub version_minor: u16,
    pub thiszone: i32,
    pub sigfigs: u32,
    pub snaplen: u32,
    pub network: u32,
}

/// PCAP packet header (16 bytes).
#[derive(Debug, Clone, Copy)]
pub struct PcapPacketHeader {
    pub ts_sec: u32,
    pub ts_usec: u32,
    pub caplen: u32,
    pub len: u32,
}

/// Memory-mapped PCAP file reader.
pub struct MmapPcapReader {
    mmap: Arc<Mmap>,
    header: PcapHeader,
    byte_swapped: bool,
    nanosecond_timestamps: bool,
    current_offset: usize,
    file_size: usize,
}

impl MmapPcapReader {
    /// Open a PCAP file for memory-mapped reading.
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let file = File::open(path.as_ref())
            .with_context(|| format!("Failed to open PCAP file: {:?}", path.as_ref()))?;

        let file_size = file.metadata()?.len() as usize;

        if file_size < 24 {
            anyhow::bail!("PCAP file too small (minimum 24 bytes for header)");
        }

        // Memory-map the file
        let mmap = unsafe {
            MmapOptions::new()
                .map(&file)
                .context("Failed to memory-map PCAP file")?
        };

        // Read and validate header
        let magic = u32::from_le_bytes([mmap[0], mmap[1], mmap[2], mmap[3]]);

        let (byte_swapped, nanosecond_timestamps) = match magic {
            PCAP_MAGIC_NATIVE => (false, false),
            PCAP_MAGIC_SWAPPED => (true, false),
            PCAP_MAGIC_NSEC_NATIVE => (false, true),
            PCAP_MAGIC_NSEC_SWAPPED => (true, true),
            _ => anyhow::bail!("Invalid PCAP magic number: 0x{:08x}", magic),
        };

        let header = Self::parse_header(&mmap[..24], byte_swapped)?;

        Ok(Self {
            mmap: Arc::new(mmap),
            header,
            byte_swapped,
            nanosecond_timestamps,
            current_offset: 24, // Start after file header
            file_size,
        })
    }

    fn parse_header(data: &[u8], byte_swapped: bool) -> Result<PcapHeader> {
        let read_u16 = |offset: usize| -> u16 {
            let bytes = [data[offset], data[offset + 1]];
            if byte_swapped {
                u16::from_be_bytes(bytes)
            } else {
                u16::from_le_bytes(bytes)
            }
        };

        let read_u32 = |offset: usize| -> u32 {
            let bytes = [
                data[offset],
                data[offset + 1],
                data[offset + 2],
                data[offset + 3],
            ];
            if byte_swapped {
                u32::from_be_bytes(bytes)
            } else {
                u32::from_le_bytes(bytes)
            }
        };

        let read_i32 = |offset: usize| -> i32 {
            let bytes = [
                data[offset],
                data[offset + 1],
                data[offset + 2],
                data[offset + 3],
            ];
            if byte_swapped {
                i32::from_be_bytes(bytes)
            } else {
                i32::from_le_bytes(bytes)
            }
        };

        Ok(PcapHeader {
            magic: read_u32(0),
            version_major: read_u16(4),
            version_minor: read_u16(6),
            thiszone: read_i32(8),
            sigfigs: read_u32(12),
            snaplen: read_u32(16),
            network: read_u32(20),
        })
    }

    /// Get the file header.
    pub fn header(&self) -> &PcapHeader {
        &self.header
    }

    /// Get the link layer type (network field from header).
    pub fn link_type(&self) -> u32 {
        self.header.network
    }

    /// Get the total file size.
    pub fn file_size(&self) -> usize {
        self.file_size
    }

    /// Get the current read offset.
    pub fn current_offset(&self) -> usize {
        self.current_offset
    }

    /// Seek to a specific offset in the file.
    pub fn seek(&mut self, offset: usize) -> Result<()> {
        if offset < 24 {
            anyhow::bail!("Cannot seek before file header (offset 24)");
        }
        if offset > self.file_size {
            anyhow::bail!(
                "Seek offset {} exceeds file size {}",
                offset,
                self.file_size
            );
        }
        self.current_offset = offset;
        Ok(())
    }

    /// Reset to the beginning of packet data.
    pub fn reset(&mut self) {
        self.current_offset = 24;
    }

    /// Read the next packet header without the data.
    pub fn read_packet_header(&mut self) -> Result<Option<(PcapPacketHeader, usize)>> {
        if self.current_offset + 16 > self.file_size {
            return Ok(None);
        }

        let header_data = &self.mmap[self.current_offset..self.current_offset + 16];
        let header = self.parse_packet_header(header_data);
        let packet_start = self.current_offset + 16;

        self.current_offset = packet_start + header.caplen as usize;

        Ok(Some((header, packet_start)))
    }

    /// Read raw packet data at a specific offset.
    pub fn read_packet_data(&self, offset: usize, length: usize) -> Result<&[u8]> {
        if offset + length > self.file_size {
            anyhow::bail!("Packet data exceeds file size");
        }
        Ok(&self.mmap[offset..offset + length])
    }

    /// Read and parse the next packet.
    pub fn read_packet(
        &mut self,
        parser: &PacketParser,
        packet_number: u64,
    ) -> Result<Option<PacketInfo>> {
        if self.current_offset + 16 > self.file_size {
            return Ok(None);
        }

        // Read packet header
        let header_data = &self.mmap[self.current_offset..self.current_offset + 16];
        let header = self.parse_packet_header(header_data);

        // Validate packet
        if self.current_offset + 16 + header.caplen as usize > self.file_size {
            return Ok(None);
        }

        let packet_offset = self.current_offset + 16;
        let packet_data = &self.mmap[packet_offset..packet_offset + header.caplen as usize];

        self.current_offset = packet_offset + header.caplen as usize;

        // Create pcap packet for parsing
        let ts_usec = if self.nanosecond_timestamps {
            header.ts_usec / 1000 // Convert nanoseconds to microseconds
        } else {
            header.ts_usec
        };

        let pcap_header = pcap::PacketHeader {
            ts: libc::timeval {
                tv_sec: header.ts_sec as _,
                tv_usec: ts_usec as _,
            },
            caplen: header.caplen,
            len: header.len,
        };

        let packet = pcap::Packet {
            header: &pcap_header,
            data: packet_data,
        };

        Ok(parser.parse(&packet, Some(packet_number)))
    }

    fn parse_packet_header(&self, data: &[u8]) -> PcapPacketHeader {
        let read_u32 = |offset: usize| -> u32 {
            let bytes = [
                data[offset],
                data[offset + 1],
                data[offset + 2],
                data[offset + 3],
            ];
            if self.byte_swapped {
                u32::from_be_bytes(bytes)
            } else {
                u32::from_le_bytes(bytes)
            }
        };

        PcapPacketHeader {
            ts_sec: read_u32(0),
            ts_usec: read_u32(4),
            caplen: read_u32(8),
            len: read_u32(12),
        }
    }

    /// Iterate over all packets in the file.
    pub fn packets(&mut self, rtp_port_range: Option<(u16, u16)>) -> PcapPacketIterator<'_> {
        self.reset();
        let parser = PacketParser::with_rtp_port_range(self.header.network, rtp_port_range);

        PcapPacketIterator {
            reader: self,
            parser,
            packet_number: 0,
        }
    }

    /// Get packet count (requires scanning the file).
    pub fn packet_count(&mut self) -> usize {
        let original_offset = self.current_offset;
        self.reset();

        let mut count = 0;
        while let Ok(Some(_)) = self.read_packet_header() {
            count += 1;
        }

        self.current_offset = original_offset;
        count
    }

    /// Build an index of packet offsets for random access.
    pub fn build_index(&mut self) -> Vec<(usize, PcapPacketHeader)> {
        let original_offset = self.current_offset;
        self.reset();

        let mut index = Vec::new();

        while self.current_offset + 16 <= self.file_size {
            let header_offset = self.current_offset;
            let header_data = &self.mmap[self.current_offset..self.current_offset + 16];
            let header = self.parse_packet_header(header_data);

            if self.current_offset + 16 + header.caplen as usize > self.file_size {
                break;
            }

            index.push((header_offset, header));
            self.current_offset += 16 + header.caplen as usize;
        }

        self.current_offset = original_offset;
        index
    }

    /// Get a reference to the memory map for advanced use.
    pub fn mmap(&self) -> &Mmap {
        &self.mmap
    }
}

/// Iterator over packets in a PCAP file.
pub struct PcapPacketIterator<'a> {
    reader: &'a mut MmapPcapReader,
    parser: PacketParser,
    packet_number: u64,
}

impl<'a> Iterator for PcapPacketIterator<'a> {
    type Item = PacketInfo;

    fn next(&mut self) -> Option<Self::Item> {
        self.packet_number += 1;
        match self.reader.read_packet(&self.parser, self.packet_number) {
            Ok(Some(packet)) => Some(packet),
            Ok(None) => None,
            Err(e) => {
                tracing::error!("Error reading packet: {}", e);
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn create_test_pcap() -> NamedTempFile {
        let mut file = NamedTempFile::new().unwrap();

        // Write PCAP header
        let header: [u8; 24] = [
            0xd4, 0xc3, 0xb2, 0xa1, // Magic (swapped)
            0x02, 0x00, // Version major
            0x04, 0x00, // Version minor
            0x00, 0x00, 0x00, 0x00, // Timezone
            0x00, 0x00, 0x00, 0x00, // Sigfigs
            0xff, 0xff, 0x00, 0x00, // Snaplen
            0x01, 0x00, 0x00, 0x00, // Link type (Ethernet)
        ];
        file.write_all(&header).unwrap();

        // Write a minimal packet
        let packet_header: [u8; 16] = [
            0x00, 0x00, 0x00, 0x00, // Timestamp sec
            0x00, 0x00, 0x00, 0x00, // Timestamp usec
            0x10, 0x00, 0x00, 0x00, // Caplen (16)
            0x10, 0x00, 0x00, 0x00, // Len (16)
        ];
        file.write_all(&packet_header).unwrap();

        // Write packet data (16 bytes of zeros)
        file.write_all(&[0u8; 16]).unwrap();

        file.flush().unwrap();
        file
    }

    #[test]
    fn test_open_pcap() {
        let file = create_test_pcap();
        let reader = MmapPcapReader::open(file.path());
        assert!(reader.is_ok());

        let reader = reader.unwrap();
        assert_eq!(reader.link_type(), 1); // Ethernet
        assert_eq!(reader.file_size(), 24 + 16 + 16); // Header + packet header + data
    }

    #[test]
    fn test_read_packet_header() {
        let file = create_test_pcap();
        let mut reader = MmapPcapReader::open(file.path()).unwrap();

        let result = reader.read_packet_header();
        assert!(result.is_ok());

        let (header, _) = result.unwrap().unwrap();
        assert_eq!(header.caplen, 16);
        assert_eq!(header.len, 16);
    }

    #[test]
    fn test_packet_count() {
        let file = create_test_pcap();
        let mut reader = MmapPcapReader::open(file.path()).unwrap();

        assert_eq!(reader.packet_count(), 1);
    }

    #[test]
    fn test_build_index() {
        let file = create_test_pcap();
        let mut reader = MmapPcapReader::open(file.path()).unwrap();

        let index = reader.build_index();
        assert_eq!(index.len(), 1);
        assert_eq!(index[0].0, 24); // Offset of first packet
    }
}
