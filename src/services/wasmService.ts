/**
 * WASM 数据查询服务
 * 从远程加载 WASM 文件并提供账号和关键词查询功能
 */

import * as ASLoader from '@assemblyscript/loader'

const YAP_WASM_URL = 'https://6551.tos-cn-hongkong.volces.com/yap/yap.wasm.v2'
const INFOFI_JSON_URL = 'https://6551.tos-cn-hongkong.volces.com/yap/infofi.v2.json'
const HANDLE_JSON_URL = 'https://6551.tos-cn-hongkong.volces.com/yap/handle.v2.json'

// WASM 模块实例和关键词数据
let yapWasmInstance: any = null
// 关键词数据：存储 { text: string, isRegexp: boolean }
let infofiKeywords: Array<{ text: string, isRegexp: boolean }> = []
// 用户名数据：存储 { text: string, isRegexp: boolean }
let handleUsernames: Array<{ text: string, isRegexp: boolean }> = []

/**
 * 加载 yap.wasm 模块
 */
async function loadYapWasm(): Promise<void> {
  try {
    console.log('[WASM服务] 正在加载 yap.wasm...')

    // 使用 fetch 加载 WASM 文件
    const response = await fetch(YAP_WASM_URL)
    const buffer = await response.arrayBuffer()

    // 使用 AssemblyScript Loader 实例化
    const wasm = await ASLoader.instantiate(buffer, {
      env: {
        abort: (_msg: number, _file: number, _line: number, _column: number) => {
          console.error('[WASM] Abort called')
        },
      },
    })

    yapWasmInstance = wasm.exports

    console.log('[WASM服务] yap.wasm 加载成功')
  } catch (error) {
    console.error('[WASM服务] 加载 yap.wasm 失败:', error)
    throw error
  }
}

/**
 * 加载 infofi.json 关键词数据
 */
async function loadInfofiJson(): Promise<void> {
  try {
    console.log('[数据服务] 正在加载 infofi.json...')

    // 使用 fetch 加载 JSON 文件
    const response = await fetch(INFOFI_JSON_URL)
    const data = await response.json()

    // 解析数据
    if (data.dataList && Array.isArray(data.dataList)) {
      infofiKeywords = []
      data.dataList.forEach((item: { text: string, isRegexp?: boolean }) => {
        if (item.text) {
          infofiKeywords.push({
            text: item.text.toLowerCase(),
            isRegexp: item.isRegexp || false
          })
        }
      })
      console.log(`[数据服务] infofi.json 加载成功，共 ${infofiKeywords.length} 个关键词`)
    } else {
      throw new Error('infofi.json 格式错误')
    }
  } catch (error) {
    console.error('[数据服务] 加载 infofi.json 失败:', error)
    throw error
  }
}

/**
 * 加载 handle.json 用户名数据
 */
async function loadHandleJson(): Promise<void> {
  try {
    console.log('[数据服务] 正在加载 handle.json...')

    // 使用 fetch 加载 JSON 文件
    const response = await fetch(HANDLE_JSON_URL)
    const data = await response.json()

    // 解析数据
    if (data.dataList && Array.isArray(data.dataList)) {
      handleUsernames = []
      data.dataList.forEach((item: { text: string, isRegexp?: boolean }) => {
        if (item.text) {
          handleUsernames.push({
            text: item.text.toLowerCase(),
            isRegexp: item.isRegexp || false
          })
        }
      })
      console.log(`[数据服务] handle.json 加载成功，共 ${handleUsernames.length} 个用户名`)
    } else {
      throw new Error('handle.json 格式错误')
    }
  } catch (error) {
    console.error('[数据服务] 加载 handle.json 失败:', error)
    throw error
  }
}

/**
 * 初始化所有数据模块
 */
export async function initializeWasm(): Promise<void> {
  await Promise.all([
    loadYapWasm(),
    loadInfofiJson(),
    loadHandleJson()
  ])
  console.log('[数据服务] 所有数据模块初始化完成')
}

/**
 * 检查账号是否在WASM白名单中
 * @param account 账号名称
 * @returns true 表示在白名单中，false 表示不在
 */
export function hasWhiteAccount(account: string): boolean {
  if (!yapWasmInstance) {
    console.warn('[WASM服务] yap.wasm 尚未加载')
    return false
  }

  try {
    // 转为小写
    const lowerAccount = account.toLowerCase()

    // 使用 __newString 创建 WASM 字符串
    const strPtr = yapWasmInstance.__newString(lowerAccount)

    // 调用 WASM 函数
    const result = yapWasmInstance.hasWhiteAccount(strPtr)

    return result === 1
  } catch (error) {
    console.error('[WASM服务] hasWhiteAccount 调用失败:', error, '参数:', account)
    return false
  }
}

/**
 * 检查账号是否在过滤列表中（WASM黑名单）
 * @param account 账号名称
 * @returns true 表示存在，false 表示不存在
 */
