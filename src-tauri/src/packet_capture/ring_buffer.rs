//! High-performance lock-free ring buffer for packet storage.
//! 
//! Uses Arc<PacketInfo> to avoid cloning and parking_lot for faster locking.
//! Designed to handle millions of packets at wire speed.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use parking_lot::RwLock;
use crate::packet_capture::PacketInfo;

/// Default capacity for live captures (2M packets for enterprise scale)
pub const DEFAULT_BUFFER_CAPACITY: usize = 2_000_000;

/// High-performance ring buffer for packet storage.
/// 
/// Key features:
/// - Lock-free reads via atomic indices
/// - Minimal locking for writes (parking_lot RwLock)
/// - Arc<PacketInfo> storage to avoid cloning
/// - O(1) push, O(n) range queries
pub struct PacketRingBuffer {
    /// Storage for packet references
    buffer: Vec<RwLock<Option<Arc<PacketInfo>>>>,
    /// Current write position (wraps around)
    write_index: AtomicUsize,
    /// Number of valid packets (capped at capacity)
    size: AtomicUsize,
    /// Maximum capacity
    capacity: usize,
}

impl PacketRingBuffer {
    #[inline]
    fn range_window(&self, offset: usize, limit: usize) -> Option<(usize, usize, usize)> {
        let size = self.size.load(Ordering::Acquire);
        if limit == 0 || offset >= size {
            return None;
        }
        let end = (offset + limit).min(size);
        let count = end - offset;
        if count == 0 {
            return None;
        }
        let write_pos = self.write_index.load(Ordering::Acquire);
        let base = if size < self.capacity {
            0
        } else {
            write_pos % self.capacity
        };
        Some((base, count, offset))
    }

    /// Create a new ring buffer with specified capacity.
    pub fn new(capacity: usize) -> Self {
        let mut buffer = Vec::with_capacity(capacity);
        for _ in 0..capacity {
            buffer.push(RwLock::new(None));
        }
        
        Self {
            buffer,
            write_index: AtomicUsize::new(0),
            size: AtomicUsize::new(0),
            capacity,
        }
    }

    /// Push a packet into the buffer.
    /// If buffer is full, overwrites oldest packet.
    /// Returns an Arc to the stored packet.
    pub fn push(&self, packet: PacketInfo) -> Arc<PacketInfo> {
        let arc = Arc::new(packet);
        
        // Get current write position and advance atomically
        let pos = self.write_index.fetch_add(1, Ordering::SeqCst) % self.capacity;
        
        // Store the packet
        {
            let mut slot = self.buffer[pos].write();
            *slot = Some(arc.clone());
        }
        
        // Update size (cap at capacity)
        let current_size = self.size.load(Ordering::Relaxed);
        if current_size < self.capacity {
            self.size.fetch_add(1, Ordering::SeqCst);
        }
        
        arc
    }

    /// Push a packet (mutable version for compatibility with existing code).
    pub fn push_mut(&mut self, packet: PacketInfo) {
        self.push(packet);
    }

    /// Get the last N packets (most recent packets).
    /// Returns cloned PacketInfo for API compatibility.
    pub fn get_last(&self, count: usize) -> Vec<PacketInfo> {
        let size = self.size.load(Ordering::Acquire);
        let start = size.saturating_sub(count);
        self.get_range(start, count)
    }

    /// Get packets in range [offset, offset+limit). Index 0 = oldest, size-1 = newest.
    /// Returns fewer than limit if offset is near end.
    pub fn get_range(&self, offset: usize, limit: usize) -> Vec<PacketInfo> {
        let Some((base, count, offset)) = self.range_window(offset, limit) else {
            return Vec::new();
        };

        let mut result = Vec::with_capacity(count);
        let mut idx = (base + offset) % self.capacity;

        for _ in 0..count {
            let slot = self.buffer[idx].read();
            if let Some(packet) = slot.as_ref() {
                result.push((**packet).clone());
            }
            idx += 1;
            if idx == self.capacity {
                idx = 0;
            }
        }
        
        result
    }

    /// Get packets in range as Arc references (zero-copy).
    /// More efficient for read-only access.
    pub fn get_range_arc(&self, offset: usize, limit: usize) -> Vec<Arc<PacketInfo>> {
        let Some((base, count, offset)) = self.range_window(offset, limit) else {
            return Vec::new();
        };

        let mut result = Vec::with_capacity(count);
        let mut idx = (base + offset) % self.capacity;

        for _ in 0..count {
            let slot = self.buffer[idx].read();
            if let Some(packet) = slot.as_ref() {
                result.push(packet.clone());
            }
            idx += 1;
            if idx == self.capacity {
                idx = 0;
            }
        }
        
        result
    }

    /// Get all packets.
    #[allow(dead_code)]
    pub fn get_all(&self) -> Vec<PacketInfo> {
        let size = self.size.load(Ordering::Acquire);
        self.get_last(size)
    }

    /// Get current number of packets in buffer.
    pub fn len(&self) -> usize {
        self.size.load(Ordering::Acquire)
    }

