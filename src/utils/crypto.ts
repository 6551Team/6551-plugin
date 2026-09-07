/**
 * AES 加密工具
 * 使用 Web Crypto API 进行 AES-256-GCM 加密
 */

const AES_KEY = '7Kdf7IBeakXkvIokqFNhC3m@0bB%VyJE'

/**
 * 将字符串转换为 ArrayBuffer
 */
function stringToArrayBuffer(str: string): ArrayBuffer {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(str)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

/**
 * 将 ArrayBuffer 转换为 Base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * 生成密钥
 */
async function generateKey(): Promise<CryptoKey> {
  const keyBuffer = stringToArrayBuffer(AES_KEY)
  // 使用前32字节作为密钥
  const keyData = keyBuffer.slice(0, 32)

  return await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )
}

/**
 * AES-256-GCM 加密数据
 * @param data 要加密的数据对象
 * @returns Base64 编码的加密结果
 */
export async function aesEncrypt(data: any): Promise<string> {
  try {
    const jsonString = JSON.stringify(data)
    const dataBuffer = stringToArrayBuffer(jsonString)

    // 生成随机 IV (12 字节，GCM 推荐长度)
    const iv = crypto.getRandomValues(new Uint8Array(12))

    // 获取加密密钥
    const key = await generateKey()

    // 加密数据
    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        tagLength: 128 // 128-bit 认证标签
      },
      key,
      dataBuffer
    )

    // 将 IV 和加密数据合并
    const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength)
    combined.set(iv, 0)
    combined.set(new Uint8Array(encryptedBuffer), iv.length)

    // 转换为 Base64
    return arrayBufferToBase64(combined.buffer)
  } catch (error) {
    console.error('AES 加密失败:', error)
    throw error
  }
}
