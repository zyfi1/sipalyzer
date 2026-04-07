use anyhow::{Context, Result};
use std::fs::File;
use std::io::Write;
use std::path::Path;

/// Write packets to PCAP file format
/// PCAP format: Global Header + Packet Headers + Packet Data
pub struct PcapWriter {
    file: File,
    packet_count: u32,
}

impl PcapWriter {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut file = File::create(path).context("Failed to create PCAP file")?;

        // Write PCAP Global Header (24 bytes) in standard big-endian order.
        // Magic 0xA1B2C3D4 means "standard pcap, microsecond, file is big-endian".
        // libpcap/Capture::from_file expects this; writing LE caused "unsupported version 512.1024".
        file.write_all(&0xA1B2C3D4u32.to_be_bytes())?; // Magic number (standard microsecond)
        file.write_all(&2u16.to_be_bytes())?; // Version major
        file.write_all(&4u16.to_be_bytes())?; // Version minor
        file.write_all(&0i32.to_be_bytes())?; // Timezone offset (GMT)
        file.write_all(&0u32.to_be_bytes())?; // Timestamp accuracy
        file.write_all(&65535u32.to_be_bytes())?; // Snaplen (max packet size)
        file.write_all(&1u32.to_be_bytes())?; // Data link type (Ethernet)

        Ok(Self {
            file,
            packet_count: 0,
        })
    }

    pub fn write_packet(&mut self, packet: &crate::packet_capture::PacketInfo) -> Result<()> {
        if !packet.can_write_authoritative_pcap() {
            anyhow::bail!(
                "Refusing non-authoritative packet write (fidelity={:?}, provenance={:?})",
                packet.fidelity,
                packet.provenance
            );
        }
        let raw_frame = packet
            .raw_frame
            .as_deref()
            .context("Packet is missing raw_frame data for authoritative write")?;
        self.write_captured_frame(packet.timestamp, raw_frame)
    }

    /// Write an exact captured frame with the provided timestamp.
    pub fn write_captured_frame(
        &mut self,
        timestamp: chrono::DateTime<chrono::Utc>,
        raw_frame: &[u8],
    ) -> Result<()> {
        let timestamp_us = timestamp.timestamp_micros();
        let ts_sec = (timestamp_us / 1_000_000) as u32;
        let ts_usec = (timestamp_us % 1_000_000) as u32;
        self.write_record_header(
            ts_sec,
            ts_usec,
            raw_frame.len() as u32,
            raw_frame.len() as u32,
        )?;
        self.file.write_all(raw_frame)?;
        self.packet_count += 1;
        Ok(())
    }

    /// Create a PcapWriter without writing a global header.
    /// Used for remote capture where the header comes from the remote stream.
    pub fn new_empty<P: AsRef<Path>>(path: P) -> Result<Self> {
        let file = File::create(path).context("Failed to create PCAP file")?;
        Ok(Self {
            file,
            packet_count: 0,
        })
    }

    /// Write a raw pcap global header (24 bytes) to the file.
    /// Used when relaying a pcap stream from a remote source.
    pub fn write_raw_header(&mut self, header: &[u8]) -> Result<()> {
        self.file.write_all(header)?;
        self.file.flush()?;
        Ok(())
    }

    /// Write a raw pcap record (header + data) to the file.
    pub fn write_raw_record(&mut self, record: &[u8]) -> Result<()> {
        self.file.write_all(record)?;
        self.packet_count += 1;
        Ok(())
    }

    /// Flush all buffered data to disk. Call this when stopping a capture to ensure
    /// the PCAP file is complete and readable immediately.
    pub fn flush(&mut self) -> Result<()> {
        use std::io::Write;
        self.file.flush().context("Failed to flush PCAP file")?;
        self.file.sync_all().context("Failed to sync PCAP file")?;
        tracing::info!(
            "Flushed & synced — {} packets written to disk",
            self.packet_count
        );
        Ok(())
    }

    #[allow(dead_code)]
    pub fn packet_count(&self) -> u32 {
        self.packet_count
    }

    fn write_record_header(
        &mut self,
        ts_sec: u32,
        ts_usec: u32,
        incl_len: u32,
        orig_len: u32,
    ) -> Result<()> {
        // Record fields follow endianness signaled by the global header.
        self.file.write_all(&ts_sec.to_be_bytes())?;
        self.file.write_all(&ts_usec.to_be_bytes())?;
        self.file.write_all(&incl_len.to_be_bytes())?;
        self.file.write_all(&orig_len.to_be_bytes())?;
        Ok(())
    }
}