export function hasAccount(account: string): boolean {
  if (!yapWasmInstance) {
    console.warn('[WASM服务] yap.wasm 尚未加载')
    return false
  }

  try {
    // 转为小写
    const lowerAccount = account.toLowerCase()

    // 使用 __newString 创建 WASM 字符串
    const strPtr = yapWasmInstance.__newString(lowerAccount)

    // 调用 WASM 函数
    const result = yapWasmInstance.hasAccount(strPtr)

    return result === 1
  } catch (error) {
    console.error('[WASM服务] hasAccount 调用失败:', error, '参数:', account)
    return false
  }
}

/**
 * 获取过滤账号数量
 * @returns 账号数量
 */
export function getAccountCount(): number {
  if (!yapWasmInstance) {
    console.warn('[WASM服务] yap.wasm 尚未加载')
    return 0
  }

  try {
    return yapWasmInstance.count()
  } catch (error) {
    console.error('[WASM服务] count 调用失败:', error)
    return 0
  }
}

/**
 * 检查文本中是否包含过滤关键词列表中的任何一个
 * 支持组合关键词：用逗号分隔的关键词需要全部命中才算匹配
 * 支持正则表达式匹配
 * @param text 要检查的文本
 * @returns 返回匹配到的关键词，如果没有匹配则返回null
 */
export function hasWord(text: string): string | null {
  if (infofiKeywords.length === 0) {
    console.warn('[数据服务] infofi 关键词数据尚未加载')
    return null
  }

  try {
    // 转为小写
    const lowerText = text.toLowerCase()

    // 检查文本是否包含关键词列表中的任何一个
    for (const item of infofiKeywords) {
      const keyword = item.text

      if (item.isRegexp) {
        // 正则表达式匹配
        try {
          const regex = new RegExp(keyword, 'i')
          if (regex.test(text)) {
            return keyword
          }
        } catch (e) {
          console.error('[数据服务] 正则表达式错误:', keyword, e)
        }
      } else {
        // 检查是否是组合关键词（包含逗号）
        if (keyword.includes(',')) {
          // 分割组合关键词，去除空格
          const parts = keyword.split(',').map(p => p.trim()).filter(p => p.length > 0)
          // 检查是否所有部分都命中
          const allMatched = parts.every(part => lowerText.includes(part))
          if (allMatched) {
            return keyword
          }
        } else {
          // 单个关键词直接匹配
          if (lowerText.includes(keyword)) {
            return keyword
          }
        }
      }
    }

    return null
  } catch (error) {
    console.error('[数据服务] hasWord 调用失败:', error, '参数:', text)
    return null
  }
}

/**
 * 获取过滤关键词数量
 * @returns 关键词数量
 */
export function getWordCount(): number {
  return infofiKeywords.length
}

/**
 * 检查用户名中是否包含过滤用户名列表中的任何一个
 * 支持组合用户名：用逗号分隔的用户名需要全部命中才算匹配
 * 支持正则表达式匹配
 * @param text 要检查的用户名文本
 * @returns 返回匹配到的用户名，如果没有匹配则返回null
 */
export function hasHandle(text: string): string | null {
  if (handleUsernames.length === 0) {
    console.warn('[数据服务] handle 用户名数据尚未加载')
    return null
  }

  try {
    // 转为小写
    const lowerText = text.toLowerCase()

    // 检查文本是否包含用户名列表中的任何一个
    for (const item of handleUsernames) {
      const username = item.text

      if (item.isRegexp) {
        // 正则表达式匹配
        try {
          const regex = new RegExp(username, 'i')
          if (regex.test(text)) {
            return username
          }
        } catch (e) {
          console.error('[数据服务] 正则表达式错误:', username, e)
        }
      } else {
        // 检查是否是组合用户名（包含逗号）
        if (username.includes(',')) {
          // 分割组合用户名，去除空格
          const parts = username.split(',').map(p => p.trim()).filter(p => p.length > 0)
          // 检查是否所有部分都命中
          const allMatched = parts.every(part => lowerText.includes(part))
          if (allMatched) {
            return username
          }
        } else {
          // 单个用户名直接匹配
          if (lowerText.includes(username)) {
            return username
          }
        }
      }
    }

    return null
  } catch (error) {
    console.error('[数据服务] hasHandle 调用失败:', error, '参数:', text)
    return null
  }
}

/**
 * 获取过滤用户名数量
 * @returns 用户名数量
 */
export function getHandleCount(): number {
  return handleUsernames.length
}

/**
 * 带重试机制的初始化函数
 * @param maxRetries 最大重试次数
 */
export async function initializeWasmWithRetry(maxRetries = 3): Promise<void> {
  let lastError: Error | null = null

  for (let i = 0; i < maxRetries; i++) {
    try {
      await initializeWasm()
      return
    } catch (error) {
      lastError = error as Error
      console.log(`[WASM服务] 第 ${i + 1} 次初始化失败，${i < maxRetries - 1 ? '正在重试...' : '已达到最大重试次数'}`)

      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)))
      }
    }
  }

  throw lastError || new Error('WASM 初始化失败')
}

/**
 * 检查数据模块是否已加载
 */
export function isWasmLoaded(): boolean {
  return yapWasmInstance !== null && infofiKeywords.length > 0 && handleUsernames.length > 0
}
