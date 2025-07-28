# CoralPure 开发文档

## 🚀 快速开始

### 环境要求
- 微信开发者工具 1.06.0+
- Node.js 14.0+
- 微信小程序基础库 2.2.3+

### 安装步骤

1. **克隆项目**
```bash
git clone https://github.com/your-username/coral-pure.git
cd coral-pure
```

2. **配置微信云开发**
- 在微信公众平台创建小程序
- 开通云开发服务
- 修改 `project.config.json` 中的 `appid`

3. **部署云函数**
```bash
# 在微信开发者工具中右键云函数目录
# 选择 "上传并部署：云端安装依赖"
```

4. **配置数据库**
- 在云开发控制台创建集合：`tasks`
- 设置数据库权限为 "仅创建者可读写"

## 📁 项目结构

```
coral-pure/
├── miniprogram/                 # 小程序前端
│   ├── pages/                   # 页面文件
│   │   ├── index/              # 主页
│   │   ├── result/             # 结果页
│   │   └── about/              # 关于页
│   ├── utils/                   # 工具类
│   │   ├── platformParser.js   # 平台解析器
│   │   └── videoProcessor.js   # 视频处理器
│   ├── app.js                   # 应用入口
│   ├── app.json                 # 应用配置
│   └── app.wxss                 # 全局样式
├── cloudfunctions/              # 云函数
│   └── videoProcessor/          # 视频处理云函数
├── 技术方案分析.md              # 技术方案文档
└── README.md                    # 项目说明
```

## 🔧 核心模块

### 1. 平台解析器 (platformParser.js)
负责识别和解析各平台视频链接

**支持平台：**
- ✅ B站 (相对稳定)
- ⚠️ 抖音 (高风险)
- ⚠️ 快手 (高风险)  
- ⚠️ TikTok (高风险)

**风险等级说明：**
- 🟢 低风险：技术实现相对安全
- 🟡 中等风险：需注意使用频率
- 🔴 高风险：严格反爬虫，可能IP封禁

### 2. 视频处理器 (videoProcessor.js)
处理视频下载和水印去除

**核心功能：**
- 视频下载管理
- 进度跟踪
- 风险提示
- 文件清理

### 3. 云函数 (videoProcessor)
后端业务逻辑处理

**主要功能：**
- 视频链接解析
- FFmpeg水印处理
- 云存储管理
- 定时清理任务

## ⚠️ 重要提醒

### 法律风险
1. **版权问题**：去除水印可能涉及版权侵权
2. **平台协议**：可能违反各平台用户服务协议
3. **反爬虫**：高风险平台有严格的反爬虫机制

### 技术风险
1. **IP封禁**：频繁请求可能导致IP被封
2. **接口变更**：第三方平台接口可能随时变更
3. **稳定性**：依赖外部服务，稳定性无法保证

### 合规建议
1. **仅供学习**：严格限制为技术学习用途
2. **频率控制**：添加请求频率限制
3. **用户告知**：明确告知用户风险
4. **数据保护**：不存储用户个人信息

## 🛠️ 开发指南

### 添加新平台支持

1. **在 platformParser.js 中添加平台配置**
```javascript
newPlatform: {
  regex: /your-regex-pattern/,
  shortRegex: /short-url-pattern/,
  name: '平台名称',
  riskLevel: 'high' // high/medium/low
}
```

2. **在云函数中实现解析逻辑**
```javascript
async function parseNewPlatformUrl(url) {
  // 实现具体解析逻辑
  // 注意添加风险提示和错误处理
}
```

3. **更新风险提示文案**
```javascript
// 在相关组件中添加风险警告
console.warn('⚠️ 新平台解析 - 风险等级说明')
```

### 自定义水印处理

修改云函数中的 FFmpeg 参数：
```javascript
ffmpeg(inputPath)
  .videoFilters([
    // 自定义滤镜参数
    'crop=iw-100:ih-80:0:0', // 裁剪
    'delogo=x=10:y=10:w=100:h=50' // 去logo
  ])
```

### 数据库设计

**tasks 集合结构：**
```javascript
{
  _id: "auto-generated",
  taskId: "task_timestamp_random",
  cloudUrl: "cloud://file-id",
  createTime: Date,
  expiryTime: Date,
  status: "completed|cleaned|error"
}
```

## 🔒 安全考虑

### 隐私保护
- 不记录用户操作日志
- 文件24小时自动清理
- 匿名化处理所有数据
- 不存储个人身份信息

### 数据安全
- 使用微信云开发安全环境
- 临时文件及时清理
- 云存储访问权限控制
- 敏感信息加密存储

## 📊 监控和维护

### 日志监控
- 云函数执行日志
- 错误率统计
- 性能指标监控
- 用户反馈收集

### 定期维护
- 清理过期文件
- 更新依赖包
- 检查平台接口变更
- 优化处理算法

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交代码变更
4. 发起 Pull Request

**注意事项：**
- 遵循现有代码风格
- 添加必要的注释
- 包含风险提示说明
- 更新相关文档

## 📞 支持与反馈

- 📧 邮箱：coral-pure@example.com
- 🐛 问题反馈：GitHub Issues
- 💬 讨论交流：GitHub Discussions

---

**⚠️ 免责声明：本项目仅供技术学习研究使用，开发者不承担任何法律责任。使用者需自行承担所有风险。**