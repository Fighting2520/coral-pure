// 首页 - 视频链接输入和处理
import platformParser from '../../utils/platformParser.js'
import VideoProcessor from '../../utils/videoProcessor.js'

Page({
  data: {
    inputUrl: '',
    isProcessing: false,
    platforms: [],
    isTouristMode: false,
    showTouristTip: false
  },

  onLoad() {
    // 获取支持的平台列表
    const app = getApp()
    const platforms = app.globalData.supportedPlatforms || {}
    
    const platformList = Object.keys(platforms).map(key => ({
      id: key,
      name: platforms[key].name,
      risk: platforms[key].risk
    }))
    
    this.setData({ platforms: platformList })
    
    // 检查是否为游客模式
    this.checkTouristMode()
  },
  
  /**
   * 检查是否为游客模式
   */
  checkTouristMode() {
    if (wx.getAccountInfoSync) {
      try {
        const accountInfo = wx.getAccountInfoSync()
        const isTouristMode = accountInfo.miniProgram.appId === 'touristappid'
        this.setData({ 
          isTouristMode,
          showTouristTip: isTouristMode
        })
        
        if (isTouristMode) {
          wx.showToast({
            title: '游客模式：部分功能受限',
            icon: 'none',
            duration: 3000
          })
        }
      } catch (e) {
        console.warn('获取账号信息失败:', e)
      }
    }
  },

  /**
   * 输入框内容变化
   */
  onInputChange(e) {
    this.setData({
      inputUrl: e.detail.value
    })
  },

  /**
   * 清空输入框
   */
  onClearInput() {
    this.setData({
      inputUrl: ''
    })
  },

  /**
   * 粘贴链接
   */
  onPasteClick() {
    wx.getClipboardData({
      success: (res) => {
        if (res.data) {
          this.setData({
            inputUrl: res.data
          })
          
          // 自动检测平台
          this.detectPlatform(res.data)
        }
      }
    })
  },

  /**
   * 检测平台类型
   */
  detectPlatform(url) {
    try {
      const platform = platformParser.detectPlatform(url)
      if (platform) {
        wx.showToast({
          title: `检测到${platform.name}链接`,
          icon: 'none'
        })
      }
    } catch (error) {
      console.log('平台检测失败:', error)
    }
  },

  /**
   * 处理按钮点击
   */
  async onProcessClick() {
    if (!this.data.inputUrl.trim()) {
      wx.showToast({
        title: '请输入视频链接',
        icon: 'error'
      })
      return
    }

    this.setData({ isProcessing: true })

    try {
      // 1. 解析链接
      const videoInfo = await platformParser.parseUrl(this.data.inputUrl)
      
      // 2. 处理视频
      const result = await VideoProcessor.processVideo(videoInfo)
      
      // 3. 跳转到结果页
      wx.navigateTo({
        url: `/pages/result/result?data=${encodeURIComponent(JSON.stringify(result))}`
      })

    } catch (error) {
      console.error('处理失败:', error)
      wx.showModal({
        title: '处理失败',
        content: error.message || '未知错误',
        showCancel: false
      })
    } finally {
      this.setData({ isProcessing: false })
    }
  },

  /**
   * 关闭游客模式提示
   */
  closeTouristTip() {
    this.setData({ showTouristTip: false })
  },

  /**
   * 页面分享
   */
  onShareAppMessage() {
    return {
      title: '珊瑚去水印 - 免费视频去水印工具',
      path: '/pages/index/index',
      imageUrl: '/images/share-cover.jpg'
    }
  }
})