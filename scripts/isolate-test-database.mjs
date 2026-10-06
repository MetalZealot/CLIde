/**
 * Preload for server tests: every test process gets its own empty database, so a
 * test can never read or write the real one through an inherited DATABASE_PATH,
 * and runs the same on any machine. Tests that need tables call initializeDatabase().
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = mkdtempSync(path.join(os.tmpdir(), 'clide-test-db-'));
process.env.DATABASE_PATH = path.join(directory, 'auth.db');
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
