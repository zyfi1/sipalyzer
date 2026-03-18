//! Agent config generation and packaging.
//!
//! At generation time, this invokes the bundled Go compiler to cross-compile
//! a single self-contained native binary for the selected OS. The agent config
//! (ID, auth token, controller address, expiration, etc.) is baked directly into
//! the binary via `-ldflags -X`, so no separate `agent.json` file is needed.
//!
//! The generated agent supports two explicit experiences:
//! - minimal: CLI/headless runtime
//! - full: GUI app runtime (no systray dependency)

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Parameters for generating an agent binary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateParams {
    /// Target OS: "windows", "macos-x64", "macos-arm64", "linux", "linux-amd64", "linux-arm64", "linux-armv7", "linux-armv6", "linux-386", "linux-mips", "linux-mipsle", "linux-mips64", "linux-mips64le"
    pub target_os: String,
    /// Controller address (IP:port).
    pub controller_address: String,
    /// Whether to use TLS.
    pub use_tls: bool,
    /// The listener's auth token — the agent must use the same token as the
    /// controller's WebSocket listener for HMAC authentication to succeed.
    pub auth_token: String,
    /// Expiration in seconds (None = never). After this time, the agent will
    /// self-destruct (shut down and remove its binary).
    pub expires_seconds: Option<u64>,
    /// Label for this agent.
    pub label: Option<String>,
    /// Deprecated: profile is always "full" now. Kept for API backward compat.
    #[serde(default = "default_profile")]
    pub profile: String,
    /// Requested runtime experience:
    /// - "minimal": CLI/headless
    /// - "full": standalone GUI app
    /// Defaults to "full" for backward compatibility.
    #[serde(default)]
    pub experience: Option<String>,
    /// Force minimal/headless runtime for backward compatibility.
    #[serde(default)]
    pub daemon_headless: bool,
    /// When recreating an agent, reuse this ID instead of generating a new one.
    #[serde(default)]
    pub agent_id: Option<String>,
}

fn default_profile() -> String {
    "full".to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgentExperience {
    Minimal,
    Full,
}

impl AgentExperience {
    fn as_str(self) -> &'static str {
        match self {
            Self::Minimal => "minimal",
            Self::Full => "full",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "minimal" | "headless" | "cli" => Some(Self::Minimal),
            "full" | "gui" | "web" => Some(Self::Full),
            _ => None,
        }
    }
}

fn resolve_experience(params: &GenerateParams) -> AgentExperience {
    if let Some(explicit) = params
        .experience
        .as_deref()
        .and_then(AgentExperience::parse)
    {
        return explicit;
    }
    if params.daemon_headless {
        return AgentExperience::Minimal;
    }
    if let Some(from_profile) = AgentExperience::parse(&params.profile) {
        return from_profile;
    }
    AgentExperience::Full
}

/// Result of generating an agent binary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateResult {
    /// Path to the generated binary file.
    pub binary_path: String,
    /// The auth token (shown to user once).
    pub auth_token: String,
    /// The agent ID.
    pub agent_id: String,
    /// The config that was generated.
    pub config: serde_json::Value,
}

/// Progress event payload emitted during compilation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileProgress {
    pub stage: String,
    pub message: String,
    pub progress: Option<f64>,
}

/// Target platform configuration for Go cross-compilation.
struct GoTarget {
    goos: &'static str,
    goarch: &'static str,
    goarm: Option<&'static str>,
    gomips: Option<&'static str>,
    gomips64: Option<&'static str>,
}

