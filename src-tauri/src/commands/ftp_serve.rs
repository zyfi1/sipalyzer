//! Minimal read-only FTP (passive RETR only) for EdgeMarc firmware under a fixed root (`pub/e_XXXX/...`).

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

use super::tools::{cancel_session, create_session, get_lan_ip};

#[derive(Debug, Clone, Serialize)]
pub struct FtpServeStartResult {
    pub session_id: String,
    pub ftp_url: String,
    pub host: String,
    pub port: u16,
    pub passive_hint: String,
}

fn has_parent_traversal(path: &Path) -> bool {
    path.components().any(|c| matches!(c, Component::ParentDir))
}

fn resolve_under_root(root: &Path, cwd: &Path, arg: &str) -> Option<PathBuf> {
    let p = Path::new(arg.trim_start_matches('/'));
    if has_parent_traversal(p) {
        return None;
    }
    let joined = if arg.starts_with('/') {
        root.join(p.strip_prefix("/").unwrap_or(p))
    } else {
        root.join(cwd).join(p)
    };
    let canon = joined.canonicalize().ok()?;
    if canon.starts_with(root) {
        Some(canon)
    } else {
        None
    }
}

async fn write_line<W: AsyncWriteExt + Unpin>(w: &mut W, s: &str) -> std::io::Result<()> {
    w.write_all(s.as_bytes()).await?;
    w.write_all(b"\r\n").await?;
    w.flush().await
}

async fn handle_client(
    control: TcpStream,
    root: Arc<PathBuf>,
    advertise_ip: String,
    mut cancel: watch::Receiver<bool>,
) {
    let (rh, wh) = control.into_split();
    let mut reader = BufReader::new(rh);
    let mut writer = BufWriter::new(wh);
    let mut cwd = PathBuf::new();
    let mut logged_in = false;
    let mut pasv_listener: Option<TcpListener> = None;

    let _ = write_line(
        &mut writer,
        "220 SIPalyzer EdgeMarc FTP (read-only, anonymous)",
    )
    .await;

    loop {
        if *cancel.borrow() {
            break;
        }
        let mut line = String::new();
        let n = tokio::select! {
            _ = cancel.changed() => { break; }
            r = reader.read_line(&mut line) => r,
        };
        let Ok(n) = n else { break };
        if n == 0 {
            break;
        }
        let line = line.trim_end_matches(['\r', '\n']);
        let upper = line.to_ascii_uppercase();

        if upper.starts_with("USER ") {
            let _ = write_line(&mut writer, "331 send password").await;
        } else if upper.starts_with("PASS ") {
            logged_in = true;
            let _ = write_line(&mut writer, "230 logged in").await;
        } else if upper == "SYST" {
            let _ = write_line(&mut writer, "215 UNIX Type: L8").await;
        } else if upper == "FEAT" {
            let _ = write_line(&mut writer, "211-Features:").await;
            let _ = write_line(&mut writer, " SIZE").await;
            let _ = write_line(&mut writer, "211 end").await;
        } else if upper == "PWD" || upper == "XPWD" {
            let p = format!("/{}", cwd.to_string_lossy().trim_start_matches('/'));
            let _ = write_line(&mut writer, &format!("257 \"{}\"", p)).await;
        } else if upper.starts_with("CWD ") {
            let arg = line[4..].trim();
            if arg == "/" || arg.is_empty() {
                cwd = PathBuf::new();
                let _ = write_line(&mut writer, "250 cwd ok").await;
            } else if let Some(p) = resolve_under_root(&root, &cwd, arg) {
                if p.is_dir() {
                    if let Ok(rel) = p.strip_prefix(&*root) {
                        cwd = rel.to_path_buf();
                        let _ = write_line(&mut writer, "250 cwd ok").await;
                    } else {
                        let _ = write_line(&mut writer, "550 failed").await;
                    }
                } else {
                    let _ = write_line(&mut writer, "550 not a directory").await;
                }
            } else {
                let _ = write_line(&mut writer, "550 failed").await;
            }
        } else if upper.starts_with("TYPE ") {
            let _ = write_line(&mut writer, "200 type set").await;
        } else if upper == "PASV" {
            match TcpListener::bind("0.0.0.0:0").await {
                Ok(pl) => {
                    let local = pl.local_addr().unwrap();
                    pasv_listener = Some(pl);
                    let port = local.port();
                    let ip = advertise_ip
                        .parse::<std::net::Ipv4Addr>()
                        .unwrap_or_else(|_| std::net::Ipv4Addr::new(127, 0, 0, 1));
                    let (a, b, c, d) = (
                        ip.octets()[0],
                        ip.octets()[1],
                        ip.octets()[2],
                        ip.octets()[3],
                    );
                    let p1 = (port >> 8) as u8;
                    let p2 = (port & 0xff) as u8;
                    let _ = write_line(
                        &mut writer,
                        &format!(
                            "227 Entering Passive Mode ({},{},{},{},{},{})",
                            a, b, c, d, p1, p2
                        ),
                    )
                    .await;
                }
                Err(_) => {
                    let _ = write_line(&mut writer, "425 cannot open passive port").await;
                }
            }
        } else if upper.starts_with("SIZE ") {
            if !logged_in {
                let _ = write_line(&mut writer, "530 not logged in").await;
                continue;
            }
            let arg = line[5..].trim();
            if let Some(p) = resolve_under_root(&root, &cwd, arg) {
                if let Ok(meta) = tokio::fs::metadata(&p).await {
                    if meta.is_file() {
                        let _ = write_line(&mut writer, &format!("213 {}", meta.len())).await;
                        continue;
                    }
                }
            }
            let _ = write_line(&mut writer, "550 file unavailable").await;
        } else if upper.starts_with("RETR ") {
            if !logged_in {
                let _ = write_line(&mut writer, "530 not logged in").await;
                continue;
            }
            let arg = line[5..].trim();
            let Some(path) = resolve_under_root(&root, &cwd, arg) else {
                let _ = write_line(&mut writer, "550 failed").await;
                continue;
            };
            let Some(pl) = pasv_listener.take() else {
                let _ = write_line(&mut writer, "425 use PASV first").await;
                continue;
            };
            let _ = write_line(&mut writer, "150 opening binary connection").await;
            let accept = tokio::time::timeout(std::time::Duration::from_secs(120), pl.accept());
            let data_sock = match accept.await {
                Ok(Ok((s, _))) => s,
                _ => {
                    let _ = write_line(&mut writer, "426 transfer aborted").await;
                    continue;
                }
            };
            let file = match tokio::fs::File::open(&path).await {
                Ok(f) => f,
                Err(_) => {
                    let _ = write_line(&mut writer, "550 cannot read file").await;
                    continue;
                }
            };
            let mut data_sock = data_sock;
            let mut rdr = tokio::io::BufReader::new(file);
            match tokio::io::copy(&mut rdr, &mut data_sock).await {
                Ok(_) => {
                    let _ = write_line(&mut writer, "226 transfer complete").await;
                }
                Err(_) => {
                    let _ = write_line(&mut writer, "426 transfer failed").await;
                }
            }
        } else if upper == "QUIT" {
            let _ = write_line(&mut writer, "221 bye").await;
            break;
        } else if upper == "NOOP" {
            let _ = write_line(&mut writer, "200 ok").await;
        } else {
            let _ = write_line(&mut writer, "502 command not implemented").await;
        }
    }
}

