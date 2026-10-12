import { it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/config.js';
it('token_file_matches_current_configured_token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitmind-config-'));
  vi.stubEnv('DATA_DIR', dir);
  vi.stubEnv('APP_ACCESS_TOKEN', '');
  try {
    const generated = config();
    expect(readFileSync(join(dir, 'access-token'), 'utf8')).toBe(
      generated.token,
    );
    vi.stubEnv('APP_ACCESS_TOKEN', 'new-personal-token');
    expect(config().token).toBe('new-personal-token');
    expect(readFileSync(join(dir, 'access-token'), 'utf8')).toBe(
      'new-personal-token',
    );
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true });
  }
});
