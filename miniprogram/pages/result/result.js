// 结果页面 - 显示处理结果和下载链接
import VideoProcessor from '../../utils/videoProcessor.js'

Page({
  data: {
    result: null,
    isDownloading: false,
    timeRemaining: '',
    showShareModal: false,
    isMockData: false,
    isTouristMode: false
  },

  onLoad(options) {
    // 检查是否为游客模式
    this.checkTouristMode()

    // 获取处理结果数据
    if (options.data) {
      try {
        const result = JSON.parse(decodeURIComponent(options.data))
        console.log('result:', result)

        // 检查是否为模拟数据
        const isMockData = result.isMockData || false

        // 格式化文件大小显示
        if (result.processedSize && typeof result.processedSize === 'number') {
          result.processedSize = this.formatFileSize(result.processedSize)
        }

        this.setData({
          result,
          isMockData
        })

        // 如果不是模拟数据，启动倒计时
        if (!isMockData) {
          this.startCountdown()
        }

        // 游客模式下显示提示
        if (isMockData && this.data.isTouristMode) {
          wx.showToast({
            title: '游客模式：模拟数据',
            icon: 'none',
            duration: 2000
          })
        }
      } catch (error) {
        console.error('解析结果数据失败:', error)
        this.showError('数据解析失败')
      }
    } else {
      this.showError('缺少结果数据')
    }
  },

  /**
   * 检查是否为游客模式
   */
  checkTouristMode() {
    if (wx.getAccountInfoSync) {
      try {
        const accountInfo = wx.getAccountInfoSync()
        const isTouristMode = accountInfo.miniProgram.appId === 'touristappid'
        this.setData({ isTouristMode })
      } catch (e) {
        console.warn('获取账号信息失败:', e)
      }
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
    // 游客模式或模拟数据处理
    if (this.data.isMockData || this.data.isTouristMode) {
      wx.showModal({
        title: '游客模式提示',
        content: '游客模式下无法下载视频，请部署到真实环境使用。',
        showCancel: false
      })
      return
    }

    // 修复字段名：使用videoUrl而不是downloadUrl
    // 修复字段名：使用videoUrl而不是downloadUrl
    const videoUrl = this.data.result?.videoUrl || this.data.result?.downloadUrl
    if (!videoUrl) {
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

      // 使用微信原生API下载视频到相册
      wx.showLoading({ title: '获取下载链接...' })

      let downloadUrl = videoUrl

      // 如果是云存储链接，需要先获取临时下载链接
      if (videoUrl.startsWith('cloud://')) {
        console.log('检测到云存储链接，获取临时下载链接...')

        try {
          const tempUrlResult = await wx.cloud.getTempFileURL({
            fileList: [videoUrl]
          })

          if (tempUrlResult.fileList && tempUrlResult.fileList.length > 0) {
            downloadUrl = tempUrlResult.fileList[0].tempFileURL
            console.log('获取临时下载链接成功:', downloadUrl.substring(0, 100) + '...')
          } else {
            throw new Error('无法获取临时下载链接')
          }
        } catch (tempUrlError) {
          console.error('获取临时下载链接失败:', tempUrlError)
          throw new Error('获取下载链接失败，请重试')
        }
      }

      wx.showLoading({ title: '下载中...' })

      // 先下载到临时文件
      const downloadResult = await new Promise((resolve, reject) => {
        wx.downloadFile({
          url: downloadUrl,
          success: (res) => {
            console.log('下载结果:', res)
            resolve(res)
          },
          fail: (error) => {
            console.error('下载失败:', error)
            reject(error)
          }
        })
      })

      console.log('下载状态码:', downloadResult.statusCode)
      console.log('临时文件路径:', downloadResult.tempFilePath)

      if (downloadResult.statusCode === 200 && downloadResult.tempFilePath) {
        // 保存到相册
        await new Promise((resolve, reject) => {
          wx.saveVideoToPhotosAlbum({
            filePath: downloadResult.tempFilePath,
            success: (res) => {
              console.log('保存到相册成功:', res)
              resolve(res)
            },
            fail: (error) => {
              console.error('保存到相册失败:', error)
              reject(error)
            }
          })
        })

        wx.hideLoading()
        wx.showToast({
          title: '已保存到相册',
          icon: 'success'
        })
      } else {
        throw new Error(`下载失败，状态码: ${downloadResult.statusCode || '未知'}`)
      }

    } catch (error) {
      console.error('下载失败:', error)
      wx.hideLoading()

      let errorMessage = '下载过程中出现错误，请重试'

      if (error.errMsg) {
        if (error.errMsg.includes('saveVideoToPhotosAlbum:fail auth deny')) {
          wx.showModal({
            title: '权限不足',
            content: '需要相册权限才能保存视频，请在设置中开启权限后重试',
            showCancel: false
          })
          return
        } else if (error.errMsg.includes('downloadFile:fail')) {
          errorMessage = '视频下载失败，可能是网络问题或链接已过期'
        } else if (error.errMsg.includes('saveVideoToPhotosAlbum:fail')) {
          errorMessage = '保存到相册失败，请检查存储空间是否充足'
        }
      } else if (error.message && error.message !== '用户取消操作') {
        errorMessage = error.message
      }

      if (error.message !== '用户取消操作') {
        wx.showModal({
          title: '下载失败',
          content: errorMessage,
          showCancel: false
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
    // 游客模式或模拟数据处理
    if (this.data.isMockData || this.data.isTouristMode) {
      wx.showModal({
        title: '游客模式提示',
        content: '游客模式下无法预览视频，请部署到真实环境使用。',
        showCancel: false
      })
      return
    }

    // 修复字段名：使用videoUrl而不是downloadUrl
    const videoUrl = this.data.result?.videoUrl || this.data.result?.downloadUrl
    if (!videoUrl) {
      wx.showToast({
        title: '预览链接无效',
        icon: 'error'
      })
      return
    }

    console.log('预览视频URL:', videoUrl)

    try {
      wx.previewMedia({
        sources: [{
          url: videoUrl,
          type: 'video'
        }],
        current: 0,
        fail: (error) => {
          console.error('预览失败:', error)
          wx.showModal({
            title: '预览失败',
            content: '无法预览视频，可能是链接已过期或格式不支持',
            showCancel: false
          })
        }
      })
    } catch (error) {
      console.error('预览异常:', error)
      wx.showModal({
        title: '预览失败',
        content: '预览功能出现异常，请重试',
        showCancel: false
      })
    }
  },

  /**
   * 分享功能
   */
  onShareClick() {
    // 游客模式或模拟数据处理
    if (this.data.isMockData || this.data.isTouristMode) {
      wx.showModal({
        title: '游客模式提示',
        content: '游客模式下无法分享视频，请部署到真实环境使用。',
        showCancel: false
      })
      return
    }

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
  async onCopyLinkClick() {
    // 修复字段名：使用videoUrl而不是downloadUrl
    const videoUrl = this.data.result?.videoUrl || this.data.result?.downloadUrl
    if (!videoUrl) {
      wx.showToast({
        title: '链接无效',
        icon: 'error'
      })
      return
    }

    // 游客模式或模拟数据处理
    if (this.data.isMockData || this.data.isTouristMode) {
      wx.showModal({
        title: '游客模式提示',
        content: '游客模式下无法复制链接，请部署到真实环境使用。',
        showCancel: false
      })
      return
    }

    try {
      wx.showLoading({ title: '获取分享链接...' })

      let shareUrl = videoUrl

      // 如果是云存储链接，需要先获取临时下载链接
      if (videoUrl.startsWith('cloud://')) {
        console.log('检测到云存储链接，获取临时分享链接...')
        
        try {
          const tempUrlResult = await wx.cloud.getTempFileURL({
            fileList: [videoUrl]
          })

          if (tempUrlResult.fileList && tempUrlResult.fileList.length > 0) {
            shareUrl = tempUrlResult.fileList[0].tempFileURL
            console.log('获取临时分享链接成功')
          } else {
            throw new Error('无法获取临时分享链接')
          }
        } catch (tempUrlError) {
          console.error('获取临时分享链接失败:', tempUrlError)
          wx.hideLoading()
          wx.showToast({
            title: '获取分享链接失败',
            icon: 'error'
          })
          return
        }
      }

      wx.hideLoading()

      wx.setClipboardData({
        data: shareUrl,
        success: () => {
          wx.showToast({
            title: '链接已复制',
            icon: 'success'
          })
          this.onCloseShareModal()
        },
        fail: (error) => {
          console.error('复制失败:', error)
          wx.showToast({
            title: '复制失败',
            icon: 'error'
          })
        }
      })
    } catch (error) {
      console.error('复制链接异常:', error)
      wx.hideLoading()
      wx.showToast({
        title: '操作失败，请重试',
        icon: 'error'
      })
    }
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
   * 格式化文件大小
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
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