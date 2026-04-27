#!/usr/bin/env node
/**
 * Legacy hook: EdgeMarc firmware is no longer bundled. Images are listed and
 * downloaded on demand from CloudCo public FTP (see firmware catalog / support article).
 * Kept so `npm run bundle:emfw` remains a no-op for old CI or docs.
 */
console.log(
  "[bundle-emfw] Skipped: EdgeMarc uses CloudCo FTP on demand; no local pub.tar.zst bundle.",
);
process.exit(0);
