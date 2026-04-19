import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS = readFileSync(join(__dirname, 'harness.html'), 'utf8');

const CHANNELS = ['account_state_changed', 'balance_changed', 'batch_progress'];

function createServer() {
  const subs = new Map();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/harness.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HARNESS);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/customer/events') {
      const customer = url.searchParams.get('customer') ?? '';
      if (!customer) {
        res.writeHead(400);
        res.end('missing customer');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(': connected\n\n');
      const bucket = subs.get(customer) ?? new Set();
      bucket.add(res);
      subs.set(customer, bucket);
      req.on('close', () => {
        const b = subs.get(customer);
        if (b) {
          b.delete(res);
          if (b.size === 0) subs.delete(customer);
        }
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/publish') {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400);
          res.end('bad json');
          return;
        }
        const { customer, channel, payload } = parsed;
        if (!customer || !channel || !CHANNELS.includes(channel)) {
          res.writeHead(400);
          res.end('bad publish');
          return;
        }
        const bucket = subs.get(customer);
        const frame = `event: ${channel}\ndata: ${JSON.stringify(payload)}\n\n`;
        if (bucket) {
          for (const r of bucket) r.write(frame);
        }
        res.writeHead(204);
        res.end();
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/drop-all') {
      for (const bucket of subs.values()) {
        for (const r of bucket) {
          try {
            r.destroy();
          } catch {}
        }
      }
      subs.clear();
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  return server;
}

const port = Number(process.env.PORT ?? 4455);
const server = createServer();
server.listen(port, '127.0.0.1', () => {
  console.log(`e2e server listening on http://127.0.0.1:${port}`);
});