fn go_target(target_os: &str) -> Result<GoTarget, String> {
    match target_os {
        "windows" => Ok(GoTarget {
            goos: "windows",
            goarch: "amd64",
            goarm: None,
            gomips: None,
            gomips64: None,
        }),
        "macos-x64" => Ok(GoTarget {
            goos: "darwin",
            goarch: "amd64",
            goarm: None,
            gomips: None,
            gomips64: None,
        }),
        "macos-arm64" => Ok(GoTarget {
            goos: "darwin",
            goarch: "arm64",
            goarm: None,
            gomips: None,
            gomips64: None,
        }),
        "linux" | "linux-amd64" => Ok(GoTarget {
            goos: "linux",
            goarch: "amd64",
            goarm: None,
            gomips: None,
            gomips64: None,
        }),
        "linux-arm64" => Ok(GoTarget {
            goos: "linux",
            goarch: "arm64",
            goarm: None,
            gomips: None,
            gomips64: None,
        }),
        "linux-armv7" => Ok(GoTarget {
            goos: "linux",
            goarch: "arm",
            goarm: Some("7"),
            gomips: None,
            gomips64: None,
        }),
        "linux-armv6" => Ok(GoTarget {
            goos: "linux",
            goarch: "arm",
            goarm: Some("6"),
            gomips: None,
            gomips64: None,
        }),
        "linux-386" => Ok(GoTarget {
            goos: "linux",
            goarch: "386",
            goarm: None,
            gomips: None,
            gomips64: None,
        }),
        "linux-mips" => Ok(GoTarget {
            goos: "linux",
            goarch: "mips",
            goarm: None,
            gomips: Some("softfloat"),
            gomips64: None,
        }),
        "linux-mipsle" => Ok(GoTarget {
            goos: "linux",
            goarch: "mipsle",
            goarm: None,
            gomips: Some("softfloat"),
            gomips64: None,
        }),
        "linux-mips64" => Ok(GoTarget {
            goos: "linux",
            goarch: "mips64",
            goarm: None,
            gomips: None,
            gomips64: Some("softfloat"),
        }),
        "linux-mips64le" => Ok(GoTarget {
            goos: "linux",
            goarch: "mips64le",
            goarm: None,
            gomips: None,
            gomips64: Some("softfloat"),
        }),
        other => Err(format!("Unsupported target OS: {other}")),
    }
}

