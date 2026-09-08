import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { inputSchema, candidateSchema, type Input, type Candidate } from './schema.js';
import { candidateInstruction } from './providers.js';

export const configPath = () => process.env.BHOOT_BRIDGE_CONFIG || join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'BhootMCP', 'bridge.json');
const configSchema = z.object({ port: z.number().int().min(1024).max(65535), clientToken: z.string().min(40), browserToken: z.string().min(40) });
export type BridgeConfig = z.infer<typeof configSchema>;
export async function readConfig(): Promise<BridgeConfig> {
  return configSchema.parse(JSON.parse(await readFile(configPath(), 'utf8')));
}
export async function ensureConfig(): Promise<BridgeConfig> {
  try { return await readConfig(); } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  const config = { port: 43187, clientToken: randomBytes(32).toString('hex'), browserToken: randomBytes(32).toString('hex') };
  await mkdir(join(configPath(), '..'), { recursive: true });
  try { await writeFile(configPath(), JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 }); }
  catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  return readConfig();
}
type Job = { id: string; input: Input; state: 'queued' | 'claimed' | 'done' | 'error';
  created: number; expires: number; lease?: string; candidate?: Candidate; error?: string };
export class BrowserQueue {
  jobs = new Map<string, Job>();
  lastSeen = 0;
  constructor(private timeout = 240000) {}
  sweep() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if ((job.state === 'queued' || job.state === 'claimed') && now > job.expires) { job.state = 'error'; job.error = 'Claude browser timed out; no automatic resubmission'; }
      if (now > job.expires + 60000) this.jobs.delete(id);
    }
  }
  add(input: unknown) {
    this.sweep();
    if (this.jobs.size >= 20) throw new Error('Queue full');
    const id = randomUUID(), created = Date.now();
    const job: Job = { id, input: inputSchema.parse(input), state: 'queued', created, expires: created + this.timeout };
    this.jobs.set(id, job);
    return { id, expires: job.expires };
  }
  claim() {
    this.sweep(); this.lastSeen = Date.now();
    // One Claude job globally: no parallel typing or ambiguous answer association.
    if ([...this.jobs.values()].some(j => j.state === 'claimed')) return null;
    const job = [...this.jobs.values()].find(j => j.state === 'queued');
    if (!job) return null;
    job.state = 'claimed'; job.lease = randomBytes(24).toString('hex');
    return { id: job.id, lease: job.lease, expires: job.expires,
      prompt: `${candidateInstruction}\nReturn ONLY a JSON object with answer (string), needs_user (boolean), assumptions (array of strings). No tools are needed.\nBhootMCP request ${job.id}\n${JSON.stringify(job.input)}` };
  }
  finish(raw: unknown) {
    const data = z.object({ id: z.string().uuid(), lease: z.string(), candidate: candidateSchema.optional(), error: z.string().min(1).max(500).optional() }).strict().parse(raw);
    this.sweep(); const job = this.jobs.get(data.id);
    if (!job || job.lease !== data.lease) throw new Error('Unknown job or lease');
    // Retry delivery is safe; the first completed result wins.
    if (job.state === 'done') return;
    if (job.state !== 'claimed') throw new Error('Job is no longer active');
    if (!data.candidate && !data.error) throw new Error('Missing result');
    job.state = data.error ? 'error' : 'done'; job.error = data.error; job.candidate = data.error ? undefined : data.candidate;
  }
  result(id: string) {
    this.sweep(); const job = this.jobs.get(id);
    return job ? { id: job.id, state: job.state, candidate: job.candidate, error: job.error } : null;
  }
}
function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y);
}
async function body(req: IncomingMessage) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 100000) throw new Error('Request too large'); }
  return JSON.parse(text);
}
export function bridgeServer(config: BridgeConfig, queue = new BrowserQueue()) {
  return createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    const reply = (code: number, value: unknown) => { res.writeHead(code); res.end(JSON.stringify(value)); };
    // Exact loopback host check also prevents DNS rebinding. No website CORS allowance.
    if (req.headers.host !== `127.0.0.1:${config.port}`) return reply(403, { error: 'Host rejected' });
    const origin = req.headers.origin;
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return reply(403, { error: 'Origin rejected' });
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const isClient = equal(token, config.clientToken), isBrowser = equal(token, config.browserToken);
    if (!isClient && !isBrowser) return reply(401, { error: 'Pairing required' });
    const path = (req.url || '').split('?')[0];
    try {
      if (req.method === 'GET' && path === '/health') return reply(200, { ok: true, browserConnected: Date.now() - queue.lastSeen < 60000 });
      if (isBrowser && req.method === 'POST' && path === '/browser/claim') return reply(200, { job: queue.claim() });
      if (isBrowser && req.method === 'POST' && path === '/browser/result') { queue.finish(await body(req)); return reply(200, { ok: true }); }
      if (isClient && req.method === 'POST' && path === '/jobs') {
        if (Date.now() - queue.lastSeen >= 60000) return reply(409, { error: 'Open the paired BhootMCP Claude tab first' });
        return reply(201, queue.add(await body(req)));
      }
      if (isClient && req.method === 'GET' && /^\/jobs\/[0-9a-f-]{36}$/.test(path)) {
        const result = queue.result(path.slice(6)); return reply(result ? 200 : 404, result || { error: 'Job expired or missing' });
      }
      return reply(404, { error: 'Unknown route' });
    } catch { return reply(400, { error: 'Invalid request or stale job' }); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = await ensureConfig();
  const server = bridgeServer(config);
  server.on('error', () => { console.error('BhootMCP bridge could not start; check port 43187 or an existing instance.'); process.exitCode = 1; });
  server.listen(config.port, '127.0.0.1', () => console.error(`BhootMCP bridge ready on 127.0.0.1:${config.port}. Pair through the extension popup.`));
}
