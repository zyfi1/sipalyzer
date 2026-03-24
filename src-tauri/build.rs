//! Build script for SIPalyzer with SpanDSP integration.
//!
//! This build script supports two modes:
//! 1. Development: Links to system SpanDSP (via Homebrew)
//! 2. Distribution: Uses bundled libraries in vendor/libs/
//!
//! For distribution builds, the libraries are bundled into the app.

use std::env;
use std::path::PathBuf;

fn main() {
    // Always run Tauri build
    tauri_build::build();

    // Vosk STT is a regular dependency, so always configure its library path when
    // bundled artifacts are present for the active target.
    link_vosk();

    // Strict agnostic mode (default): skip SpanDSP host-native probing/tooling.
    // Opt in with `--features native_extensions` when native SpanDSP integration
    // is explicitly desired for local/dev or distribution builds.
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
        eprintln!("build.rs: using bundled SpanDSP libraries from {}", bundle_dir.display());
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
        // Generate bindings using bundled headers only (strict agnostic native path).
        let bundled_include = bundle_dir.join("include");
        if bundled_include.exists() {
            compile_native_udptl(&bundled_include);
            generate_bindings(&bundled_include, &out_dir);
            native_bindings_ready = true;
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
    println!("cargo:warning=Provide packaged SpanDSP + libtiff artifacts to enable cross-platform fax.");
}

/// Compile SpanDSP's native UDPTL (ITU-T T.38 Annex D) implementation.
/// This is the battle-tested encoder/decoder used by FreeSWITCH, Asterisk, etc.
fn compile_native_udptl(spandsp_include: &PathBuf) {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let udptl_c = manifest_dir.join("vendor").join("spandsp").join("tests").join("udptl.c");
    let udptl_h_dir = manifest_dir.join("vendor").join("spandsp").join("tests");
    
    if !udptl_c.exists() {
        println!("cargo:warning=SpanDSP udptl.c not found at {:?}, skipping native UDPTL", udptl_c);
        return;
    }
    
    eprintln!("build.rs: compiling native SpanDSP UDPTL from {:?}", udptl_c);
    println!("cargo:rerun-if-changed={}", udptl_c.display());
    
    cc::Build::new()
        .file(&udptl_c)
        .include(spandsp_include)
        .include(&udptl_h_dir)
        // Required for access to SpanDSP internal structures (logging_state_t fields, etc.)
        .define("SPANDSP_EXPOSE_INTERNAL_STRUCTURES", None)
        .define("HAVE_STDBOOL_H", None)
        // Provide span_alloc/span_free (internal SpanDSP functions not in the public API)
        .include(&udptl_h_dir) // contains udptl_compat.h
        .flag("-include")
        .flag(&udptl_h_dir.join("udptl_compat.h").to_string_lossy().into_owned())
        .warnings(false)
        .compile("udptl");
}

fn generate_bindings(include_path: &PathBuf, out_dir: &PathBuf) {
    // Create a wrapper header
    let wrapper_content = r#"
// SpanDSP wrapper header for bindgen
#include <spandsp.h>
"#;
    
    let wrapper_path = out_dir.join("spandsp_wrapper.h");
    std::fs::write(&wrapper_path, wrapper_content).expect("Failed to write wrapper header");
    
    println!("cargo:rerun-if-changed=build.rs");
    
    let bindings = bindgen::Builder::default()
        .header(wrapper_path.to_string_lossy())
        .clang_arg(format!("-I{}", include_path.display()))
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
    bindings.write_to_file(&bindings_path).expect("Failed to write bindings");
    
    eprintln!("build.rs: generated SpanDSP bindings at {:?}", bindings_path);
}

