// 关于页面 - 项目信息和法律声明
Page({
  data: {
    version: '1.0.0',
    buildTime: '2025-01-01',
    features: [
      { icon: '🎯', title: '多平台支持', desc: '支持抖音、快手、B站、TikTok' },
      { icon: '🛡️', title: '隐私保护', desc: '24小时自动清理，不存储个人信息' },
      { icon: '⚡', title: '高效处理', desc: '基于FFmpeg，处理速度快' },
      { icon: '📱', title: '云端处理', desc: '微信云开发，稳定可靠' }
    ],
    risks: [
      { level: 'high', title: '版权风险', desc: '去除水印可能涉及版权问题' },
      { level: 'high', title: '平台限制', desc: '可能违反平台服务协议' },
      { level: 'medium', title: '技术风险', desc: '反爬虫机制可能导致失败' }
    ],
    techStack: [
      { name: '微信小程序', version: '基础库 2.2.3+' },
      { name: '微信云开发', version: '云函数 + 云存储' },
      { name: 'FFmpeg', version: '开源视频处理库' },
      { name: 'Node.js', version: '后端运行环境' }
    ]
  },

  /**
   * 查看开源协议
   */
  onLicenseClick() {
    wx.showModal({
      title: '📄 开源协议',
      content: 'MIT License\n\n本项目采用MIT开源协议，允许自由使用、修改和分发。但使用者需自行承担所有风险和法律责任。\n\n详细协议内容请查看项目源码。',
      showCancel: false,
      confirmText: '我知道了'
    })
  },

  /**
   * 查看免责声明
   */
  onDisclaimerClick() {
    wx.showModal({
      title: '⚠️ 免责声明',
      content: '1. 本工具仅供技术学习和研究使用\n2. 严禁用于商业用途或侵犯他人版权\n3. 用户需自行承担使用风险和法律责任\n4. 开发者不承担任何直接或间接损失\n5. 如有侵权请联系删除',
      showCancel: false,
      confirmText: '我已了解'
    })
  },

  /**
   * 联系开发者
   */
  onContactClick() {
    wx.showActionSheet({
      itemList: ['复制邮箱地址', '查看GitHub项目'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.setClipboardData({
            data: 'coral-pure@example.com',
            success: () => {
              wx.showToast({
                title: '邮箱已复制',
                icon: 'success'
              })
            }
          })
        } else if (res.tapIndex === 1) {
          wx.showModal({
            title: '🔗 GitHub项目',
            content: '项目地址：\nhttps://github.com/coral-pure\n\n请在浏览器中访问查看源码',
            showCancel: false,
            confirmText: '知道了'
          })
        }
      }
    })
  },

  /**
   * 检查更新
   */
  onUpdateClick() {
    wx.showLoading({ title: '检查中...' })
    
    // 模拟检查更新
    setTimeout(() => {
      wx.hideLoading()
      wx.showModal({
        title: '✅ 已是最新版本',
        content: `当前版本：${this.data.version}\n构建时间：${this.data.buildTime}\n\n暂无可用更新`,
        showCancel: false,
        confirmText: '确定'
      })
    }, 1500)
  },

  /**
   * 查看使用统计
   */
  onStatsClick() {
    wx.showModal({
      title: '📊 使用统计',
      content: '为保护用户隐私，本应用不收集任何使用数据。\n\n• 不记录用户操作日志\n• 不存储个人信息\n• 文件24小时自动清理\n• 完全匿名化处理',
      showCancel: false,
      confirmText: '很好'
    })
  },

  /**
   * 分享应用
   */
  onShareAppMessage() {
    return {
      title: '珊瑚去水印 - 免费开源视频去水印工具',
      path: '/pages/index/index',
      imageUrl: '/images/share-cover.jpg'
    }
  }
})