/**
 * WASM 数据查询服务
 * 从远程加载 WASM 文件并提供账号和关键词查询功能
 */

import * as ASLoader from '@assemblyscript/loader'

const YAP_WASM_URL = 'https://6551.tos-cn-hongkong.volces.com/yap/yap.wasm.v2'
const INFOFI_JSON_URL = 'https://6551.tos-cn-hongkong.volces.com/yap/infofi.v2.json'
const HANDLE_JSON_URL = 'https://6551.tos-cn-hongkong.volces.com/yap/handle.v2.json'
type FilterDataSource = 'local' | 'remote'

// WASM 模块实例和关键词数据
let yapWasmInstance: any = null
// 关键词数据：存储 { text: string, isRegexp: boolean }
let infofiKeywords: Array<{ text: string, isRegexp: boolean }> = []
// 用户名数据：存储 { text: string, isRegexp: boolean }
let handleUsernames: Array<{ text: string, isRegexp: boolean }> = []

function extensionRuntimeAvailable(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id && chrome.storage?.local)
}

export async function remoteFilterUpdateAvailable(): Promise<boolean> {
  if (!extensionRuntimeAvailable()) return false

  const response = await chrome.runtime.sendMessage({ type: 'FILTER_DATA_ENSURE' }) as {
    success?: boolean
    error?: string
    data?: { updateAvailable?: boolean }
  }
  if (!response?.success) throw new Error(response?.error || '无法同步在线过滤规则')
  return Boolean(response.data?.updateAvailable)
}

function sourceUrl(source: FilterDataSource, remoteUrl: string, localPath: string): string {
  if (source === 'remote' || !extensionRuntimeAvailable()) return remoteUrl
  return chrome.runtime.getURL(localPath)
}

/**
 * 加载 yap.wasm 模块
 */
async function loadYapWasm(source: FilterDataSource): Promise<any> {
  try {
    console.log(`[WASM服务] 正在加载 ${source === 'local' ? '本地基线' : '在线'} yap.wasm...`)

    const response = await fetch(sourceUrl(source, YAP_WASM_URL, 'filter-data/yap.wasm.v2'), {
      cache: source === 'remote' ? 'default' : 'force-cache',
    })
    if (!response.ok) throw new Error(`yap.wasm 请求失败 (${response.status})`)
    const buffer = await response.arrayBuffer()

    // 使用 AssemblyScript Loader 实例化
    const wasm = await ASLoader.instantiate(buffer, {
      env: {
        abort: (_msg: number, _file: number, _line: number, _column: number) => {
          console.error('[WASM] Abort called')
        },
      },
    })

    console.log('[WASM服务] yap.wasm 加载成功')
    return wasm.exports
  } catch (error) {
    console.error('[WASM服务] 加载 yap.wasm 失败:', error)
    throw error
  }
}

/**
 * 加载 infofi.json 关键词数据
 */
async function loadInfofiJson(source: FilterDataSource): Promise<Array<{ text: string, isRegexp: boolean }>> {
  try {
    console.log(`[数据服务] 正在加载${source === 'local' ? '本地基线' : '在线'} infofi.json...`)

    const response = await fetch(sourceUrl(source, INFOFI_JSON_URL, 'filter-data/infofi.v2.json'), {
      cache: source === 'remote' ? 'default' : 'force-cache',
    })
    if (!response.ok) throw new Error(`infofi.json 请求失败 (${response.status})`)
    const data = await response.json()

    // 解析数据
    if (data.dataList && Array.isArray(data.dataList)) {
      const keywords: Array<{ text: string, isRegexp: boolean }> = []
      data.dataList.forEach((item: { text: string, isRegexp?: boolean }) => {
        if (item.text) {
          keywords.push({
            text: item.text.toLowerCase(),
            isRegexp: item.isRegexp || false
          })
        }
      })
      console.log(`[数据服务] infofi.json 加载成功，共 ${keywords.length} 个关键词`)
      return keywords
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
async function loadHandleJson(source: FilterDataSource): Promise<Array<{ text: string, isRegexp: boolean }>> {
  try {
    console.log(`[数据服务] 正在加载${source === 'local' ? '本地基线' : '在线'} handle.json...`)

    const response = await fetch(sourceUrl(source, HANDLE_JSON_URL, 'filter-data/handle.v2.json'), {
      cache: source === 'remote' ? 'default' : 'force-cache',
    })
    if (!response.ok) throw new Error(`handle.json 请求失败 (${response.status})`)
    const data = await response.json()

    // 解析数据
    if (data.dataList && Array.isArray(data.dataList)) {
      const usernames: Array<{ text: string, isRegexp: boolean }> = []
      data.dataList.forEach((item: { text: string, isRegexp?: boolean }) => {
        if (item.text) {
          usernames.push({
            text: item.text.toLowerCase(),
            isRegexp: item.isRegexp || false
          })
        }
      })
      console.log(`[数据服务] handle.json 加载成功，共 ${usernames.length} 个用户名`)
      return usernames
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
export async function initializeWasm(source: FilterDataSource = 'local'): Promise<void> {
  const [wasm, keywords, usernames] = await Promise.all([
    loadYapWasm(source),
    loadInfofiJson(source),
    loadHandleJson(source),
  ])
  yapWasmInstance = wasm
  infofiKeywords = keywords
  handleUsernames = usernames
  console.log(`[数据服务] ${source === 'local' ? '本地基线' : '在线'}数据模块初始化完成`)
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
export async function initializeWasmWithRetry(maxRetries = 3, source: FilterDataSource = 'local'): Promise<void> {
  let lastError: Error | null = null

  for (let i = 0; i < maxRetries; i++) {
    try {
      await initializeWasm(source)
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
