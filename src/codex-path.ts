import { access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function findCodex(): Promise<string> {
  if (process.env.BHOOT_CODEX_BIN) {
    await access(process.env.BHOOT_CODEX_BIN);
    return process.env.BHOOT_CODEX_BIN;
  }
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const directory of (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!directory) continue;
    const path = join(directory.replace(/^"|"$/g, ''), name);
    try { await access(path); return path; } catch {}
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const base = join(process.env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    const candidates: { path: string; modified: number }[] = [];
    try {
      for (const directory of await readdir(base, { withFileTypes: true })) {
        if (!directory.isDirectory()) continue;
        const path = join(base, directory.name, 'codex.exe');
        try { const info = await stat(path); if (info.isFile()) candidates.push({ path, modified: info.mtimeMs }); } catch {}
      }
    } catch {}
    candidates.sort((a,b) => b.modified - a.modified);
    if (candidates.length) return candidates[0].path;
  }
  throw new Error('Codex CLI could not be located. Set BHOOT_CODEX_BIN to the full path of codex.exe.');
}
