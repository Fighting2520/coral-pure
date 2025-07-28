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
    
    // 检查是否为游客模式
    this.isTouristMode = false
    if (wx.getAccountInfoSync) {
      try {
        const accountInfo = wx.getAccountInfoSync()
        this.isTouristMode = accountInfo.miniProgram.appId === 'touristappid'
      } catch (e) {
        console.warn('获取账号信息失败:', e)
      }
    }
  }

  /**
   * 解析URL并获取视频信息
   * @param {string} url - 视频链接
   * @returns {Promise<Object>} 视频信息
   */
  async parseUrl(url) {
    try {
      // 1. 识别平台
      const platformInfo = this.detectPlatform(url)
      
      // 2. 游客模式下返回模拟数据
      if (this.isTouristMode) {
        console.log('游客模式下，使用模拟数据')
        return this.getMockVideoInfo(platformInfo)
      }
      
      // 3. 短链接展开
      let finalUrl = url
      if (platformInfo.needsExpansion) {
        finalUrl = await this.expandShortUrl(url)
      }
      
      // 4. 提取视频ID
      const videoId = this.extractVideoId(platformInfo.platform, finalUrl)
      
      // 5. 获取视频信息
      return this.getVideoInfo(platformInfo.platform, videoId, finalUrl)
      
    } catch (error) {
      console.error('解析链接失败:', error)
      throw new Error(`解析失败: ${error.message}`)
    }
  }
  
  /**
   * 获取模拟视频信息（游客模式使用）
   * @param {Object} platformInfo - 平台信息
   * @returns {Object} 模拟视频信息
   */
  getMockVideoInfo(platformInfo) {
    return {
      platform: platformInfo.platform,
      platformName: platformInfo.name,
      url: platformInfo.url,
      title: `${platformInfo.name}视频示例`,
      author: '示例作者',
      duration: '00:30',
      coverUrl: 'https://example.com/cover.jpg',
      videoId: 'mock-video-id-' + Date.now(),
      riskLevel: platformInfo.riskLevel,
      isMockData: true
    }
  }

  /**
   * 识别平台类型
   * @param {string} url - 视频链接
   * @returns {Object} 平台信息
   */
  detectPlatform(url) {
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
   * 展开短链接
   * @param {string} shortUrl - 短链接
   * @returns {Promise<string>} 完整链接
   */
  async expandShortUrl(shortUrl) {
    // 游客模式下模拟展开
    if (this.isTouristMode) {
      console.log('游客模式下，模拟短链接展开')
      
      // 根据不同平台返回模拟的展开链接
      if (shortUrl.includes('v.douyin.com')) {
        return 'https://www.douyin.com/share/video/1234567890'
      } else if (shortUrl.includes('v.kuaishou.com')) {
        return 'https://www.kuaishou.com/short-video/1234567890'
      } else if (shortUrl.includes('b23.tv')) {
        return 'https://www.bilibili.com/video/BV1xx411c7mu'
      } else if (shortUrl.includes('vm.tiktok.com')) {
        return 'https://www.tiktok.com/@user/video/1234567890'
      }
      
      return shortUrl
    }
    
    try {
      // 实际环境中的短链接展开逻辑
      const response = await new Promise((resolve, reject) => {
        wx.request({
          url: shortUrl,
          method: 'HEAD',
          success: (res) => {
            if (res.statusCode === 302 || res.statusCode === 301) {
              resolve(res.header.Location || res.header.location)
            } else {
              reject(new Error('短链接展开失败'))
            }
          },
          fail: reject
        })
      })
      
      return response || shortUrl
    } catch (error) {
      console.error('短链接展开失败:', error)
      return shortUrl // 失败时返回原始链接
    }
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
   * 获取视频信息
   * @param {string} platform - 平台类型
   * @param {string} videoId - 视频ID
   * @param {string} url - 原始链接
   * @returns {Object} 视频信息
   */
  getVideoInfo(platform, videoId, url) {
    // 游客模式下返回模拟数据
    if (this.isTouristMode) {
      return this.getMockVideoInfo({ 
        platform, 
        name: this.patterns[platform].name,
        url,
        riskLevel: this.patterns[platform].riskLevel
      })
    }
    
    // 实际环境中的视频信息获取逻辑
    // 注意：这里应该调用云函数获取视频信息，但在游客模式下无法使用
    // 以下是各平台的实现示例
    
    switch (platform) {
      case 'bilibili':
        return {
          platform,
          platformName: '哔哩哔哩',
          url,
          title: `B站视频 ${videoId}`,
          author: 'B站用户',
          duration: '03:45',
          coverUrl: 'https://example.com/bilibili-cover.jpg',
          videoId,
          riskLevel: 'medium'
        }
        
      case 'douyin':
        return {
          platform,
          platformName: '抖音',
          url,
          title: `抖音视频 ${videoId}`,
          author: '抖音用户',
          duration: '00:15',
          coverUrl: 'https://example.com/douyin-cover.jpg',
          videoId,
          riskLevel: 'high'
        }
        
      case 'kuaishou':
        return {
          platform,
          platformName: '快手',
          url,
          title: `快手视频 ${videoId}`,
          author: '快手用户',
          duration: '00:20',
          coverUrl: 'https://example.com/kuaishou-cover.jpg',
          videoId,
          riskLevel: 'high'
        }
        
      case 'tiktok':
        return {
          platform,
          platformName: 'TikTok',
          url,
          title: `TikTok视频 ${videoId}`,
          author: 'TikTok用户',
          duration: '00:30',
          coverUrl: 'https://example.com/tiktok-cover.jpg',
          videoId,
          riskLevel: 'high'
        }
        
      default:
        throw new Error(`不支持的平台: ${platform}`)
    }
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