/**
 * 平台链接解析器 - 核心业务逻辑模块
 * 风险提示：解析第三方平台链接可能违反平台服务协议
 * 建议：仅用于技术学习，避免大量请求
 */

class PlatformParser {
  constructor() {
    // 平台正则表达式配置
    this.patterns = {
      douyin: {
        regex: /(?:douyin\.com|iesdouyin\.com)\/share\/video\/(\d+)/,
        shortRegex: /v\.douyin\.com\/[A-Za-z0-9]+/,
        name: '抖音',
        riskLevel: 'high'
      },
      kuaishou: {
        regex: /kuaishou\.com\/short-video\/(\d+)/,
        shortRegex: /v\.kuaishou\.com\/[A-Za-z0-9]+/,
        name: '快手',
        riskLevel: 'high'
      },
      bilibili: {
        regex: /bilibili\.com\/video\/(BV[A-Za-z0-9]+)/,
        shortRegex: /b23\.tv\/[A-Za-z0-9]+/,
        name: 'B站',
        riskLevel: 'medium'
      },
      tiktok: {
        regex: /tiktok\.com\/@[\w.]+\/video\/(\d+)/,
        shortRegex: /vm\.tiktok\.com\/[A-Za-z0-9]+/,
        name: 'TikTok',
        riskLevel: 'high'
      }
    }
  }

  /**
   * 识别平台类型
   * @param {string} url - 视频链接
   * @returns {Object} 平台信息
   */
  identifyPlatform(url) {
    if (!url || typeof url !== 'string') {
      throw new Error('无效的链接格式')
    }

    // 清理链接
    const cleanUrl = this.cleanUrl(url)
    
    for (const [platform, config] of Object.entries(this.patterns)) {
      if (config.regex.test(cleanUrl) || config.shortRegex.test(cleanUrl)) {
        return {
          platform,
          name: config.name,
          riskLevel: config.riskLevel,
          url: cleanUrl,
          needsExpansion: config.shortRegex.test(cleanUrl)
        }
      }
    }

    throw new Error('不支持的平台链接')
  }

  /**
   * 清理和标准化URL
   * @param {string} url - 原始链接
   * @returns {string} 清理后的链接
   */
  cleanUrl(url) {
    // 移除多余的空格和换行
    let cleaned = url.trim().replace(/\s+/g, '')
    
    // 确保有协议头
    if (!cleaned.startsWith('http')) {
      cleaned = 'https://' + cleaned
    }

    return cleaned
  }

  /**
   * 提取视频ID
   * @param {string} platform - 平台类型
   * @param {string} url - 视频链接
   * @returns {string} 视频ID
   */
  extractVideoId(platform, url) {
    const config = this.patterns[platform]
    if (!config) {
      throw new Error(`不支持的平台: ${platform}`)
    }

    const match = url.match(config.regex)
    if (match && match[1]) {
      return match[1]
    }

    throw new Error('无法提取视频ID')
  }

  /**
   * 获取风险警告信息
   * @param {string} platform - 平台类型
   * @returns {Object} 风险信息
   */
  getRiskWarning(platform) {
    const config = this.patterns[platform]
    const warnings = {
      high: {
        level: '高风险',
        color: '#f44336',
        message: '该平台有严格的反爬虫机制，可能导致IP被封禁',
        suggestions: ['建议降低使用频率', '仅用于学习目的', '避免批量操作']
      },
      medium: {
        level: '中等风险',
        color: '#ff9800',
        message: '该平台相对稳定，但仍需注意使用频率',
        suggestions: ['适度使用', '遵守平台规则', '注意版权问题']
      },
      low: {
        level: '低风险',
        color: '#4caf50',
        message: '相对安全的技术实现',
        suggestions: ['正常使用', '注意版权声明']
      }
    }

    return warnings[config.riskLevel] || warnings.high
  }
}

// 导出单例
export default new PlatformParser()