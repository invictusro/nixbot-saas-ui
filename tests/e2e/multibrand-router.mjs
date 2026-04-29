import http from 'node:http';
import { URL } from 'node:url';

export function startBrandRouter({ port, hostname, upstream }) {
  const upstreamURL = new URL(upstream);
  const server = http.createServer((req, res) => {
    const headers = { ...req.headers, host: hostname, 'x-forwarded-host': hostname };
    delete headers['content-length'];

    const proxyReq = http.request(
      {
        protocol: upstreamURL.protocol,
        hostname: upstreamURL.hostname,
        port: upstreamURL.port || (upstreamURL.protocol === 'https:' ? 443 : 80),
        method: req.method,
        path: req.url,
        headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', (err) => {
      res.writeHead(502);
      res.end(`upstream error: ${err.message}`);
    });
    req.pipe(proxyReq);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        hostname,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
