export class CryptoUnavailableError extends Error {
  constructor() {
    super(
      'Secure encryption is unavailable in this browser. Please use a recent version of Chrome, Firefox, Safari, or Edge over HTTPS.',
    );
    this.name = 'CryptoUnavailableError';
  }
}

export class InvalidPublicKeyError extends Error {
  constructor(reason: string) {
    super(`Invalid operator public key: ${reason}`);
    this.name = 'InvalidPublicKeyError';
  }
}

export class EncryptionFailedError extends Error {
  constructor(reason: string) {
    super(`Encryption failed: ${reason}`);
    this.name = 'EncryptionFailedError';
  }
}

const PEM_RE = /-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/;

function getSubtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || !c.subtle || typeof c.subtle.importKey !== 'function') {
    throw new CryptoUnavailableError();
  }
  return c.subtle;
}

function pemToDer(pem: string): Uint8Array {
  const match = PEM_RE.exec(pem);
  if (!match) {
    throw new InvalidPublicKeyError('expected a PKIX "PUBLIC KEY" PEM block');
  }
  const b64 = match[1].replace(/\s+/g, '');
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new InvalidPublicKeyError('PEM body is not valid base64');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(s);
}

export async function importPublicKey(pubPEM: string): Promise<CryptoKey> {
  const subtle = getSubtle();
  const der = pemToDer(pubPEM);
  try {
    return await subtle.importKey(
      'spki',
      der,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt'],
    );
  } catch (e) {
    throw new InvalidPublicKeyError((e as Error).message || 'importKey rejected');
  }
}

export async function encrypt(
  pubPEM: string,
  plaintext: string,
): Promise<string> {
  const subtle = getSubtle();
  const key = await importPublicKey(pubPEM);
  const data = new TextEncoder().encode(plaintext);
  let ct: ArrayBuffer;
  try {
    ct = await subtle.encrypt({ name: 'RSA-OAEP' }, key, data);
  } catch (e) {
    throw new EncryptionFailedError((e as Error).message || 'encrypt rejected');
  }
  return bytesToBase64(new Uint8Array(ct));
}

export function isWebCryptoAvailable(): boolean {
  try {
    getSubtle();
    return true;
  } catch {
    return false;
  }
}
