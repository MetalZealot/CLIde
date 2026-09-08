#!/usr/bin/env node
// The server build stages into dist-server.next and this script promotes it
// into place. The live dist-server must never be deleted before the new build
// is complete: an interrupted build would otherwise leave the installation
// without a server entrypoint, crash-looping on MODULE_NOT_FOUND at every
// start until someone rebuilds it by hand.
//
// A kill between the two renames below is the one window that still loses it;
// the previous build is sitting in dist-server.old, so recovery is one mv.
import fs from 'node:fs';

const NEXT = 'dist-server.next';
const LIVE = 'dist-server';
const OLD = 'dist-server.old';
const ENTRY = 'server/index.js';

if (!fs.existsSync(`${NEXT}/${ENTRY}`)) {
  console.error(`promote-dist-server: ${NEXT}/${ENTRY} is missing; leaving the current ${LIVE} untouched.`);
  process.exit(1);
}

fs.rmSync(OLD, { recursive: true, force: true });
if (fs.existsSync(LIVE)) {
  fs.renameSync(LIVE, OLD);
}
try {
  fs.renameSync(NEXT, LIVE);
} catch (error) {
  // Put the previous build back before failing so the installation still boots.
  if (fs.existsSync(OLD) && !fs.existsSync(LIVE)) {
    fs.renameSync(OLD, LIVE);
  }
  throw error;
}
fs.rmSync(OLD, { recursive: true, force: true });
