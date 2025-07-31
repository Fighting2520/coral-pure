// 首页 - 视频链接输入和处理
import platformParser from '../../utils/platformParser.js'
import VideoProcessor from '../../utils/videoProcessor.js'

Page({
  data: {
    inputUrl: '',
    isProcessing: false,
    platforms: [],
    isTouristMode: false,
    showTouristTip: false,
    activeTab: 'upload', // 默认显示上传功能
    selectedVideo: null,
    maxDurationText: '时长最长3分钟', // 默认显示3分钟，会根据实际情况更新
    processProgress: 0, // 处理进度
    progressText: '' // 进度文本
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
    
    // 检测设备支持的视频时长限制
    this.detectVideoCapability()
  },

  /**
   * 检测设备支持的视频时长限制
   */
  detectVideoCapability() {
    // 使用新的API获取系统信息
    try {
      const appBaseInfo = wx.getAppBaseInfo()
      const deviceInfo = wx.getDeviceInfo()
      
      const version = appBaseInfo.version
      const platform = deviceInfo.platform
      
      console.log('系统信息:', { version, platform })
      
      // 更保守的检测策略：大多数设备实际只支持60秒
      // 只有在特定条件下才使用180秒
      const versionNum = parseFloat(version)
      const isVeryNewVersion = versionNum >= 8.1 // 提高版本要求
      const isIOS = platform === 'ios'
      
      // 更严格的判断条件
      if (isVeryNewVersion && isIOS) {
        // 只有iOS且版本很新才尝试3分钟
        console.log('检测到iOS新版本，尝试3分钟限制')
        this.setData({
          maxDurationText: '时长最长3分钟'
        })
      } else {
        // 其他情况都使用60秒限制
        console.log('使用保守的60秒限制')
        this.setData({
          maxDurationText: '时长不超过60秒'
        })
      }
    } catch (error) {
      console.warn('获取系统信息失败，使用60秒限制:', error)
      // 如果获取系统信息失败，使用保守的60秒设置
      this.setData({
        maxDurationText: '时长不超过60秒'
      })
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
   * 切换功能标签
   */
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ activeTab: tab })
    
    if (tab === 'link') {
      wx.showToast({
        title: '该功能开发中',
        icon: 'none'
      })
    }
  },

  /**
   * 选择视频文件
   */
  chooseVideo() {
    // 根据当前显示的时长限制来决定使用的参数
    const maxDuration = this.data.maxDurationText.includes('3分钟') ? 180 : 60
    
    console.log(`使用时长限制: ${maxDuration}秒`)
    
    wx.chooseVideo({
      sourceType: ['album', 'camera'],
      maxDuration: maxDuration,
      camera: 'back',
      success: (res) => {
        console.log('选择视频成功:', res)
        
        // 检查文件大小（100MB限制）
        const maxSize = 100 * 1024 * 1024
        if (res.size > maxSize) {
          wx.showModal({
            title: '文件过大',
            content: '视频文件不能超过100MB，请选择较小的文件',
            showCancel: false
          })
          return
        }
        
        this.setData({
          selectedVideo: {
            tempFilePath: res.tempFilePath,
            duration: res.duration,
            size: this.formatFileSize(res.size),
            name: `视频_${new Date().getTime()}.mp4`
          }
        })
        
        wx.showToast({
          title: '视频选择成功',
          icon: 'success'
        })
      },
      fail: (error) => {
        console.error('选择视频失败:', error)
        
        // 如果是时长限制错误且当前使用的是180秒，尝试降级到60秒
        if (error.errMsg && error.errMsg.includes('maxDuration') && maxDuration === 180) {
          console.log('180秒限制失败，尝试60秒限制')
          this.chooseVideoWithFallback()
        } else if (error.errMsg !== 'chooseVideo:fail cancel') {
          wx.showToast({
            title: '选择视频失败',
            icon: 'error'
          })
        }
      }
    })
  },

  /**
   * 降级选择视频（60秒限制）
   */
  chooseVideoWithFallback() {
    // 更新页面提示文案为60秒
    this.setData({
      maxDurationText: '时长不超过60秒'
    })
    
    wx.chooseVideo({
      sourceType: ['album', 'camera'],
      maxDuration: 60, // 降级到60秒
      camera: 'back',
      success: (res) => {
        console.log('降级选择视频成功:', res)
        
        // 检查文件大小（100MB限制）
        const maxSize = 100 * 1024 * 1024
        if (res.size > maxSize) {
          wx.showModal({
            title: '文件过大',
            content: '视频文件不能超过100MB，请选择较小的文件',
            showCancel: false
          })
          return
        }
        
        this.setData({
          selectedVideo: {
            tempFilePath: res.tempFilePath,
            duration: res.duration,
            size: this.formatFileSize(res.size),
            name: `视频_${new Date().getTime()}.mp4`
          }
        })
        
        wx.showToast({
          title: '视频选择成功',
          icon: 'success'
        })
        
        // 提示用户时长限制
        wx.showModal({
          title: '时长限制提示',
          content: '当前设备限制视频时长为60秒，页面提示已更新。如需处理更长视频，请在较新的微信版本中使用',
          showCancel: false
        })
      },
      fail: (error) => {
        console.error('降级选择视频也失败:', error)
        if (error.errMsg !== 'chooseVideo:fail cancel') {
          wx.showToast({
            title: '选择视频失败',
            icon: 'error'
          })
        }
      }
    })
  },

  /**
   * 处理上传的视频
   */
  async onProcessVideo() {
    if (!this.data.selectedVideo) {
      wx.showToast({
        title: '请先选择视频',
        icon: 'error'
      })
      return
    }

    this.setData({ 
      isProcessing: true,
      processProgress: 0,
      progressText: '准备上传...'
    })

    try {
      // 准备视频文件信息
      const videoFile = {
        tempFilePath: this.data.selectedVideo.tempFilePath,
        name: this.data.selectedVideo.name,
        size: this.data.selectedVideo.size
      }

      // 1. 先上传视频到云存储
      this.updateProgress(10, '上传视频中...')
      
      const cloudPath = `videos/upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp4`
      
      // 模拟上传进度
      this.simulateUploadProgress()
      
      const uploadResult = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: videoFile.tempFilePath
      })

      this.updateProgress(50, '上传完成，开始处理...')

      // 2. 调用云函数处理视频（增加超时处理）
      let result
      try {
        // 模拟处理进度
        this.simulateProcessProgress()
        
        result = await wx.cloud.callFunction({
          name: 'videoProcessor',
          data: {
            action: 'processUploadedVideo',
            fileId: uploadResult.fileID,
            fileName: videoFile.name,
            fileSize: videoFile.size
          }
        })
      } catch (cloudError) {
        // 如果是超时错误，提供友好提示
        if (cloudError.message && cloudError.message.includes('timeout')) {
          this.updateProgress(0, '')
          wx.showModal({
            title: '处理超时',
            content: '视频处理时间较长，可能是文件较大或网络较慢。建议：\n1. 选择较小的视频文件\n2. 检查网络连接\n3. 稍后重试',
            showCancel: false
          })
          return
        }
        throw cloudError
      }

      this.updateProgress(100, '处理完成')

      if (result.result.success) {
        const processResult = {
          success: true,
          videoUrl: result.result.videoUrl,
          title: videoFile.name,
          platform: '本地上传',
          processTime: result.result.processTime,
          originalSize: videoFile.size,
          processedSize: result.result.processedSize,
          expiryTime: result.result.expiryTime || (Date.now() + 24 * 60 * 60 * 1000) // 24小时后过期
        }

        // 跳转到结果页
        wx.navigateTo({
          url: `/pages/result/result?data=${encodeURIComponent(JSON.stringify(processResult))}`
        })
      } else {
        throw new Error(result.result.error || '处理失败')
      }

    } catch (error) {
      console.error('处理失败:', error)
      wx.showModal({
        title: '处理失败',
        content: error.message || '视频处理失败，请重试',
        showCancel: false
      })
    } finally {
      this.setData({ 
        isProcessing: false,
        processProgress: 0,
        progressText: ''
      })
    }
  },

  /**
   * 更新进度显示
   */
  updateProgress(progress, text) {
    this.setData({
      processProgress: Math.floor(progress), // 确保进度为整数
      progressText: text
    })
  },

  /**
   * 模拟上传进度
   */
  simulateUploadProgress() {
    let progress = 10
    const interval = setInterval(() => {
      progress += Math.random() * 8 + 2 // 每次增加2-10%
      if (progress >= 50) {
        progress = 50
        clearInterval(interval)
      }
      this.updateProgress(progress, `上传中... ${Math.floor((progress - 10) / 40 * 100)}%`)
    }, 500)

    // 清理定时器
    this.uploadInterval = interval
  },

  /**
   * 模拟处理进度
   */
  simulateProcessProgress() {
    let progress = 50
    const interval = setInterval(() => {
      progress += Math.random() * 8 + 2 // 每次增加2-10%
      if (progress > 95) {
        progress = 95
        clearInterval(interval)
      }
      this.updateProgress(progress, '视频处理中...')
    }, 1000)

    // 清理定时器
    this.processInterval = interval
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
   * 处理按钮点击（保留原有链接解析逻辑，但不再使用）
   */
  async onProcessClick() {
    wx.showToast({
      title: '该功能开发中',
      icon: 'none'
    })
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
  },

  /**
   * 页面卸载清理
   */
  onUnload() {
    if (this.uploadInterval) {
      clearInterval(this.uploadInterval)
    }
    if (this.processInterval) {
      clearInterval(this.processInterval)
    }
  }
})