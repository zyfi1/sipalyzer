//! Tauri commands for the integrated terminal emulator.
//!
//! Spawns a real PTY (pseudo-terminal) with the user's preferred shell,
//! streams output via Tauri events, and accepts input via commands.

use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::command;
use tauri::Emitter;
use tauri::Manager;

/// A live terminal session: PTY master (for read/write) + child process handle.
struct TerminalSession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
}

/// Global map of session_id -> TerminalSession.
static SESSIONS: Lazy<Mutex<HashMap<String, TerminalSession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Payload emitted to the frontend for terminal output.
#[derive(Clone, Serialize)]
struct TerminalOutputPayload {
    session_id: String,
    data: String,
}

// ---------------------------------------------------------------------------
// Shell detection
// ---------------------------------------------------------------------------

/// Determine the user's preferred shell, with platform-specific fallbacks.
fn default_shell() -> String {
    // 1. Respect the user's configured shell (Unix: $SHELL)
    if let Ok(shell) = std::env::var("SHELL") {
        return shell;
    }
    // 2. Platform-specific defaults
    if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else if cfg!(target_os = "macos") {
        "/bin/zsh".to_string()
    } else {
        "/bin/bash".to_string()
    }
}

/// Returns true when the resolved shell path ends with "zsh".
fn is_zsh(shell: &str) -> bool {
    std::path::Path::new(shell)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n == "zsh")
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Custom zsh prompt (ZDOTDIR injection)
// ---------------------------------------------------------------------------

