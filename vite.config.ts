import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const projectRoot = path.resolve(__dirname);

// https://vitejs.dev/config/
export default defineConfig(async () => {
  const isDev = process.env.TAURI_DEBUG !== undefined || process.env.NODE_ENV === "development";

  return {
    plugins: [
      tailwindcss(),
      react({
        // Enable Fast Refresh / HMR
        fastRefresh: true,
      }),
    ],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      // Prevent long pre-transform waterfalls from stalling first response in Tauri WebView.
      preTransformRequests: false,
      // Bind explicitly to IPv4 loopback to avoid localhost DNS/IPv6 timeouts in WebView.
      host: "127.0.0.1",
      hmr: isDev ? {
        host: "127.0.0.1",
        port: 1420,
      } : false,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "./src"),
      },
      conditions: ["module", "browser", "import", "default"],
      // Single React instance so ReactSharedInternals.ReactCurrentOwner is defined (path aliases can break pre-bundle)
      dedupe: ["react", "react-dom", "react-is", "scheduler"],
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client", "react-is", "scheduler"],
      // Avoid blocking initial HTTP responses in dev while dependency crawl runs.
      holdUntilCrawlEnd: false,
      // Start dep discovery from app entry so React is resolved first (helps ReactSharedInternals in dev)
      entries: [path.resolve(projectRoot, "index.html")],
    },
    envPrefix: ["VITE_", "TAURI_"],
    build: {
      target: process.env.TAURI_PLATFORM == "windows" ? "chrome105" : "safari13",
      minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
      sourcemap: !!process.env.TAURI_DEBUG,
      chunkSizeWarningLimit: 5000,
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          // Suppress Rollup "comment will be removed" warnings from @hugeicons (/*#__PURE__*/ position)
          const msg = warning.message && typeof warning.message === "string";
          if (msg && warning.message.includes("contains an annotation that Rollup cannot interpret")) {
            return;
          }
          defaultHandler(warning);
        },
        output: {
          manualChunks: (id) => {
            // Single React chunk so ReactSharedInternals is never duplicated
            if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/react-is/") || id.includes("node_modules/scheduler/")) return "react";
            if (id.includes("node_modules/@tauri-apps")) return "tauri";
            if (id.includes("node_modules/recharts")) return "recharts";
            if (id.includes("node_modules/mermaid")) return "mermaid";
            if (id.includes("node_modules/vis-timeline") || id.includes("node_modules/vis-data")) return "vis-timeline";
            if (id.includes("node_modules")) return "vendor";
          },
        },
      },
      commonjsOptions: {
        include: [/node_modules/],
        transformMixedEsModules: true,
      },
    },
  };
});
