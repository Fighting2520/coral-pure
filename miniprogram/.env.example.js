/**
 * 环境变量配置示例
 * 使用方法：
 * 1. 复制此文件并重命名为 .env.js
 * 2. 填入您的实际配置信息
 * 3. .env.js 文件已在 .gitignore 中，不会被提交到代码仓库
 */

// 云环境配置
export const ENV = {
  // 小程序AppID（在微信公众平台获取）
  APP_ID: 'your-app-id',
  
  // 云环境ID（在微信云开发控制台获取）
  CLOUD_ENV_ID: 'your-cloud-env-id',
  
  // 应用版本
  VERSION: '1.0.0',
  
  // 开发模式（开启后会显示更多日志）
  DEV_MODE: false
}