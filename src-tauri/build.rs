//! Build script for SIPalyzer with SpanDSP integration.
//!
//! This build script supports two modes:
//! 1. Development: Links to system SpanDSP (via Homebrew)
//! 2. Distribution: Uses bundled libraries in vendor/libs/
//!
//! For distribution builds, the libraries are bundled into the app.

use std::env;
use std::path::{Path, PathBuf};

fn main() {
    // Always run Tauri build
    tauri_build::build();
    println!("cargo:rerun-if-env-changed=SIPALYZER_DISABLE_NATIVE_UDPTL");

    // Vosk STT is a regular dependency, so always configure its library path when
    // bundled artifacts are present for the active target.
    link_vosk();

    // SpanDSP is on by default (`native_extensions` in default features).
    // Disable with `cargo build --no-default-features` when vendor libs are absent.
    if native_extensions_enabled() {
        link_spandsp();
    } else {
        println!("cargo:warning=native_extensions disabled; skipping SpanDSP native build steps.");
    }

    // Link macOS Foundation framework (used by various system integrations)
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=Foundation");
    }

    // Windows target: ship runtime DLLs next to the .exe (SpanDSP, TIFF, Vosk, MinGW, wpcap/Packet shims).
    // Live interface capture still needs an Npcap (or WinPcap) driver install — not bundled; PCAP file features work without it.
    // Use TARGET (not cfg!(target_os): build.rs is built for the host).
    if target_triple().contains("windows") {
        copy_windows_runtime_dlls_next_to_exe();
    }
}

/// Copy bundled `vendor/libs/<target>/*.dll` into `target/<profile>/` so `sipalyzer.exe` and the NSIS bundle resolve dependencies.
fn copy_windows_runtime_dlls_next_to_exe() {
    let bundle_dir = native_bundle_dir();
    if !bundle_dir.is_dir() {
        return;
    }

    let Ok(profile) = env::var("PROFILE") else {
        return;
    };
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let target_dir = env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest_dir.join("target"));
    let dest_dir = target_dir.join(&profile);
    if let Err(e) = std::fs::create_dir_all(&dest_dir) {
        println!(
            "cargo:warning=could not create {}: {}",
            dest_dir.display(),
            e
        );
        return;
    }

    let entries = match std::fs::read_dir(&bundle_dir) {
        Ok(e) => e,
        Err(e) => {
            println!(
                "cargo:warning=could not read {}: {}",
                bundle_dir.display(),
                e
            );
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("dll") {
            continue;
        }
        let Some(name) = path.file_name() else {
            continue;
        };
        let dest = dest_dir.join(name);
        match std::fs::copy(&path, &dest) {
            Ok(_) => {
                eprintln!("build.rs: copied {} -> {}", path.display(), dest.display());
                println!("cargo:rerun-if-changed={}", path.display());
            }
            Err(e) => println!(
                "cargo:warning=failed to copy DLL {} to {}: {}",
                path.display(),
                dest.display(),
                e
            ),
        }
    }
}

fn native_extensions_enabled() -> bool {
    // Cargo exposes enabled features to build scripts via CARGO_FEATURE_<NAME>.
    env::var_os("CARGO_FEATURE_NATIVE_EXTENSIONS").is_some()
}

fn target_triple() -> String {
    env::var("TARGET").unwrap_or_else(|_| "unknown-target".to_string())
}

fn native_bundle_dir() -> PathBuf {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    manifest_dir
        .join("vendor")
        .join("libs")
        .join(target_triple())
}

fn link_vosk() {
    // Set VOSK_PATH so vosk-sys can find libvosk at link time.
    let bundle_dir = native_bundle_dir();
    let vosk_lib_name = if cfg!(target_os = "windows") {
        "libvosk.dll"
    } else if cfg!(target_os = "linux") {
        "libvosk.so"
    } else {
        "libvosk.dylib"
    };
    let has_vosk = bundle_dir.join(vosk_lib_name).exists();
    if has_vosk {
        println!("cargo:rustc-link-search=native={}", bundle_dir.display());
        #[cfg(target_os = "macos")]
        println!("cargo:rustc-link-arg=-Wl,-rpath,{}", bundle_dir.display());
        // Only set VOSK_PATH if not already set (vosk-sys uses this)
        if env::var("VOSK_PATH").is_err() {
            env::set_var("VOSK_PATH", &bundle_dir);
        }
    } else {
        println!(
            "cargo:warning=Bundled Vosk library '{}' not found in {}. STT native path disabled.",
            vosk_lib_name,
            bundle_dir.display()
        );
    }
}