/// When spawning zsh, create a temp ZDOTDIR with a `.zshrc` that:
///   1. Sources the user's real `~/.zshrc` (so aliases, PATH, etc. are preserved).
///   2. Loads bundled zsh plugins (autosuggestions, syntax-highlighting, completions).
///   3. Overrides the prompt with the SIPalyzer-themed prompt.
///
/// `plugins_dir` — optional path to the bundled zsh-plugins resource directory.
///
/// Returns the path to the temp ZDOTDIR directory.
fn create_zsh_zdotdir(plugins_dir: Option<std::path::PathBuf>) -> Result<std::path::PathBuf, String> {
    let dir = std::env::temp_dir().join(format!("sipalyzer-zsh-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create ZDOTDIR: {}", e))?;

    // Build plugins block only when the bundled plugins directory exists
    let plugins_block = if let Some(ref pdir) = plugins_dir {
        let p = pdir.to_string_lossy();
        format!(
            r##"
# ── Bundled Plugins ──────────────────────────────────────────────
_sipalyzer_plugins="{plugins_dir}"
if [[ -n "$_sipalyzer_plugins" ]]; then
  # zsh-completions: add to fpath before compinit
  if [[ -d "$_sipalyzer_plugins/zsh-completions/src" ]]; then
    fpath=("$_sipalyzer_plugins/zsh-completions/src" $fpath)
    autoload -Uz compinit && compinit -C
  fi

  # zsh-autosuggestions
  if [[ -f "$_sipalyzer_plugins/zsh-autosuggestions/zsh-autosuggestions.zsh" ]]; then
    ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE="fg=#4C566A"
    ZSH_AUTOSUGGEST_STRATEGY=(history completion)
    source "$_sipalyzer_plugins/zsh-autosuggestions/zsh-autosuggestions.zsh"
  fi

  # zsh-syntax-highlighting (MUST be sourced last among plugins)
  if [[ -f "$_sipalyzer_plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh" ]]; then
    ZSH_HIGHLIGHT_HIGHLIGHTERS=(main brackets)
    typeset -A ZSH_HIGHLIGHT_STYLES
    ZSH_HIGHLIGHT_STYLES[command]='fg=#A3BE8C'
    ZSH_HIGHLIGHT_STYLES[builtin]='fg=#A3BE8C'
    ZSH_HIGHLIGHT_STYLES[alias]='fg=#A3BE8C'
    ZSH_HIGHLIGHT_STYLES[unknown-token]='fg=#BF616A'
    ZSH_HIGHLIGHT_STYLES[path]='fg=#81A1C1,underline'
    ZSH_HIGHLIGHT_STYLES[globbing]='fg=#EBCB8B'
    ZSH_HIGHLIGHT_STYLES[single-quoted-argument]='fg=#A3BE8C'
    ZSH_HIGHLIGHT_STYLES[double-quoted-argument]='fg=#A3BE8C'
    ZSH_HIGHLIGHT_STYLES[comment]='fg=#4C566A'
    ZSH_HIGHLIGHT_STYLES[commandseparator]='fg=#88C0D0'
    ZSH_HIGHLIGHT_STYLES[redirection]='fg=#88C0D0'
    source "$_sipalyzer_plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
  fi
fi
"##,
            plugins_dir = p,
        )
    } else {
        String::new()
    };

    let zshrc_content = format!(
        r##"# SIPalyzer Terminal — custom ZDOTDIR
# Source user's original config first
_sipalyzer_original_zdotdir="$HOME"
if [[ -f "$HOME/.zshrc" ]]; then
  ZDOTDIR="$HOME"
  source "$HOME/.zshrc"
fi
{plugins_block}
# ── SIPalyzer Prompt (Nord) ───────────────────────────────────────
# Truecolor escapes matching the Nord color palette.
# Uses $'...' (ANSI-C quoting) so \e is interpreted as ESC (0x1B).
_sipalyzer_prompt() {{
  local ec=$?

  # Colors — truecolor, matching Nord theme palette
  local frost_blue=$'%{{\e[38;2;129;161;193m%}}'   # Nord9  Frost Blue    #81A1C1
  local frost_cyan=$'%{{\e[38;2;136;192;208m%}}'    # Nord8  Frost Cyan    #88C0D0
  local frost_teal=$'%{{\e[38;2;143;188;187m%}}'    # Nord7  Frost Teal    #8FBCBB
  local green=$'%{{\e[38;2;163;190;140m%}}'          # Nord14 Aurora Green  #A3BE8C
  local yellow=$'%{{\e[38;2;235;203;139m%}}'         # Nord13 Aurora Yellow #EBCB8B
  local red=$'%{{\e[38;2;191;97;106m%}}'             # Nord11 Aurora Red    #BF616A
  local snow=$'%{{\e[38;2;216;222;233m%}}'           # Nord4  Snow Storm    #D8DEE9
  local comment=$'%{{\e[38;2;76;86;106m%}}'          # Nord3  Polar Night   #4C566A
  local bold=$'%{{\e[1m%}}'
  local reset=$'%{{\e[0m%}}'

  # Working directory in Nord Frost Blue
  local dir="${{frost_blue}}%~${{reset}}"

  # Git branch + dirty status
  local git_info=""
  if command git rev-parse --is-inside-work-tree &>/dev/null; then
    local branch
    branch=$(command git symbolic-ref --short HEAD 2>/dev/null) || \
    branch=$(command git rev-parse --short HEAD 2>/dev/null)
    if [[ -n "$branch" ]]; then
      if [[ -z "$(command git status --porcelain 2>/dev/null)" ]]; then
        git_info=" ${{comment}}on${{reset}} ${{green}}${{branch}}${{reset}}"
      else
        git_info=" ${{comment}}on${{reset}} ${{yellow}}${{branch}}${{reset}}"
      fi
    fi
  fi

  # Prompt character: cyan on success, red on error
  local pchar
  if (( ec == 0 )); then
    pchar="${{frost_cyan}}${{bold}}❯${{reset}}"
  else
    pchar="${{red}}${{bold}}❯${{reset}}"
  fi

  PROMPT="${{dir}}${{git_info}} ${{pchar}} "
}}

precmd_functions+=(_sipalyzer_prompt)
"##,
        plugins_block = plugins_block,
    );

    let zshrc_path = dir.join(".zshrc");
    std::fs::write(&zshrc_path, zshrc_content)
        .map_err(|e| format!("Failed to write .zshrc: {}", e))?;

    Ok(dir)
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Spawn a new terminal session. Returns the session ID.
#[command]
#[tracing::instrument(skip_all)]
pub async fn terminal_spawn(
    app: tauri::AppHandle,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let pty_system = native_pty_system();

    let size = PtySize {
        rows: rows.unwrap_or(24),
        cols: cols.unwrap_or(80),
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let shell = default_shell();
    let mut cmd = CommandBuilder::new(&shell);

    // If zsh, inject our custom ZDOTDIR for the SIPalyzer prompt + plugins
    if is_zsh(&shell) {
        // Resolve bundled zsh-plugins resource directory.
        // In production builds, Tauri copies bundle.resources into the resource_dir.
        // In dev mode (`tauri dev`), resources are NOT copied, so we fall back
        // to the source tree using CARGO_MANIFEST_DIR (points to src-tauri/).
        let resource_dir = app.path().resource_dir().ok();

        let mut candidates: Vec<std::path::PathBuf> = Vec::new();

        // Production: bundled resources inside the app package
        if let Some(ref rd) = resource_dir {
            candidates.push(rd.join("resources").join("zsh-plugins"));
            candidates.push(rd.join("zsh-plugins"));
        }

        // Dev mode: fall back to the source tree (src-tauri/resources/zsh-plugins)
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        candidates.push(manifest_dir.join("resources").join("zsh-plugins"));

        let plugins_dir = candidates.into_iter().find(|p| {
            // Verify the autosuggestions file actually exists, not just the directory
            p.join("zsh-autosuggestions").join("zsh-autosuggestions.zsh").exists()
        });

        tracing::info!("resource_dir = {:?}", resource_dir);
        tracing::info!("plugins_dir = {:?}", plugins_dir);

        match create_zsh_zdotdir(plugins_dir) {
            Ok(zdotdir) => {
                cmd.env("ZDOTDIR", zdotdir.to_string_lossy().to_string());
            }
            Err(e) => {
                tracing::warn!("Failed to create ZDOTDIR: {}", e);
                // Fall through — zsh will use the user's default config
            }
        }
    }

    // Set TERM for proper escape sequence support
    cmd.env("TERM", "xterm-256color");
    // Advertise truecolor (24-bit) support — many modern CLI tools check this
    cmd.env("COLORTERM", "truecolor");
    // Enable colored output for macOS coreutils (ls, grep, etc.)
    cmd.env("CLICOLOR", "1");
    cmd.env("CLICOLOR_FORCE", "1");
    // Ensure proper UTF-8 locale for unicode glyphs / emoji
    if std::env::var("LANG").unwrap_or_default().is_empty() {
        cmd.env("LANG", "en_US.UTF-8");
    }
    // Mark as SIPalyzer terminal for any user customization
    cmd.env("SIPALYZER_TERMINAL", "1");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Get writer for stdin
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    // Get reader for stdout — spawn a thread to read and emit events
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

    let sid = session_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    // PTY output is raw bytes; convert to string (lossy for safety)
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(
                        "terminal:output",
                        TerminalOutputPayload {
                            session_id: sid.clone(),
                            data,
                        },
                    );
                }
                Err(e) => {
                    tracing::error!("Read error for session {}: {}", sid, e);
                    break;
                }
            }
        }
    });

    // Store session
    {
        let mut sessions = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
        sessions.insert(
            session_id.clone(),
            TerminalSession {
                writer,
                master: pair.master,
                child,
            },
        );
    }

    Ok(session_id)
}

