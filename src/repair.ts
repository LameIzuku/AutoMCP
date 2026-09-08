import { spawn } from 'node:child_process';
import { normalize, join } from 'node:path';

export function matchesBridgeProcess(info: { ProcessId: number; ExecutablePath: string; CommandLine: string }, executable: string, script: string): boolean {
  if (!Number.isInteger(info.ProcessId) || info.ProcessId <= 0) return false;
  const match = /^(?:"([^"]+)"|(\S+))\s+(?:"([^"]+)"|(\S+))\s*$/.exec(info.CommandLine || '');
  const same = (a: string, b: string) => normalize(a || '').toLowerCase() === normalize(b).toLowerCase();
  return !!match && same(info.ExecutablePath, executable) && same(match[1] || match[2], executable) && same(match[3] || match[4], script);
}

export async function stopVerifiedBridge(port: number, script: string) {
  if (process.platform !== 'win32') throw new Error('Automatic bridge repair currently supports Windows only.');
  const command = `$ErrorActionPreference = 'Stop'
$listeners = @(Get-NetTCPConnection -LocalPort ([int]$env:BHOOT_REPAIR_PORT) -State Listen -ErrorAction SilentlyContinue)
$items = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
  Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_) | Select-Object ProcessId,ExecutablePath,CommandLine
})
ConvertTo-Json -InputObject $items -Compress`;
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', command], {
        shell: false, windowsHide: true, env: { ...process.env, BHOOT_REPAIR_PORT: String(port) }, stdio: ['ignore', 'pipe', 'ignore']
      });
    let data = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Timed out identifying the bridge process')); }, 15000);
    child.stdout.on('data', chunk => { data += chunk; });
    child.on('error', () => { clearTimeout(timer); reject(new Error('Could not inspect the bridge process')); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(data) : reject(new Error('Could not inspect the bridge process')); });
  });
  const processes = JSON.parse(output.trim() || '[]');
  if (!Array.isArray(processes)) throw new Error('Unexpected process inspection result');
  if (processes.length === 0) return;
  if (processes.length !== 1 || !matchesBridgeProcess(processes[0], process.execPath, script)) {
    throw new Error('The port belongs to a different program. Nothing was stopped.');
  }
  // Exactly one positively identified Node + bridge.js process; never kill other Node processes or a process tree.
  process.kill(processes[0].ProcessId);
  console.log('Stopped the BhootMCP bridge with mismatched credentials. Restarting it from this terminal.');
}
