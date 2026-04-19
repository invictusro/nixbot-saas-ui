import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import {
  encrypt,
  importPublicKey,
  isWebCryptoAvailable,
  CryptoUnavailableError,
  InvalidPublicKeyError,
} from './crypto';

function derToPem(type: 'PUBLIC KEY' | 'PRIVATE KEY', der: ArrayBuffer): string {
  const bytes = new Uint8Array(der);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = Buffer.from(bin, 'binary').toString('base64');
  const wrapped = b64.match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${type}-----\n${wrapped}\n-----END ${type}-----\n`;
}

function base64ToBytes(s: string): Uint8Array {
  const bin = Buffer.from(s, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface TestKeypair {
  publicPem: string;
  privateKey: CryptoKey;
}

async function generateKeypair(): Promise<TestKeypair> {
  const kp = (await webcrypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  )) as CryptoKeyPair;
  const spki = await webcrypto.subtle.exportKey('spki', kp.publicKey);
  return { publicPem: derToPem('PUBLIC KEY', spki), privateKey: kp.privateKey };
}

async function decryptWithNode(
  privateKey: CryptoKey,
  ciphertextB64: string,
): Promise<string> {
  const ct = base64ToBytes(ciphertextB64);
  const pt = await webcrypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    ct,
  );
  return new TextDecoder().decode(pt);
}

describe('crypto', () => {
  let kp: TestKeypair;

  beforeAll(async () => {
    kp = await generateKeypair();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('encrypt + Go-compatible round-trip', () => {
    const cases: Array<{ name: string; plaintext: string }> = [
      { name: 'hello', plaintext: 'hello' },
      { name: 'empty string', plaintext: '' },
      { name: 'typical IG password', plaintext: 'Tr0ub4dor&3!xYz' },
      { name: 'unicode (emoji + cjk)', plaintext: '🔐パスワード密码' },
      { name: 'spaces and newlines', plaintext: '  line1\nline2\t\n  ' },
      { name: 'max-ish plaintext (150 bytes)', plaintext: 'x'.repeat(150) },
    ];

    for (const c of cases) {
      it(`round-trips: ${c.name}`, async () => {
        const ciphertext = await encrypt(kp.publicPem, c.plaintext);
        expect(ciphertext).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        const decoded = base64ToBytes(ciphertext);
        expect(decoded.length).toBe(256);
        const recovered = await decryptWithNode(kp.privateKey, ciphertext);
        expect(recovered).toBe(c.plaintext);
      });
    }

    it('produces nondeterministic ciphertext (OAEP randomization)', async () => {
      const a = await encrypt(kp.publicPem, 'same-plaintext');
      const b = await encrypt(kp.publicPem, 'same-plaintext');
      expect(a).not.toBe(b);
      expect(await decryptWithNode(kp.privateKey, a)).toBe('same-plaintext');
      expect(await decryptWithNode(kp.privateKey, b)).toBe('same-plaintext');
    });
  });

  describe('importPublicKey', () => {
    it('loads operator PEM into a non-extractable CryptoKey', async () => {
      const key = await importPublicKey(kp.publicPem);
      expect(key.type).toBe('public');
      expect(key.extractable).toBe(false);
      expect(key.usages).toContain('encrypt');
    });
  });

  describe('missing SubtleCrypto fallback', () => {
    it('throws CryptoUnavailableError when globalThis.crypto is absent', async () => {
      vi.stubGlobal('crypto', undefined);
      expect(isWebCryptoAvailable()).toBe(false);
      await expect(encrypt(kp.publicPem, 'x')).rejects.toBeInstanceOf(
        CryptoUnavailableError,
      );
    });

    it('throws CryptoUnavailableError when subtle is absent (legacy browsers)', async () => {
      vi.stubGlobal('crypto', { getRandomValues: () => new Uint8Array() });
      expect(isWebCryptoAvailable()).toBe(false);
      await expect(encrypt(kp.publicPem, 'x')).rejects.toBeInstanceOf(
        CryptoUnavailableError,
      );
    });

    it('error message is user-actionable', async () => {
      vi.stubGlobal('crypto', undefined);
      try {
        await encrypt(kp.publicPem, 'x');
      } catch (e) {
        expect((e as Error).message).toMatch(/browser/i);
      }
    });
  });

  describe('invalid PEM input', () => {
    it('rejects garbage string', async () => {
      await expect(encrypt('not a pem', 'hi')).rejects.toBeInstanceOf(
        InvalidPublicKeyError,
      );
    });

    it('rejects PEM with non-base64 body', async () => {
      const bad =
        '-----BEGIN PUBLIC KEY-----\n!!!not-base64!!!\n-----END PUBLIC KEY-----\n';
      await expect(encrypt(bad, 'hi')).rejects.toBeInstanceOf(
        InvalidPublicKeyError,
      );
    });

    it('rejects valid-looking PEM with invalid DER', async () => {
      const bad =
        '-----BEGIN PUBLIC KEY-----\n' +
        Buffer.from('garbage').toString('base64') +
        '\n-----END PUBLIC KEY-----\n';
      await expect(encrypt(bad, 'hi')).rejects.toBeInstanceOf(
        InvalidPublicKeyError,
      );
    });

    it('rejects wrong PEM type (PRIVATE KEY block)', async () => {
      const bad = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n';
      await expect(encrypt(bad, 'hi')).rejects.toBeInstanceOf(
        InvalidPublicKeyError,
      );
    });
  });

  describe('storage isolation (no plaintext persisted)', () => {
    it('never writes to localStorage or sessionStorage during encrypt', async () => {
      const local = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
      const session = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
      vi.stubGlobal('localStorage', local);
      vi.stubGlobal('sessionStorage', session);

      const plaintext = 'sensitive-ig-password-9QxkL';
      const ct = await encrypt(kp.publicPem, plaintext);

      expect(local.setItem).not.toHaveBeenCalled();
      expect(session.setItem).not.toHaveBeenCalled();

      for (const call of local.setItem.mock.calls)
        expect(JSON.stringify(call)).not.toContain(plaintext);
      for (const call of session.setItem.mock.calls)
        expect(JSON.stringify(call)).not.toContain(plaintext);

      expect(ct).not.toContain(plaintext);
    });
  });
});