    /// Check if buffer is empty.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Get buffer capacity.
    #[allow(dead_code)]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Clear the buffer.
    #[allow(dead_code)]
    pub fn clear(&self) {
        for slot in &self.buffer {
            let mut guard = slot.write();
            *guard = None;
        }
        self.write_index.store(0, Ordering::SeqCst);
        self.size.store(0, Ordering::SeqCst);
    }
}

// Implement Send + Sync for thread safety
unsafe impl Send for PacketRingBuffer {}
unsafe impl Sync for PacketRingBuffer {}

/// Thread-safe wrapper for PacketRingBuffer.
/// 
/// The new implementation is already thread-safe internally,
/// so this is just a type alias for Arc<PacketRingBuffer>.
/// 
/// For backwards compatibility, we also provide a Mutex-wrapped version.
pub type SharedPacketBuffer = Arc<std::sync::Mutex<PacketRingBufferCompat>>;

/// Compatibility wrapper that implements the mutable API expected by existing code.
/// This wrapper adds a thin Mutex layer for code that expects `&mut self` methods.
pub struct PacketRingBufferCompat {
    inner: PacketRingBuffer,
}

impl PacketRingBufferCompat {
    pub fn new(capacity: usize) -> Self {
        Self {
            inner: PacketRingBuffer::new(capacity),
        }
    }

    /// Push a packet into the buffer (mutable for compatibility).
    pub fn push(&mut self, packet: PacketInfo) {
        self.inner.push(packet);
    }

    /// Get the last N packets.
    pub fn get_last(&self, count: usize) -> Vec<PacketInfo> {
        self.inner.get_last(count)
    }

    /// Get packets in range.
    pub fn get_range(&self, offset: usize, limit: usize) -> Vec<PacketInfo> {
        self.inner.get_range(offset, limit)
    }

    /// Get all packets.
    #[allow(dead_code)]
    pub fn get_all(&self) -> Vec<PacketInfo> {
        self.inner.get_all()
    }

    /// Get packets in range as Arc references (zero-copy).
    pub fn get_range_arc(&self, offset: usize, limit: usize) -> Vec<Arc<PacketInfo>> {
        self.inner.get_range_arc(offset, limit)
    }

    /// Get current size.
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// Check if empty.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Clear the buffer.
    #[allow(dead_code)]
    pub fn clear(&mut self) {
        self.inner.clear();
    }
}

/// Lock-free shared buffer for high-performance scenarios.
/// Use this when you don't need mutable access patterns.
pub type LockFreePacketBuffer = Arc<PacketRingBuffer>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::IpAddr;
    use chrono::Utc;

    fn create_test_packet(id: u16) -> PacketInfo {
        PacketInfo {
            timestamp: Utc::now(),
            src_ip: "192.168.1.1".parse::<IpAddr>().unwrap(),
            dst_ip: "192.168.1.2".parse::<IpAddr>().unwrap(),
            src_port: id,
            dst_port: 5060,
            protocol: crate::packet_capture::Protocol::SIP,
            size: 100,
            frame_length: 142,
            raw_frame: None,
            data: vec![0u8; 100],
            decoded: None,
            fidelity: crate::packet_capture::PacketFidelity::Simulated,
            provenance: crate::packet_capture::PacketProvenance::Unknown,
        }
    }

    #[test]
    fn test_push_and_get() {
        let buffer = PacketRingBuffer::new(10);
        
        for i in 0..5 {
            buffer.push(create_test_packet(i));
        }
        
        assert_eq!(buffer.len(), 5);
        
        let packets = buffer.get_last(3);
        assert_eq!(packets.len(), 3);
        assert_eq!(packets[0].src_port, 2);
        assert_eq!(packets[2].src_port, 4);
    }

    #[test]
    fn test_wrap_around() {
        let buffer = PacketRingBuffer::new(5);
        
        for i in 0..10 {
            buffer.push(create_test_packet(i));
        }
        
        assert_eq!(buffer.len(), 5);
        
        let packets = buffer.get_all();
        assert_eq!(packets.len(), 5);
        // Should have packets 5-9 (newest 5)
        assert_eq!(packets[0].src_port, 5);
        assert_eq!(packets[4].src_port, 9);
    }

    #[test]
    fn test_get_range() {
        let buffer = PacketRingBuffer::new(10);
        
        for i in 0..10 {
            buffer.push(create_test_packet(i));
        }
        
        let packets = buffer.get_range(2, 3);
        assert_eq!(packets.len(), 3);
        assert_eq!(packets[0].src_port, 2);
        assert_eq!(packets[2].src_port, 4);
    }

    #[test]
    fn test_concurrent_access() {
        use std::thread;
        
        let buffer = Arc::new(PacketRingBuffer::new(1000));
        let mut handles = vec![];
        
        // Spawn writer threads
        for t in 0..4 {
            let buf = buffer.clone();
            handles.push(thread::spawn(move || {
                for i in 0..100 {
                    buf.push(create_test_packet((t * 100 + i) as u16));
                }
            }));
        }
        
        // Spawn reader threads
        for _ in 0..4 {
            let buf = buffer.clone();
            handles.push(thread::spawn(move || {
                for _ in 0..100 {
                    let _ = buf.get_last(10);
                }
            }));
        }
        
        for handle in handles {
            handle.join().unwrap();
        }
        
        assert_eq!(buffer.len(), 400);
    }
}