fn link_spandsp() {
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let bundle_dir = native_bundle_dir();

    let bundled_spandsp = if cfg!(target_os = "windows") {
        bundle_dir.join("spandsp.dll")
    } else if cfg!(target_os = "linux") {
        bundle_dir.join("libspandsp.so")
    } else {
        bundle_dir.join("libspandsp.dylib")
    };
    let bundled_tiff = if cfg!(target_os = "windows") {
        bundle_dir.join("tiff.dll")
    } else if cfg!(target_os = "linux") {
        bundle_dir.join("libtiff.so")
    } else {
        bundle_dir.join("libtiff.dylib")
    };

    if bundled_spandsp.exists() && bundled_tiff.exists() {
        eprintln!(
            "build.rs: using bundled SpanDSP libraries from {}",
            bundle_dir.display()
        );

        // Bundled Windows DLLs are built with MinGW; linking + compiling UDPTL/bindgen with MSVC
        // hits incompatible CRT, missing jpeg headers, and symbol clashes. Ship DLLs next to the
        // exe (see copy step) but use Rust fax fallbacks (`spandsp-native` off) for this target.
        if target_triple().contains("msvc") {
            println!("cargo:warning=Windows MSVC: SpanDSP/TIFF DLLs are packaged but not linked at build time; fax/T.38 uses Rust fallbacks until a MSVC-safe native path exists.");
            return;
        }

        println!("cargo:rustc-link-search=native={}", bundle_dir.display());
        println!("cargo:rustc-link-lib=dylib=spandsp");
        println!("cargo:rustc-link-lib=dylib=tiff");

        // Set rpath for bundled libraries in macOS app bundle
        // The frameworks are placed in Contents/Frameworks/
        #[cfg(target_os = "macos")]
        {
            println!("cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks");
        }

        let mut native_bindings_ready = false;
        let bundled_include = bundle_dir.join("include");
        if bundled_include.exists() {
            if compile_native_udptl(&bundled_include) {
                generate_bindings(&bundled_include, &out_dir);
                native_bindings_ready = true;
            } else {
                println!(
                    "cargo:warning=UDPTL native compile is unavailable (disabled or incompatible headers); using non-native fax path."
                );
            }
        }

        if native_bindings_ready {
            println!("cargo:rustc-cfg=feature=\"spandsp-native\"");
        } else {
            println!("cargo:warning=SpanDSP native bindings not generated; using fallback fax implementation.");
        }
        return;
    }
    let _ = out_dir;
    println!(
        "cargo:warning=Bundled SpanDSP libraries not found in {} for this target. Fax native path disabled.",
        bundle_dir.display()
    );
    println!(
        "cargo:warning=Provide packaged SpanDSP + libtiff artifacts to enable cross-platform fax."
    );
}