/// Generate an agent config and cross-compile a single self-contained binary.
/// `output_path` is the full path (including filename) where the binary will be written.
pub fn generate_agent_package(
    params: GenerateParams,
    resources_dir: &Path,
    output_path: &Path,
    progress_tx: Option<std::sync::mpsc::Sender<CompileProgress>>,
) -> Result<GenerateResult, String> {
    let send_progress = |stage: &str, message: &str, progress: Option<f64>| {
        if let Some(ref tx) = progress_tx {
            let _ = tx.send(CompileProgress {
                stage: stage.to_string(),
                message: message.to_string(),
                progress,
            });
        }
    };

    send_progress("init", "Generating agent configuration...", Some(0.0));

    // --- Step 0: Validate controller_address format ---
    validate_controller_address(&params.controller_address)?;

    // --- Step 1: Agent ID + auth token ---
    let auth_token = params.auth_token.clone();
    let agent_id = params
        .agent_id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let expires_at: Option<chrono::DateTime<chrono::Utc>> = params
        .expires_seconds
        .map(|s| chrono::Utc::now() + chrono::Duration::seconds(s as i64));

    send_progress("init", "Configuration generated.", Some(0.1));

    // --- Step 2: Resolve paths ---
    let target = go_target(&params.target_os)?;

    let go_toolchain_dir = resolve_resource(resources_dir, &["toolchains", "go"])
        .ok_or_else(|| format!(
            "Go toolchain not found. Looked in:\n  - {}/resources/toolchains/go\n  - {}/toolchains/go\nRun scripts/setup-go-toolchain.mjs first.",
            resources_dir.display(), resources_dir.display(),
        ))?;
    let go_bin = if cfg!(target_os = "windows") {
        go_toolchain_dir.join("bin").join("go.exe")
    } else {
        go_toolchain_dir.join("bin").join("go")
    };

    if !go_bin.exists() {
        return Err(format!("Go binary not found at: {}", go_bin.display()));
    }

    let mut agent_src_dir = resolve_resource(resources_dir, &["agent-go"])
        .ok_or_else(|| format!(
            "Agent Go source not found. Looked in:\n  - {}/resources/agent-go\n  - {}/agent-go",
            resources_dir.display(), resources_dir.display(),
        ))?;

    if has_spaced_numbered_go_files(&agent_src_dir) {
        if let Some(clean_dir) = find_clean_agent_source(resources_dir) {
            if clean_dir != agent_src_dir {
                tracing::warn!(
                    "Detected duplicate numbered Go files in {}. Falling back to clean source at {}",
                    agent_src_dir.display(),
                    clean_dir.display()
                );
                agent_src_dir = clean_dir;
            }
        }
    }

    if !agent_src_dir.join("main.go").exists() {
        return Err(format!("main.go not found in agent source dir: {}", agent_src_dir.display()));
    }

    let experience = resolve_experience(&params);
    let mode_label = match experience {
        AgentExperience::Minimal => "minimal",
        AgentExperience::Full => "full",
    };

    // --- Step 3: Build -ldflags with embedded config ---
    send_progress(
        "compile",
        &format!(
            "Compiling {} experience agent for {}...",
            mode_label, params.target_os
        ),
        Some(0.2),
    );

    let mut ldflags = vec!["-s".to_string(), "-w".to_string()];
    if target.goos == "windows" && experience == AgentExperience::Full {
        // Full Windows binaries should launch as GUI app (no console window).
        ldflags.push("-H=windowsgui".to_string());
    }

    ldflags.push(format!("-X main.embeddedAgentID={}", agent_id));
    ldflags.push(format!(
        "-X main.embeddedControllerAddress={}",
        params.controller_address
    ));
    ldflags.push(format!("-X main.embeddedAuthToken={}", auth_token));
    ldflags.push(format!(
        "-X main.embeddedUseTLS={}",
        if params.use_tls { "true" } else { "false" }
    ));

    if let Some(ref expires) = expires_at {
        ldflags.push(format!("-X main.embeddedExpiresAt={}", expires.to_rfc3339()));
    }

    if let Some(ref label) = params.label {
        // Go linker flag parsing is brittle with whitespace in -X values.
        // Keep a stable human-readable label while forcing single-token value.
        let safe_label = label.split_whitespace().collect::<Vec<_>>().join("_");
        ldflags.push(format!("-X main.embeddedLabel={safe_label}"));
    }

    ldflags.push("-X main.embeddedControllerName=SIPalyzer".to_string());
    ldflags.push(format!(
        "-X main.embeddedAgentProfile={}",
        experience.as_str()
    ));

    let ldflags_str = ldflags.join(" ");

    // --- Step 4: Invoke Go compilation ---
    send_progress(
        "compile",
        &format!("Building {} binary...", mode_label),
        Some(0.3),
    );

    // Temp dir for GOPATH and GOCACHE (avoid polluting the source tree)
    let tmp_dir = tempfile::tempdir()
        .map_err(|e| format!("Failed to create temp dir: {e}"))?;
    let tmp_gopath = tmp_dir.path().join("gopath");
    std::fs::create_dir_all(&tmp_gopath)
        .map_err(|e| format!("Failed to create temp GOPATH: {e}"))?;

    // Keep agent builds host-agnostic: no native C toolchain required.
    let cgo_flag = "0";
    // Both minimal and full run through the portable notray runtime.
    let base_tags = vec!["notray".to_string()];

    let run_build = |extra_tags: &[&str], use_vendor: bool| -> Result<std::process::Output, String> {
        let mut tags = base_tags.clone();
        tags.extend(extra_tags.iter().map(|t| t.to_string()));

        let mut build_args = vec![
            "build".to_string(),
            format!("-ldflags={}", ldflags_str),
            if use_vendor {
                "-mod=vendor".to_string()
            } else {
                "-mod=mod".to_string()
            },
        ];

        if !tags.is_empty() {
            build_args.push(format!("-tags={}", tags.join(",")));
        }

        build_args.extend_from_slice(&[
            "-o".to_string(),
            output_path.to_string_lossy().to_string(),
            ".".to_string(),
        ]);

        let mut cmd = Command::new(&go_bin);
        cmd.args(&build_args)
            .current_dir(&agent_src_dir)
            .env("GOOS", target.goos)
            .env("GOARCH", target.goarch)
            .env("CGO_ENABLED", cgo_flag)
            .env("GOFLAGS", "")
            .env("GOROOT", &go_toolchain_dir)
            .env("GOPATH", &tmp_gopath)
            .env("GOCACHE", tmp_dir.path().join("gocache"))
            .env("GOMODCACHE", tmp_dir.path().join("gomodcache"));
        if let Some(goarm) = target.goarm {
            cmd.env("GOARM", goarm);
        } else {
            cmd.env_remove("GOARM");
        }
        if let Some(gomips) = target.gomips {
            cmd.env("GOMIPS", gomips);
        } else {
            cmd.env_remove("GOMIPS");
        }
        if let Some(gomips64) = target.gomips64 {
            cmd.env("GOMIPS64", gomips64);
        } else {
            cmd.env_remove("GOMIPS64");
        }
        cmd.output()
            .map_err(|e| format!("Failed to execute Go compiler: {e}"))
    };

    let mut compile_result = run_build(&[], true)?;
    let first_stderr = String::from_utf8_lossy(&compile_result.stderr).to_string();
    if !compile_result.status.success()
        && first_stderr.contains("duplicated definition of symbol golang.org/x/sys/cpu.cpuid")
    {
        send_progress(
            "compile",
            "Retrying build with purego fallback due to Go linker cpuid conflict...",
            Some(0.55),
        );
        compile_result = run_build(&["purego"], true)?;
    }

    if !compile_result.status.success()
        && first_stderr.contains("redeclared in this block")
        && first_stderr.contains("vendor/")
    {
        send_progress(
            "compile",
            "Retrying build without vendored modules due to duplicate vendor files...",
            Some(0.6),
        );
        compile_result = run_build(&[], false)?;
        let retry_stderr = String::from_utf8_lossy(&compile_result.stderr).to_string();
        if !compile_result.status.success()
            && retry_stderr.contains("duplicated definition of symbol golang.org/x/sys/cpu.cpuid")
        {
            send_progress(
                "compile",
                "Retrying non-vendor build with purego fallback...",
                Some(0.65),
            );
            compile_result = run_build(&["purego"], false)?;
        }
    }

    if !compile_result.status.success() {
        let stderr = String::from_utf8_lossy(&compile_result.stderr);
        let stdout = String::from_utf8_lossy(&compile_result.stdout);
        return Err(format!(
            "Go compilation failed (exit code {:?}):\n{}\n{}",
            compile_result.status.code(),
            stderr,
            stdout,
        ));
    }

    send_progress("compile", "Compilation complete.", Some(0.8));

    if !output_path.exists() {
        return Err("Compilation succeeded but output binary not found.".to_string());
    }

    // Set executable permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(output_path, std::fs::Permissions::from_mode(0o755));
    }

    // --- Step 5: Platform-specific packaging ---
    let final_path = if target.goos == "darwin" && experience == AgentExperience::Full {
        send_progress("package", "Creating macOS app bundle...", Some(0.85));
        match create_macos_app_bundle(output_path, resources_dir) {
            Ok(bundle_path) => {
                send_progress("package", "App bundle created.", Some(0.9));
                bundle_path
            }
            Err(e) => {
                tracing::error!("Warning: Failed to create .app bundle: {e}. Using raw binary.");
                send_progress("package", "App bundle skipped (using raw binary).", Some(0.9));
                output_path.to_path_buf()
            }
        }
    } else if target.goos == "windows" {
        // Best-effort self-signing for portability. Do not fail generation when
        // signing tooling is unavailable on the host.
        send_progress("package", "Attempting to self-sign Windows executable...", Some(0.85));
        if let Err(err) = self_sign_windows_exe(output_path) {
            tracing::warn!("Windows self-sign skipped: {err}");
            send_progress("package", "Self-sign skipped (tooling unavailable).", Some(0.9));
        } else {
            send_progress("package", "Windows executable self-signed.", Some(0.9));
        }
        output_path.to_path_buf()
    } else {
        output_path.to_path_buf()
    };

    send_progress("done", "Agent binary ready.", Some(1.0));

    let config_summary = serde_json::json!({
        "agent_id": agent_id,
        "controller_address": params.controller_address,
        "use_tls": params.use_tls,
        "target_os": params.target_os,
        "expires_seconds": params.expires_seconds,
        "label": params.label,
        "experience": experience.as_str(),
        "effective_experience": experience.as_str(),
    });

    Ok(GenerateResult {
        binary_path: final_path.to_string_lossy().to_string(),
        auth_token,
        agent_id,
        config: config_summary,
    })
}

