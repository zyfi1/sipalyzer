//! EdgeMarc catalog row helpers: parse `image.bin.*` paths into `EmfwFirmwareRow` entries.
//! Firmware bytes are listed and downloaded from CloudCo FTP (`edgemarc_cloudco`); no local bundle.

use serde::Deserialize;
use std::path::Path;

/// Manifest entry shape (also built from FTP listing in `edgemarc_cloudco`).
#[derive(Debug, Clone, Deserialize)]
pub struct EmfwManifestEntry {
    pub path: String,
    #[serde(default)]
    pub size: u64,
}

/// Catalog row built from manifest (mapped to `FirmwareEntry` in `tools.rs`).
#[derive(Debug, Clone)]
pub struct EmfwFirmwareRow {
    pub id: String,
    pub series: String,
    pub models: String,
    pub version: String,
    pub filename: String,
    pub size_bytes: u64,
    pub notes: String,
    pub storage_path: String,
}

pub fn firmware_rows_from_manifest(entries: &[EmfwManifestEntry]) -> Vec<EmfwFirmwareRow> {
    let mut out = Vec::new();
    for e in entries {
        let path = e.path.replace('\\', "/");
        if path.contains("..") {
            continue;
        }
        let Some(name) = Path::new(&path).file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if let Some(parsed) = parse_image_filename(name) {
            let id = format!(
                "edgemarc-{}-{}-{}",
                parsed.platform,
                parsed.track,
                slug_version(&parsed.version)
            );
            out.push(EmfwFirmwareRow {
                id,
                series: parsed.series,
                models: parsed.track.clone(),
                version: parsed.version,
                filename: name.into(),
                size_bytes: e.size,
                notes: format!("EdgeMarc — passive FTP. Server path: {}", path),
                storage_path: path,
            });
        }
    }
    out.sort_by(|a, b| {
        a.series
            .cmp(&b.series)
            .then_with(|| a.models.cmp(&b.models))
            .then_with(|| version_cmp_desc(&a.version, &b.version))
    });
    out
}

fn slug_version(v: &str) -> String {
    v.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

fn version_cmp_desc(a: &str, b: &str) -> std::cmp::Ordering {
    version_cmp(b, a)
}

fn version_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    let pa: Vec<&str> = a.split(|c| c == '.' || c == '-').collect();
    let pb: Vec<&str> = b.split(|c| c == '.' || c == '-').collect();
    let n = pa.len().max(pb.len());
    for i in 0..n {
        let x = pa.get(i).copied().unwrap_or("");
        let y = pb.get(i).copied().unwrap_or("");
        let ox = x.parse::<u32>().ok();
        let oy = y.parse::<u32>().ok();
        let ord = match (ox, oy) {
            (Some(nx), Some(ny)) => nx.cmp(&ny),
            _ => x.cmp(y),
        };
        if ord != std::cmp::Ordering::Equal {
            return ord;
        }
    }
    std::cmp::Ordering::Equal
}

struct ParsedImage {
    platform: String,
    series: String,
    track: String,
    version: String,
}

fn parse_image_filename(name: &str) -> Option<ParsedImage> {
    let rest = name.strip_prefix("image.bin.")?;
    let parts: Vec<&str> = rest.splitn(3, '.').collect();
    if parts.len() != 3 {
        return None;
    }
    let platform = parts[0].to_string();
    let track = parts[1].to_string();
    let version = parts[2].to_string();
    let series = if platform.starts_with("e2900") {
        "2900".into()
    } else if platform.starts_with("e4806") {
        if platform.contains("v2") {
            "4806v2".into()
        } else {
            "4806".into()
        }
    } else {
        platform.clone()
    };
    Some(ParsedImage {
        platform,
        series,
        track,
        version,
    })
}