/// Write data (keystrokes) to a terminal session's PTY stdin.
#[command]
#[tracing::instrument(skip_all)]
pub fn terminal_write(session_id: String, data: String) -> Result<(), String> {
    let mut sessions = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("No terminal session: {}", session_id))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Flush failed: {}", e))?;
    Ok(())
}

/// Resize a terminal session's PTY.
#[command]
#[tracing::instrument(skip_all)]
pub fn terminal_resize(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| format!("No terminal session: {}", session_id))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {}", e))?;
    Ok(())
}

/// Kill a terminal session and clean up resources.
#[command]
#[tracing::instrument(skip_all)]
pub fn terminal_kill(session_id: String) -> Result<(), String> {
    let mut sessions = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.child.kill();
        // Dropping the session closes the PTY master, which causes the reader thread to exit.
    }
    Ok(())
}

/// Validate terminal runtime readiness for bridge SSH bootstrapping.
///
/// This opens a lightweight PTY and immediately drops it to verify the
/// backend runtime can service terminal requests before frontend dispatches
/// SSH bridge/tunnel commands.
#[command]
#[tracing::instrument(skip_all)]
pub fn terminal_ensure_runtime_ready() -> Result<(), String> {
    let pty_system = native_pty_system();
    let size = PtySize {
        rows: 1,
        cols: 1,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Terminal runtime not ready: {}", e))?;
    drop(pair);
    Ok(())
}