/// Stops the FTP accept loop for `session_id`.
pub fn ftp_serve_stop(session_id: &str) -> bool {
    cancel_session(session_id)
}

/// Anonymous read-only FTP; **passive** downloads only. Bind `0.0.0.0:port` when `bind_all_interfaces`.
pub async fn ftp_serve_start(
    root: PathBuf,
    port: u16,
    bind_all_interfaces: bool,
) -> Result<FtpServeStartResult, String> {
    let root = root.canonicalize().map_err(|e| format!("FTP root: {e}"))?;
    let bind_host = if bind_all_interfaces {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    };
    let listener = TcpListener::bind(format!("{bind_host}:{port}"))
        .await
        .map_err(|e| format!("FTP bind {port}: {e}"))?;
    let local_port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let ip = if bind_all_interfaces {
        get_lan_ip().unwrap_or_else(|| "127.0.0.1".into())
    } else {
        "127.0.0.1".into()
    };
    let (session_id, mut cancel_rx) = create_session();
    let root_arc = Arc::new(root);
    let advertise = ip.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel_rx.changed() => {
                    if *cancel_rx.borrow() {
                        break;
                    }
                }
                acc = listener.accept() => {
                    if let Ok((sock, _)) = acc {
                        let r = root_arc.clone();
                        let adv = advertise.clone();
                        let c2 = cancel_rx.clone();
                        tokio::spawn(async move {
                            handle_client(sock, r, adv, c2).await;
                        });
                    }
                }
            }
        }
        drop(listener);
    });

    Ok(FtpServeStartResult {
        session_id,
        ftp_url: format!("ftp://{}:{}", ip, local_port),
        host: ip,
        port: local_port,
        passive_hint: "Use passive (PASV) on the EdgeMarc firmware screen.".into(),
    })
}
