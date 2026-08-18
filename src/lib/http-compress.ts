import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

/**
 * Compresses a route handler's response body.
 *
 * Next compresses what its own rendering pipeline returns, but **not** a raw
 * `Response` built in a route handler — measured: the public event page came
 * back as 13.3KB `identity` while `/sign-in` came back gzipped. That is ten
 * kilobytes a contributor pays for out of a prepaid bundle, on the one route
 * where CLAUDE.md rule 9 says every kilobyte is friction.
 *
 * Cloudflare would compress at the edge (architecture §3), but relying on that
 * means the origin ships ten extra kilobytes anywhere the edge is not — staging,
 * a direct origin hit, a region that fails open.
 *
 * Brotli first because it is meaningfully better on text and every browser that
 * matters here has had it for years. Quality 5 rather than the default 11: on
 * this document it is within a few hundred bytes of maximum and roughly twenty
 * times faster, and the response is cacheable anyway.
 */

export interface CompressedBody {
  readonly body: Buffer
  readonly encoding: 'br' | 'gzip' | 'identity'
}

export function compressFor(acceptEncoding: string | null, html: string): CompressedBody {
  const accepted = (acceptEncoding ?? '').toLowerCase()
  const raw = Buffer.from(html, 'utf8')

  if (accepted.includes('br')) {
    return {
      body: brotliCompressSync(raw, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 5,
          [constants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
        },
      }),
      encoding: 'br',
    }
  }

  if (accepted.includes('gzip')) {
    return { body: gzipSync(raw, { level: 6 }), encoding: 'gzip' }
  }

  // An old client, or a proxy that stripped the header. It gets the document.
  return { body: raw, encoding: 'identity' }
}