/// Create a macOS `.app` bundle around the compiled agent binary.
///
/// This wraps the binary in:
///   SIPalyzer Agent.app/
///     Contents/
///       Info.plist          (LSUIElement=true → no dock icon)
///       MacOS/
///         sipalyzer-agent   (the Go binary)
///       Resources/
///         icon.icns          (Finder & dock icon)
///
/// Returns the path to the `.app` directory.
#[allow(dead_code)]
fn create_macos_app_bundle(binary_path: &Path, resources_dir: &Path) -> Result<PathBuf, String> {
    let parent = binary_path
        .parent()
        .ok_or_else(|| "Cannot determine parent dir of binary".to_string())?;

    // Derive .app name from the user-chosen filename (e.g. "sipalyzer-agent-a1b2c3d4" → "sipalyzer-agent-a1b2c3d4.app")
    let stem = binary_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("SIPalyzer Agent");
    let app_dir = parent.join(format!("{stem}.app"));
    let contents_dir = app_dir.join("Contents");
    let macos_dir = contents_dir.join("MacOS");
    let res_dir = contents_dir.join("Resources");

    // Create directory structure
    std::fs::create_dir_all(&macos_dir)
        .map_err(|e| format!("Failed to create MacOS dir: {e}"))?;
    std::fs::create_dir_all(&res_dir)
        .map_err(|e| format!("Failed to create Resources dir: {e}"))?;

    // Move binary into the bundle
    let bundle_binary = macos_dir.join("sipalyzer-agent");
    std::fs::rename(binary_path, &bundle_binary)
        .or_else(|_| {
            // rename can fail across filesystems; try copy + delete
            std::fs::copy(binary_path, &bundle_binary)
                .map(|_| ())
                .and_then(|_| std::fs::remove_file(binary_path))
        })
        .map_err(|e| format!("Failed to move binary into bundle: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&bundle_binary, std::fs::Permissions::from_mode(0o755));
    }

    // Copy icon.icns into Resources/
    // We ship icon.icns inside agent-go/ so it's always available as a bundled resource.
    // Also try the standard Tauri icons directory as a fallback.
    let agent_src_dir = binary_path
        .parent()
        .unwrap_or(Path::new("."));
    let icon_candidates = [
        // Primary: icon.icns bundled alongside the agent Go source
        resources_dir.join("resources").join("agent-go").join("icon.icns"),
        resources_dir.join("agent-go").join("icon.icns"),
        // Fallback: Tauri icons directory (dev layout)
        resources_dir.join("resources").join("icons").join("icon.icns"),
        resources_dir.join("icons").join("icon.icns"),
        // Fallback: parent of resources (src-tauri/icons/)
        resources_dir
            .parent()
            .unwrap_or(resources_dir)
            .join("icons")
            .join("icon.icns"),
    ];
    let mut icon_found = false;
    for icon_src in &icon_candidates {
        if icon_src.exists() {
            let icon_dst = res_dir.join("icon.icns");
            std::fs::copy(icon_src, &icon_dst)
                .map_err(|e| format!("Failed to copy icon.icns: {e}"))?;
            icon_found = true;
            break;
        }
    }
    let _ = (icon_found, agent_src_dir); // suppress unused warnings

    // Write Info.plist
    let info_plist = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>sipalyzer-agent</string>
    <key>CFBundleIdentifier</key>
    <string>com.sipalyzer.agent</string>
    <key>CFBundleName</key>
    <string>SIPalyzer Agent</string>
    <key>CFBundleDisplayName</key>
    <string>SIPalyzer Agent</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>LSUIElement</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
"#;

    std::fs::write(contents_dir.join("Info.plist"), info_plist)
        .map_err(|e| format!("Failed to write Info.plist: {e}"))?;

    Ok(app_dir)
}

/// Self-sign a Windows executable using a locally generated certificate.
///
/// This produces a signature that is cryptographically valid but not publicly
/// trusted by default. It's useful for internal testing/distribution where
/// recipients can choose to trust the generated cert.
///
/// Tooling requirements:
/// - `openssl` (required, to generate key/cert/PFX)
/// - `osslsigncode` OR `signtool` (required, to apply Authenticode signature)
fn self_sign_windows_exe(exe_path: &Path) -> Result<(), String> {
    if !exe_path.exists() {
        return Err(format!("Cannot self-sign missing executable: {}", exe_path.display()));
    }

    if !has_command("openssl") {
        return Err(
            "Self-signing Windows executable requires 'openssl' on PATH.".to_string(),
        );
    }

    let tmp = tempfile::tempdir()
        .map_err(|e| format!("Failed to create temp dir for self-signing: {e}"))?;
    let key_pem = tmp.path().join("selfsign.key.pem");
    let cert_pem = tmp.path().join("selfsign.cert.pem");
    let cert_pfx = tmp.path().join("selfsign.cert.pfx");
    let signed_exe = tmp.path().join("signed.exe");

    // 1) Generate ephemeral self-signed cert + key
    let openssl_req = Command::new("openssl")
        .arg("req")
        .arg("-x509")
        .arg("-newkey")
        .arg("rsa:2048")
        .arg("-sha256")
        .arg("-days")
        .arg("3650")
        .arg("-nodes")
        .arg("-subj")
        .arg("/CN=SIPalyzer Remote Agent (Self-Signed)")
        .arg("-keyout")
        .arg(&key_pem)
        .arg("-out")
        .arg(&cert_pem)
        .output()
        .map_err(|e| format!("Failed to run openssl req: {e}"))?;
    if !openssl_req.status.success() {
        return Err(format!(
            "openssl req failed:\n{}",
            String::from_utf8_lossy(&openssl_req.stderr)
        ));
    }

    // 2) Export to PKCS#12 for signing tools
    let openssl_p12 = Command::new("openssl")
        .arg("pkcs12")
        .arg("-export")
        .arg("-out")
        .arg(&cert_pfx)
        .arg("-inkey")
        .arg(&key_pem)
        .arg("-in")
        .arg(&cert_pem)
        .arg("-passout")
        .arg("pass:")
        .output()
        .map_err(|e| format!("Failed to run openssl pkcs12: {e}"))?;
    if !openssl_p12.status.success() {
        return Err(format!(
            "openssl pkcs12 failed:\n{}",
            String::from_utf8_lossy(&openssl_p12.stderr)
        ));
    }

    // 3) Sign executable
    if has_command("osslsigncode") {
        let sign = Command::new("osslsigncode")
            .arg("sign")
            .arg("-pkcs12")
            .arg(&cert_pfx)
            .arg("-pass")
            .arg("")
            .arg("-h")
            .arg("sha256")
            .arg("-n")
            .arg("SIPalyzer Remote Agent")
            .arg("-i")
            .arg("https://sipalyzer.com")
            .arg("-in")
            .arg(exe_path)
            .arg("-out")
            .arg(&signed_exe)
            .output()
            .map_err(|e| format!("Failed to run osslsigncode: {e}"))?;
        if !sign.status.success() {
            return Err(format!(
                "osslsigncode sign failed:\n{}",
                String::from_utf8_lossy(&sign.stderr)
            ));
        }

        if !signed_exe.exists() {
            return Err("osslsigncode did not produce a signed output executable.".to_string());
        }

        std::fs::copy(&signed_exe, exe_path)
            .map_err(|e| format!("Failed to write signed executable: {e}"))?;
    } else if has_command("signtool") {
        let sign = Command::new("signtool")
            .arg("sign")
            .arg("/f")
            .arg(&cert_pfx)
            .arg("/p")
            .arg("")
            .arg("/fd")
            .arg("SHA256")
            .arg(exe_path)
            .output()
            .map_err(|e| format!("Failed to run signtool sign: {e}"))?;
        if !sign.status.success() {
            return Err(format!(
                "signtool sign failed:\n{}",
                String::from_utf8_lossy(&sign.stderr)
            ));
        }
    } else {
        return Err(
            "Cannot self-sign Windows executable: install 'osslsigncode' (recommended) or 'signtool'."
                .to_string(),
        );
    }

    Ok(())
}

/// Validate that `controller_address` is well-formed.
///
/// Accepts three formats:
/// - `host:port` (IPv4 / hostname, direct connection)
/// - `[ipv6]:port` (IPv6, direct connection)
/// - `relay.host/session/{id}` (relay URL, contains `/`)
///
/// Returns `Ok(())` if valid, or `Err(description)` if invalid.
fn validate_controller_address(addr: &str) -> Result<(), String> {
    if addr.is_empty() {
        return Err("Controller address is empty".to_string());
    }

    // Multi-endpoint format (optional): addr1|addr2|addr3
    // Validate each endpoint independently.
    if addr.contains('|') {
        let parts: Vec<&str> = addr
            .split('|')
            .map(|p| p.trim())
            .filter(|p| !p.is_empty())
            .collect();
        if parts.is_empty() {
            return Err("Controller address list is empty".to_string());
        }
        for part in parts {
            validate_controller_address(part)?;
        }
        return Ok(());
    }

    // Relay-style URL: contains a path component (e.g. "relay.zyfi.io/session/abc123")
    if addr.contains('/') {
        let parts: Vec<&str> = addr.splitn(2, '/').collect();
        let host = parts[0];
        if host.is_empty() {
            return Err(format!("Empty host in relay address '{addr}'"));
        }
        let path = parts[1];
        if path.is_empty() {
            return Err(format!("Empty path in relay address '{addr}'"));
        }
        return Ok(());
    }

    // IPv6 bracket form: [::1]:9147
    if addr.starts_with('[') {
        let close = addr.find(']').ok_or_else(|| {
            format!("Invalid IPv6 address format: missing closing bracket in '{addr}'")
        })?;
        let host = &addr[1..close];
        if host.is_empty() {
            return Err(format!("Empty IPv6 host in '{addr}'"));
        }
        let rest = &addr[close + 1..];
        if !rest.starts_with(':') {
            return Err(format!("Expected ':port' after IPv6 address in '{addr}'"));
        }
        let port_str = &rest[1..];
        let port: u16 = port_str
            .parse()
            .map_err(|_| format!("Invalid port '{port_str}' in '{addr}' (must be 1-65535)"))?;
        if port == 0 {
            return Err(format!("Port must be 1-65535, got 0 in '{addr}'"));
        }
        return Ok(());
    }

    // IPv4 / hostname form: host:port
    let colon_count = addr.matches(':').count();
    if colon_count != 1 {
        return Err(format!(
            "Invalid controller address '{addr}': expected exactly one ':' separating host and port (got {colon_count})"
        ));
    }

    let parts: Vec<&str> = addr.splitn(2, ':').collect();
    let host = parts[0];
    let port_str = parts[1];

    if host.is_empty() {
        return Err(format!("Empty host in controller address '{addr}'"));
    }

    let port: u16 = port_str
        .parse()
        .map_err(|_| format!("Invalid port '{port_str}' in '{addr}' (must be 1-65535)"))?;
    if port == 0 {
        return Err(format!("Port must be 1-65535, got 0 in '{addr}'"));
    }

    Ok(())
}

fn has_command(cmd: &str) -> bool {
    #[cfg(target_os = "windows")]
    let output = Command::new("where").arg(cmd).output();
    #[cfg(not(target_os = "windows"))]
    let output = Command::new("which").arg(cmd).output();

    output.map(|o| o.status.success()).unwrap_or(false)
}


/// Resolve a resource path, trying with and without the `resources/` prefix.
/// Tauri puts resources in different locations during development vs production.
fn resolve_resource(base: &Path, segments: &[&str]) -> Option<PathBuf> {
    // Try with resources/ prefix first (dev + production bundle layout)
    let mut with_prefix = base.join("resources");
    for seg in segments {
        with_prefix = with_prefix.join(seg);
    }
    if with_prefix.exists() {
        return Some(with_prefix);
    }

    // Try without prefix (fallback)
    let mut without_prefix = base.to_path_buf();
    for seg in segments {
        without_prefix = without_prefix.join(seg);
    }
    if without_prefix.exists() {
        return Some(without_prefix);
    }

    // Try walking up ancestors and resolving there.
    for ancestor in base.ancestors() {
        let mut anc_with_prefix = ancestor.join("resources");
        for seg in segments {
            anc_with_prefix = anc_with_prefix.join(seg);
        }
        if anc_with_prefix.exists() {
            return Some(anc_with_prefix);
        }

        let mut anc_without_prefix = ancestor.to_path_buf();
        for seg in segments {
            anc_without_prefix = anc_without_prefix.join(seg);
        }
        if anc_without_prefix.exists() {
            return Some(anc_without_prefix);
        }
    }

    None
}

fn has_spaced_numbered_go_files(dir: &Path) -> bool {
    fn scan(path: &Path) -> bool {
        let Ok(entries) = std::fs::read_dir(path) else {
            return false;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                if scan(&p) {
                    return true;
                }
                continue;
            }
            if p.extension().and_then(|e| e.to_str()) != Some("go") {
                continue;
            }
            let Some(name) = p.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            // Matches files like "audio_gen 2.go", "auth 3.go", etc.
            if let Some((base, _ext)) = name.rsplit_once(".go") {
                if let Some((_, suffix)) = base.rsplit_once(' ') {
                    if suffix.chars().all(|c| c.is_ascii_digit()) {
                        return true;
                    }
                }
            }
        }
        false
    }
    scan(dir)
}

fn find_clean_agent_source(resources_dir: &Path) -> Option<PathBuf> {
    for ancestor in resources_dir.ancestors() {
        let candidates = [
            ancestor.join("resources").join("agent-go"),
            ancestor.join("agent-go"),
        ];
        for candidate in candidates {
            if candidate.exists()
                && candidate.join("go.mod").exists()
                && !has_spaced_numbered_go_files(&candidate)
            {
                return Some(candidate);
            }
        }
    }
    None
}
