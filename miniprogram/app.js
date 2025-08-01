// CoralPure 珊瑚去水印 - 微信小程序主入口
// 免责声明：本工具仅供技术学习使用，用户需自行承担法律责任

// 导入环境变量
import { ENV } from './.env.js'

App({
  onLaunch() {
    // 初始化云开发环境
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      try {
        wx.cloud.init({
          env: ENV.CLOUD_ENV_ID, // 从环境变量中获取云环境ID
          traceUser: false, // 不追踪用户信息，保护隐私
        })
        console.log('云开发环境初始化成功')
      } catch (error) {
        console.error('云开发环境初始化失败:', error)
        // 游客模式下提示用户
        if (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram.appId === 'touristappid') {
          console.warn('游客模式下无法使用云开发功能，部分功能将不可用')
        }
      }
    }
    
    // 显示免责声明
    this.showDisclaimerIfNeeded()
  },

  /**
   * 显示免责声明（首次使用）
   */
  showDisclaimerIfNeeded() {
    const hasAgreed = wx.getStorageSync('disclaimer_agreed')
    if (!hasAgreed) {
      wx.showModal({
        title: '⚠️ 重要声明',
        content: '本工具仅供技术学习研究使用，严禁商业用途。使用前请确保已获得原作者授权，用户需自行承担所有法律风险。',
        confirmText: '我已了解',
        cancelText: '退出',
        success: (res) => {
          if (res.confirm) {
            wx.setStorageSync('disclaimer_agreed', true)
          } else {
            wx.exitMiniProgram()
          }
        }
      })
    }
  },

  globalData: {
    userInfo: null,
    // 支持的平台配置
    supportedPlatforms: {
      douyin: { name: '抖音', risk: 'high' },
      kuaishou: { name: '快手', risk: 'high' },
      bilibili: { name: 'B站', risk: 'medium' },
      tiktok: { name: 'TikTok', risk: 'high' }
    },
    // 应用版本
    version: ENV.VERSION,
    // 开发模式
    devMode: ENV.DEV_MODE
  }
})