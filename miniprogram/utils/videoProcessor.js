/**
 * 视频处理工具类 - 负责视频下载和水印处理
 * 技术栈：基于微信云函数 + FFmpeg
 * 合规提示：仅处理用户主动上传的内容，不存储个人信息
 */

class VideoProcessor {
  constructor() {
    this.maxFileSize = 100 * 1024 * 1024 // 100MB限制
    this.supportedFormats = ['mp4', 'mov', 'avi', 'mkv']
    this.tempFileExpiry = 24 * 60 * 60 * 1000 // 24小时自动清理
  }

  /**
   * 处理视频去水印
   * @param {Object} videoInfo - 视频信息
   * @returns {Promise<Object>} 处理结果
   */
  async processVideo(videoInfo) {
    try {
      // 1. 验证视频信息
      this.validateVideoInfo(videoInfo)

      // 2. 显示风险提示
      await this.showRiskWarning(videoInfo.platform)

      // 3. 调用云函数处理
      const result = await wx.cloud.callFunction({
        name: 'videoProcessor',
        data: {
          action: 'process',
          videoInfo: videoInfo,
          timestamp: Date.now()
        }
      })

      // 4. 处理结果
      return this.handleProcessResult(result.result)

    } catch (error) {
      console.error('视频处理失败:', error)
      throw new Error(`处理失败: ${error.message}`)
    }
  }

  /**
   * 验证视频信息
   * @param {Object} videoInfo - 视频信息
   */
  validateVideoInfo(videoInfo) {
    if (!videoInfo || !videoInfo.url) {
      throw new Error('缺少视频链接')
    }

    if (!videoInfo.platform) {
      throw new Error('无法识别视频平台')
    }

    // 检查文件大小限制
    if (videoInfo.size && videoInfo.size > this.maxFileSize) {
      throw new Error('视频文件过大，请选择小于100MB的视频')
    }
  }

  /**
   * 显示风险警告
   * @param {string} platform - 平台类型
   */
  async showRiskWarning(platform) {
    return new Promise((resolve, reject) => {
      const warnings = {
        douyin: '⚠️ 抖音平台风险提示：可能触发反爬虫机制',
        kuaishou: '⚠️ 快手平台风险提示：请注意使用频率限制',
        bilibili: '⚠️ B站平台提示：请遵守平台使用协议',
        tiktok: '⚠️ TikTok平台风险提示：海外平台访问可能不稳定'
      }

      wx.showModal({
        title: '风险提示',
        content: `${warnings[platform] || '未知平台风险'}\n\n继续操作表示您已了解相关风险并自行承担责任。`,
        confirmText: '我已了解',
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
  }

  /**
   * 处理云函数返回结果
   * @param {Object} result - 云函数结果
   * @returns {Object} 格式化结果
   */
  handleProcessResult(result) {
    if (!result.success) {
      throw new Error(result.error || '处理失败')
    }

    return {
      success: true,
      downloadUrl: result.downloadUrl,
      originalUrl: result.originalUrl,
      processTime: result.processTime,
      fileSize: result.fileSize,
      expiryTime: Date.now() + this.tempFileExpiry,
      warning: '文件将在24小时后自动删除，请及时下载'
    }
  }

  /**
   * 获取处理进度
   * @param {string} taskId - 任务ID
   * @returns {Promise<Object>} 进度信息
   */
  async getProgress(taskId) {
    try {
      const result = await wx.cloud.callFunction({
        name: 'videoProcessor',
        data: {
          action: 'getProgress',
          taskId: taskId
        }
      })

      return result.result
    } catch (error) {
      console.error('获取进度失败:', error)
      return { progress: 0, status: 'error', message: error.message }
    }
  }

  /**
   * 下载处理后的视频
   * @param {string} downloadUrl - 下载链接
   * @param {string} filename - 文件名
   */
  async downloadVideo(downloadUrl, filename = 'coral_pure_video.mp4') {
    try {
      wx.showLoading({ title: '准备下载...' })

      // 下载文件到本地
      const downloadResult = await wx.downloadFile({
        url: downloadUrl,
        success: (res) => {
          if (res.statusCode === 200) {
            // 保存到相册
            wx.saveVideoToPhotosAlbum({
              filePath: res.tempFilePath,
              success: () => {
                wx.showToast({
                  title: '保存成功',
                  icon: 'success'
                })
              },
              fail: (error) => {
                console.error('保存失败:', error)
                wx.showToast({
                  title: '保存失败',
                  icon: 'error'
                })
              }
            })
          }
        }
      })

    } catch (error) {
      console.error('下载失败:', error)
      wx.showToast({
        title: '下载失败',
        icon: 'error'
      })
    } finally {
      wx.hideLoading()
    }
  }

  /**
   * 清理临时文件（定时任务）
   */
  async cleanupTempFiles() {
    try {
      await wx.cloud.callFunction({
        name: 'videoProcessor',
        data: {
          action: 'cleanup',
          timestamp: Date.now()
        }
      })
    } catch (error) {
      console.error('清理临时文件失败:', error)
    }
  }
}

// 导出单例
export default new VideoProcessor()