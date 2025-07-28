// 结果页面 - 显示处理结果和下载链接
import VideoProcessor from '../../utils/videoProcessor.js'

Page({
  data: {
    result: null,
    isDownloading: false,
    timeRemaining: '',
    showShareModal: false
  },

  onLoad(options) {
    // 获取处理结果数据
    if (options.data) {
      try {
        const result = JSON.parse(decodeURIComponent(options.data))
        this.setData({ result })
        this.startCountdown()
      } catch (error) {
        console.error('解析结果数据失败:', error)
        this.showError('数据解析失败')
      }
    } else {
      this.showError('缺少结果数据')
    }
  },

  /**
   * 开始倒计时显示
   */
  startCountdown() {
    if (!this.data.result?.expiryTime) return

    const updateCountdown = () => {
      const now = Date.now()
      const remaining = this.data.result.expiryTime - now
      
      if (remaining <= 0) {
        this.setData({ timeRemaining: '已过期' })
        return
      }

      const hours = Math.floor(remaining / (1000 * 60 * 60))
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000)

      this.setData({
        timeRemaining: `${hours}小时${minutes}分钟${seconds}秒`
      })
    }

    updateCountdown()
    this.countdownTimer = setInterval(updateCountdown, 1000)
  },

  /**
   * 下载视频
   */
  async onDownloadClick() {
    if (!this.data.result?.downloadUrl) {
      wx.showToast({
        title: '下载链接无效',
        icon: 'error'
      })
      return
    }

    try {
      this.setData({ isDownloading: true })
      
      // 显示风险提示
      await this.showDownloadWarning()
      
      // 调用视频处理器下载
      await VideoProcessor.downloadVideo(
        this.data.result.downloadUrl,
        `coral_pure_${Date.now()}.mp4`
      )

    } catch (error) {
      console.error('下载失败:', error)
      if (error.message !== '用户取消操作') {
        wx.showToast({
          title: '下载失败',
          icon: 'error'
        })
      }
    } finally {
      this.setData({ isDownloading: false })
    }
  },

  /**
   * 显示下载风险警告
   */
  showDownloadWarning() {
    return new Promise((resolve, reject) => {
      wx.showModal({
        title: '⚠️ 下载提醒',
        content: '请确保您有权下载此视频内容。下载即表示您已了解相关版权风险并自行承担责任。',
        confirmText: '确认下载',
        cancelText: '取消',
        success: (res) => {
          if (res.confirm) {
            resolve()
          } else {
            reject(new Error('用户取消操作'))
          }
        }
      })
    })
  },

  /**
   * 预览视频
   */
  onPreviewClick() {
    if (!this.data.result?.downloadUrl) {
      wx.showToast({
        title: '预览链接无效',
        icon: 'error'
      })
      return
    }

    wx.previewMedia({
      sources: [{
        url: this.data.result.downloadUrl,
        type: 'video'
      }],
      current: 0
    })
  },

  /**
   * 分享功能
   */
  onShareClick() {
    this.setData({ showShareModal: true })
  },

  /**
   * 关闭分享弹窗
   */
  onCloseShareModal() {
    this.setData({ showShareModal: false })
  },

  /**
   * 复制链接
   */
  onCopyLinkClick() {
    if (!this.data.result?.downloadUrl) return

    wx.setClipboardData({
      data: this.data.result.downloadUrl,
      success: () => {
        wx.showToast({
          title: '链接已复制',
          icon: 'success'
        })
        this.onCloseShareModal()
      }
    })
  },

  /**
   * 返回首页
   */
  onBackHomeClick() {
    wx.switchTab({
      url: '/pages/index/index'
    })
  },

  /**
   * 显示错误信息
   */
  showError(message) {
    wx.showModal({
      title: '错误',
      content: message,
      showCancel: false,
      success: () => {
        wx.navigateBack()
      }
    })
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
  },

  /**
   * 页面卸载清理
   */
  onUnload() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer)
    }
  }
})