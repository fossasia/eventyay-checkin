const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function toBase64(buffer) {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : buffer instanceof Uint8Array
        ? buffer
        : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function fromBase64(value) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function createDeviceSalt() {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return toBase64(salt)
}

export async function deriveSnapshotKey(apitoken, saltBase64) {
  const token = String(apitoken || '').trim()
  if (!token || !saltBase64) {
    throw new Error('Missing credentials for snapshot encryption')
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(token),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(saltBase64),
      iterations: 120000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptJson(payload, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = textEncoder.encode(JSON.stringify(payload))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return {
    v: 1,
    iv: toBase64(iv),
    data: toBase64(ciphertext)
  }
}

export async function decryptJson(envelope, key) {
  if (!envelope?.iv || !envelope?.data) {
    throw new Error('Invalid snapshot envelope')
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(envelope.iv) },
    key,
    fromBase64(envelope.data)
  )
  return JSON.parse(textDecoder.decode(plaintext))
}