/// Compile SpanDSP's native UDPTL (ITU-T T.38 Annex D) implementation.
/// This is the battle-tested encoder/decoder used by FreeSWITCH, Asterisk, etc.
fn compile_native_udptl(spandsp_include: &Path) -> bool {
    if env::var("SIPALYZER_DISABLE_NATIVE_UDPTL").ok().as_deref() == Some("1") {
        println!(
            "cargo:warning=Skipping native SpanDSP udptl.c compile because SIPALYZER_DISABLE_NATIVE_UDPTL=1."
        );
        return false;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let udptl_c = manifest_dir
        .join("vendor")
        .join("spandsp")
        .join("tests")
        .join("udptl.c");
    let udptl_h_dir = manifest_dir.join("vendor").join("spandsp").join("tests");
    let compat_hdr = udptl_h_dir.join("udptl_compat.h");

    if !udptl_c.exists() {
        println!(
            "cargo:warning=SpanDSP udptl.c not found at {:?}, skipping native UDPTL",
            udptl_c
        );
        return false;
    }

    eprintln!(
        "build.rs: compiling native SpanDSP UDPTL from {:?}",
        udptl_c
    );
    println!("cargo:rerun-if-changed={}", udptl_c.display());

    let libtiff_include = manifest_dir.join("vendor").join("libtiff").join("libtiff");
    let libtiff_config = libtiff_include.join("config");
    let mut build = cc::Build::new();
    build
        .file(&udptl_c)
        .include(spandsp_include)
        .include(&udptl_h_dir)
        .define("SPANDSP_EXPOSE_INTERNAL_STRUCTURES", None)
        .define("HAVE_STDBOOL_H", None)
        .warnings(false);
    if libtiff_include.join("tiffio.h").is_file() {
        build.include(&libtiff_include);
    }
    if libtiff_config.join("tiffconf.h").is_file() {
        build.include(&libtiff_config);
    }
    let target = env::var("TARGET").unwrap_or_default();
    if target.contains("msvc") {
        build.flag(format!("/FI{}", compat_hdr.display()));
    } else {
        build
            .flag("-include")
            .flag(compat_hdr.to_string_lossy().as_ref());
    }

    match build.try_compile("udptl") {
        Ok(()) => true,
        Err(err) => {
            println!("cargo:warning=SpanDSP UDPTL compile failed: {err}");
            false
        }
    }
}

fn generate_bindings(include_path: &Path, out_dir: &Path) {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let libtiff_include = manifest_dir.join("vendor").join("libtiff").join("libtiff");
    let libtiff_config = libtiff_include.join("config");

    // Create a wrapper header
    let wrapper_content = r#"
// SpanDSP wrapper header for bindgen
#include <spandsp.h>
"#;

    let wrapper_path = out_dir.join("spandsp_wrapper.h");
    std::fs::write(&wrapper_path, wrapper_content).expect("Failed to write wrapper header");

    println!("cargo:rerun-if-changed=build.rs");

    let mut builder = bindgen::Builder::default()
        .header(wrapper_path.to_string_lossy())
        .clang_arg(format!("-I{}", include_path.display()));
    if libtiff_include.join("tiffio.h").is_file() {
        builder = builder.clang_arg(format!("-I{}", libtiff_include.display()));
    }
    if libtiff_config.join("tiffconf.h").is_file() {
        builder = builder.clang_arg(format!("-I{}", libtiff_config.display()));
    }
    let bindings = builder
        // Only generate bindings for fax-related functions/types
        .allowlist_function("t30_.*")
        .allowlist_function("t38_.*")
        .allowlist_function("t4_.*")
        .allowlist_function("fax_.*")
        .allowlist_function("logging_.*")
        .allowlist_function("span_log.*")
        // Types
        .allowlist_type("t30_state_t")
        .allowlist_type("t30_stats_t")
        .allowlist_type("t38_core_state_t")
        .allowlist_type("t38_terminal_state_t")
        .allowlist_type("t38_gateway_state_t")
        .allowlist_type("fax_state_t")
        .allowlist_type("logging_state_t")
        // Constants
        .allowlist_var("T30_.*")
        .allowlist_var("T38_.*")
        .allowlist_var("FAX_.*")
        .allowlist_var("T4_.*")
        // Generate traits
        .derive_debug(true)
        .derive_default(true)
        // Skip layout tests (can fail on cross-compilation)
        .layout_tests(false)
        // Opaque types for internal structs
        .opaque_type("_.*")
        .generate()
        .expect("Failed to generate SpanDSP bindings");

    let bindings_path = out_dir.join("spandsp_bindings.rs");
    bindings
        .write_to_file(&bindings_path)
        .expect("Failed to write bindings");

    eprintln!(
        "build.rs: generated SpanDSP bindings at {:?}",
        bindings_path
    );
}
