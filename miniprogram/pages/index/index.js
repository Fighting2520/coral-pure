// 主页面逻辑 - 视频链接输入和处理
import PlatformParser from '../../utils/platformParser.js'
import VideoProcessor from '../../utils/videoProcessor.js'

Page({
  data: {
    inputUrl: '',
    isProcessing: false,
    progress: 0,
    currentPlatform: null,
    riskInfo: null,
    showRiskPanel: false,
    supportedPlatforms: [
      { key: 'bilibili', name: 'B站', icon: '📺', risk: 'medium' },
      { key: 'douyin', name: '抖音', icon: '🎵', risk: 'high' },
      { key: 'kuaishou', name: '快手', icon: '⚡', risk: 'high' },
      { key: 'tiktok', name: 'TikTok', icon: '🎭', risk: 'high' }
    ]
  },

  onLoad() {
    // 页面加载时显示使用提示
    this.showUsageTips()
  },

  /**
   * 显示使用提示
   */
  showUsageTips() {
    wx.showModal({
      title: '📋 使用说明',
      content: '1. 仅支持学习研究用途\n2. 请确保已获得原作者授权\n3. 文件将在24小时后自动删除\n4. 请遵守各平台使用协议',
      showCancel: false,
      confirmText: '我知道了'
    })
  },

  /**
   * 输入框内容变化
   */
  onInputChange(e) {
    const url = e.detail.value.trim()
    this.setData({ inputUrl: url })

    // 实时识别平台
    if (url) {
      try {
        const platformInfo = PlatformParser.identifyPlatform(url)
        const riskInfo = PlatformParser.getRiskWarning(platformInfo.platform)
        
        this.setData({
          currentPlatform: platformInfo,
          riskInfo: riskInfo,
          showRiskPanel: true
        })
      } catch (error) {
        this.setData({
          currentPlatform: null,
          riskInfo: null,
          showRiskPanel: false
        })
      }
    } else {
      this.setData({
        currentPlatform: null,
        riskInfo: null,
        showRiskPanel: false
      })
    }
  },

  /**
   * 粘贴剪贴板内容
   */
  async onPasteClick() {
    try {
      const clipboardData = await wx.getClipboardData()
      if (clipboardData.data) {
        this.setData({ inputUrl: clipboardData.data })
        this.onInputChange({ detail: { value: clipboardData.data } })
      }
    } catch (error) {
      wx.showToast({
        title: '粘贴失败',
        icon: 'error'
      })
    }
  },

  /**
   * 清空输入
   */
  onClearClick() {
    this.setData({
      inputUrl: '',
      currentPlatform: null,
      riskInfo: null,
      showRiskPanel: false
    })
  },

  /**
   * 开始处理视频
   */
  async onProcessClick() {
    if (!this.data.inputUrl) {
      wx.showToast({
        title: '请输入视频链接',
        icon: 'none'
      })
      return
    }

    if (!this.data.currentPlatform) {
      wx.showToast({
        title: '不支持的链接格式',
        icon: 'none'
      })
      return
    }

    try {
      this.setData({ isProcessing: true, progress: 0 })

      // 显示处理进度
      this.showProgressModal()

      // 构建视频信息
      const videoInfo = {
        url: this.data.inputUrl,
        platform: this.data.currentPlatform.platform,
        platformName: this.data.currentPlatform.name
      }

      // 调用视频处理器
      const result = await VideoProcessor.processVideo(videoInfo)

      // 处理成功，跳转到结果页面
      wx.navigateTo({
        url: `/pages/result/result?data=${encodeURIComponent(JSON.stringify(result))}`
      })

    } catch (error) {
      console.error('处理失败:', error)
      wx.showModal({
        title: '处理失败',
        content: error.message || '未知错误，请稍后重试',
        showCancel: false
      })
    } finally {
      this.setData({ isProcessing: false, progress: 0 })
      wx.hideLoading()
    }
  },

  /**
   * 显示处理进度弹窗
   */
  showProgressModal() {
    wx.showLoading({
      title: '正在处理...',
      mask: true
    })

    // 模拟进度更新
    let progress = 0
    const timer = setInterval(() => {
      progress += Math.random() * 20
      if (progress >= 90) {
        progress = 90
        clearInterval(timer)
      }
      
      this.setData({ progress: Math.floor(progress) })
      wx.showLoading({
        title: `处理中... ${Math.floor(progress)}%`
      })
    }, 500)

    // 保存定时器引用以便清理
    this.progressTimer = timer
  },

  /**
   * 查看平台支持说明
   */
  onPlatformInfoClick() {
    const content = this.data.supportedPlatforms.map(platform => {
      const riskText = platform.risk === 'high' ? '高风险' : 
                      platform.risk === 'medium' ? '中等风险' : '低风险'
      return `${platform.icon} ${platform.name} - ${riskText}`
    }).join('\n')

    wx.showModal({
      title: '🎯 支持平台',
      content: `${content}\n\n⚠️ 风险说明：\n• 高风险：严格反爬虫，可能IP封禁\n• 中等风险：相对稳定，注意频率\n• 低风险：技术实现相对安全`,
      showCancel: false,
      confirmText: '知道了'
    })
  },

  /**
   * 页面卸载时清理资源
   */
  onUnload() {
    if (this.progressTimer) {
      clearInterval(this.progressTimer)
    }
  }
})