import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { signRequest, type BucketConfig } from '@/services/s3';

/**
 * A stand-in for S3-compatible storage, kept in memory: put, get, delete and a paged list, at path-style
 * addresses. It refuses what the real thing refuses: a body that does not match its stated hash or length, and
 * a signature that is not the one these keys give for the request as it arrived.
 */
export async function startFakeBucket(pageSize = 1000) {
  const objects = new Map<string, Buffer>();
  const keys = { region: 'auto', accessKeyId: 'test-key-id', secretAccessKey: 'test-secret' };
  const requests: string[] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      requests.push(`${req.method} ${url.pathname}${url.search}`);
      const refuse = (status: number, message: string) => res.writeHead(status, { 'Content-Type': 'application/xml' }).end(`<Error><Message>${message}</Message></Error>`);

      const stamp = String(req.headers['x-amz-date'] ?? '');
      const at = new Date(stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
      const expected = signRequest(keys, { method: req.method ?? '', url, payloadHash: String(req.headers['x-amz-content-sha256'] ?? ''), now: at });
      if (req.headers.authorization !== expected.authorization) return refuse(403, 'The request signature we calculated does not match the signature you provided.');
      if (createHash('sha256').update(body).digest('hex') !== req.headers['x-amz-content-sha256']) return refuse(400, 'The provided x-amz-content-sha256 header does not match what was computed.');

      const [, bucket, ...rest] = url.pathname.split('/');
      if (bucket !== 'backups') return refuse(404, 'The specified bucket does not exist');
      const key = decodeURIComponent(rest.join('/'));

      if (req.method === 'PUT') {
        if (req.headers['content-length'] === undefined) return refuse(411, 'You must provide the Content-Length HTTP header.');
        objects.set(key, body);
        return res.writeHead(200).end();
      }
      if (req.method === 'DELETE') {
        objects.delete(key);
        return res.writeHead(204).end();
      }
      if (req.method === 'GET' && key) {
        const found = objects.get(key);
        return found ? res.writeHead(200).end(found) : refuse(404, 'The specified key does not exist.');
      }
      if (req.method === 'GET') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const all = [...objects.keys()].filter((name) => name.startsWith(prefix)).sort();
        const from = Number(url.searchParams.get('continuation-token') ?? 0);
        const page = all.slice(from, from + pageSize);
        const more = from + pageSize < all.length;
        const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
        return res.writeHead(200, { 'Content-Type': 'application/xml' }).end(
          `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>${more}</IsTruncated>` +
            page.map((name) => `<Contents><Key>${escape(name)}</Key><Size>${objects.get(name)!.length}</Size></Contents>`).join('') +
            (more ? `<NextContinuationToken>${from + pageSize}</NextContinuationToken>` : '') +
            '</ListBucketResult>',
        );
      }
      refuse(405, 'Method not allowed');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const config: BucketConfig = { ...keys, endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bucket: 'backups' };
  return { config, objects, requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
