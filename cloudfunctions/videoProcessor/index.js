/**
 * 视频处理云函数 - 核心业务逻辑
 * 功能：视频下载、水印去除、文件管理
 * 风险提示：涉及第三方平台内容处理，需注意合规性
 */

const cloud = require('wx-server-sdk')
const axios = require('axios')
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const path = require('path')

// 设置FFmpeg路径（云函数层中的路径）
ffmpeg.setFfmpegPath('/opt/bin/ffmpeg')
ffmpeg.setFfprobePath('/opt/bin/ffprobe')

// 初始化云开发
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 创建一个简单的测试函数
exports.test = async () => {
  return {
    success: true,
    message: "云函数环境测试成功",
    sdkVersion: cloud.version || "未知"
  }
}

// 配置常量
const CONFIG = {
  MAX_FILE_SIZE: 100 * 1024 * 1024, // 100MB
  TEMP_DIR: '/tmp',
  EXPIRY_HOURS: 24,
  SUPPORTED_FORMATS: ['mp4', 'mov', 'avi', 'mkv'],
  USER_AGENTS: [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
    'Mozilla/5.0 (Android 10; Mobile; rv:81.0) Gecko/81.0 Firefox/81.0'
  ]
}

/**
 * 云函数主入口
 */
exports.main = async (event, context) => {
  const { action } = event

  try {
    switch (action) {
      case 'process':
        return await processVideo(event)
      case 'getProgress':
        return await getProgress(event)
      case 'cleanup':
        return await cleanupExpiredFiles(event)
      case 'test':
        // 简单测试函数，用于验证云函数环境
        return {
          success: true,
          message: "云函数环境测试成功",
          sdkVersion: cloud.version || "未知",
          timestamp: Date.now(),
          event: event
        }
      case 'testBilibili':
        // 测试B站视频解析
        if (!event.url) {
          return { success: false, error: "缺少视频链接" }
        }
        try {
          const videoData = await parseBilibiliUrl(event.url)
          return {
            success: true,
            videoData: {
              url: videoData.url.substring(0, 100) + '...',
              title: videoData.title,
              format: videoData.format,
              duration: videoData.duration
            },
            message: "B站视频解析成功"
          }
        } catch (error) {
          return {
            success: false,
            error: error.message,
            message: "B站视频解析失败"
          }
        }
      default:
        throw new Error(`不支持的操作: ${action}`)
    }
  } catch (error) {
    console.error('云函数执行失败:', error)
    return {
      success: false,
      error: error.message || '处理失败'
    }
  }
}

/**
 * 处理视频去水印
 * @param {Object} event - 事件参数
 */
async function processVideo(event) {
  const { videoInfo, timestamp } = event
  const taskId = generateTaskId(timestamp)

  console.log(`开始处理视频任务: ${taskId}`)

  try {
    // 1. 验证输入参数
    validateVideoInfo(videoInfo)

    // 2. 解析视频真实地址
    const videoData = await parseVideoUrl(videoInfo)

    // 3. 下载视频文件
    const localPath = await downloadVideo(videoData, taskId)

    // 4. 检测和去除水印
    const processedPath = await removeWatermark(localPath, taskId)

    // 5. 上传到云存储
    const cloudUrl = await uploadToCloud(processedPath, taskId)

    // 6. 清理临时文件
    cleanupTempFiles([localPath, processedPath])

    // 7. 记录任务信息（用于清理）
    await recordTask(taskId, cloudUrl, timestamp)

    return {
      success: true,
      taskId: taskId,
      downloadUrl: cloudUrl,
      originalUrl: videoInfo.url,
      title: videoData.title || '未知标题',
      processTime: `${Date.now() - timestamp}ms`,
      fileSize: await getFileSize(processedPath),
      expiryTime: timestamp + (CONFIG.EXPIRY_HOURS * 60 * 60 * 1000)
    }

  } catch (error) {
    console.error(`任务 ${taskId} 处理失败:`, error)
    throw error
  }
}

/**
 * 验证视频信息
 * @param {Object} videoInfo - 视频信息
 */
function validateVideoInfo(videoInfo) {
  if (!videoInfo || !videoInfo.url) {
    throw new Error('缺少视频链接')
  }

  if (!videoInfo.platform) {
    throw new Error('无法识别视频平台')
  }

  // 合规性检查
  const riskPlatforms = ['douyin', 'kuaishou', 'tiktok']
  if (riskPlatforms.includes(videoInfo.platform)) {
    console.warn(`⚠️ 高风险平台: ${videoInfo.platform}，请注意合规性`)
  }
}

/**
 * 解析视频真实地址
 * @param {Object} videoInfo - 视频信息
 * @returns {Object} 视频详细信息，包含URL和请求头
 */
async function parseVideoUrl(videoInfo) {
  const { platform, url } = videoInfo

  console.log(`解析 ${platform} 平台链接: ${url}`)

  try {
    switch (platform) {
      case 'bilibili':
        return await parseBilibiliUrl(url)
      case 'douyin':
        return await parseDouyinUrl(url)
      case 'kuaishou':
        return await parseKuaishouUrl(url)
      case 'tiktok':
        return await parseTiktokUrl(url)
      default:
        throw new Error(`不支持的平台: ${platform}`)
    }
  } catch (error) {
    console.error(`解析 ${platform} 链接失败:`, error)
    throw new Error(`链接解析失败: ${error.message}`)
  }
}

/**
 * 解析B站视频链接
 * @param {string} url - B站链接
 * @returns {Object} 视频信息对象
 */
async function parseBilibiliUrl(url) {
  // 提取BV号 - 支持带查询参数的链接
  const bvMatch = url.match(/BV[A-Za-z0-9]+/)
  if (!bvMatch) {
    throw new Error('无效的B站链接格式')
  }

  const bvid = bvMatch[0]
  console.log(`解析B站视频: ${bvid}`)

  // 记录详细的调试信息
  console.log(`完整链接: ${url}`)
  console.log(`提取的BV号: ${bvid}`)

  try {
    // 调用B站API获取视频信息
    const response = await axios.get(`https://api.bilibili.com/x/web-interface/view`, {
      params: { bvid },
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Referer': 'https://www.bilibili.com'
      },
      timeout: 10000
    })

    // 记录API响应
    console.log(`B站API响应状态码: ${response.status}`)
    console.log(`B站API响应code: ${response.data.code}`)

    if (response.data.code !== 0) {
      throw new Error(`B站API错误: ${response.data.message || '未知错误'}`)
    }

    if (!response.data.data) {
      throw new Error('B站API返回数据结构异常: 缺少data字段')
    }

    const videoData = response.data.data
    console.log(`视频标题: ${videoData.title}`)

    if (!videoData.cid) {
      throw new Error('B站API返回数据结构异常: 缺少cid字段')
    }

    const cid = videoData.cid
    console.log(`获取到cid: ${cid}`)

    // 获取视频播放地址
    console.log(`开始获取视频播放地址，bvid: ${bvid}, cid: ${cid}`)

    // 使用不同的API获取视频地址
    const playResponse = await axios.get(`https://api.bilibili.com/x/player/wbi/playurl`, {
      params: {
        bvid,
        cid,
        qn: 16, // 使用较低的清晰度，360P
        fnval: 1,
        fnver: 0,
        fourk: 0
      },
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Referer': 'https://www.bilibili.com',
        'Origin': 'https://www.bilibili.com'
      },
      timeout: 10000
    })

    // 记录播放地址API响应
    console.log(`播放地址API响应状态码: ${playResponse.status}`)
    console.log(`播放地址API响应code: ${playResponse.data.code}`)

    if (playResponse.data.code !== 0) {
      throw new Error(`获取播放地址失败: ${playResponse.data.message || '未知错误'}`)
    }

    // 记录返回的数据结构
    console.log(`播放地址API返回数据结构: ${JSON.stringify(playResponse.data).substring(0, 200)}...`)

    // 安全地获取视频URL
    if (!playResponse.data.data) {
      throw new Error('无法获取视频地址，返回数据缺少data字段')
    }

    // 检查是否有durl字段
    if (playResponse.data.data.durl && Array.isArray(playResponse.data.data.durl) && playResponse.data.data.durl.length > 0) {
      const videoUrl = playResponse.data.data.durl[0].url
      console.log(`B站视频解析成功(durl格式): ${videoUrl.substring(0, 50)}...`)

      // 返回视频信息对象
      return {
        url: videoUrl,
        title: videoData.title,
        duration: videoData.duration,
        format: 'mp4',
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Referer': 'https://www.bilibili.com',
          'Origin': 'https://www.bilibili.com',
          'Cookie': 'CURRENT_FNVAL=16;'
        }
      }
    }
    // 尝试获取dash格式的视频地址
    else if (playResponse.data.data.dash && playResponse.data.data.dash.video && playResponse.data.data.dash.video.length > 0) {
      const videoUrl = playResponse.data.data.dash.video[0].baseUrl
      console.log(`B站视频解析成功(dash格式): ${videoUrl.substring(0, 50)}...`)

      // 返回视频信息对象
      return {
        url: videoUrl,
        title: videoData.title,
        duration: videoData.duration,
        format: 'mp4',
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Referer': 'https://www.bilibili.com',
          'Origin': 'https://www.bilibili.com',
          'Cookie': 'CURRENT_FNVAL=16;'
        }
      }
    } else {
      throw new Error('无法获取视频地址，返回数据结构异常：既没有durl也没有dash字段')
    }

  } catch (error) {
    console.error('B站解析失败:', error)
    throw new Error(`B站视频解析失败: ${error.message}`)
  }
}

/**
 * 解析抖音视频链接（高风险操作）
 * @param {string} url - 抖音链接
 * @returns {string} 视频地址
 */
async function parseDouyinUrl(url) {
  console.warn('⚠️ 抖音解析 - 高风险操作，可能触发反爬虫机制')

  // 这里应该实现抖音链接解析逻辑
  // 由于抖音有严格的反爬虫机制，实际实现需要更复杂的策略
  throw new Error('抖音解析功能暂未实现 - 风险过高')
}

/**
 * 解析快手视频链接（高风险操作）
 * @param {string} url - 快手链接
 * @returns {string} 视频地址
 */
async function parseKuaishouUrl(url) {
  console.warn('⚠️ 快手解析 - 高风险操作，可能违反平台协议')

  // 快手解析逻辑
  throw new Error('快手解析功能暂未实现 - 风险过高')
}

/**
 * 解析TikTok视频链接（高风险操作）
 * @param {string} url - TikTok链接
 * @returns {string} 视频地址
 */
async function parseTiktokUrl(url) {
  console.warn('⚠️ TikTok解析 - 高风险操作，海外平台访问不稳定')

  // TikTok解析逻辑
  throw new Error('TikTok解析功能暂未实现 - 风险过高')
}

/**
 * 下载视频文件
 * @param {Object} videoInfo - 视频信息对象，包含URL和请求头
 * @param {string} taskId - 任务ID
 * @returns {string} 本地文件路径
 */
async function downloadVideo(videoInfo, taskId) {
  const fileName = `${taskId}_original.mp4`
  const filePath = path.join(CONFIG.TEMP_DIR, fileName)

  console.log(`开始下载视频: ${fileName}`)

  // 确保videoInfo是对象格式
  let videoUrl, headers;
  if (typeof videoInfo === 'string') {
    // 兼容旧版本，如果传入的是字符串URL
    videoUrl = videoInfo;
    headers = {
      'User-Agent': getRandomUserAgent(),
      'Referer': 'https://www.bilibili.com',
      'Origin': 'https://www.bilibili.com',
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Range': 'bytes=0-'
    };
  } else {
    // 新版本，使用对象格式
    videoUrl = videoInfo.url;
    headers = videoInfo.headers || {};

    // 确保基本请求头存在
    if (!headers['User-Agent']) headers['User-Agent'] = getRandomUserAgent();
    if (!headers['Accept']) headers['Accept'] = '*/*';
    if (!headers['Range']) headers['Range'] = 'bytes=0-';
  }

  console.log(`视频URL: ${videoUrl.substring(0, 100)}...`);
  console.log('使用以下请求头:');
  console.log(JSON.stringify(headers));

  try {
    const response = await axios({
      method: 'GET',
      url: videoUrl,
      responseType: 'stream',
      headers: headers,
      timeout: 60000, // 增加超时时间到60秒
      maxContentLength: CONFIG.MAX_FILE_SIZE,
      maxRedirects: 5
    });

    console.log(`下载响应状态码: ${response.status}`);

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`视频下载完成: ${fileName}`);
        try {
          // 检查文件大小确认下载成功
          const stats = fs.statSync(filePath);
          console.log(`下载文件大小: ${stats.size} 字节`);
          if (stats.size > 0) {
            resolve(filePath);
          } else {
            reject(new Error('下载文件大小为0，可能下载失败'));
          }
        } catch (err) {
          console.error(`检查文件失败: ${err.message}`);
          reject(err);
        }
      });
      writer.on('error', (err) => {
        console.error(`文件写入错误: ${err.message}`);
        reject(err);
      });
    });

  } catch (error) {
    console.error('视频下载失败:', error);
    // 提供更详细的错误信息
    const errorMsg = error.response
      ? `下载失败: 状态码 ${error.response.status} - ${error.message}`
      : `下载失败: ${error.message}`;
    throw new Error(errorMsg);
  }
}

/**
 * 去除视频水印
 * @param {string} inputPath - 输入文件路径
 * @param {string} taskId - 任务ID
 * @returns {string} 处理后文件路径
 */
async function removeWatermark(inputPath, taskId) {
  const outputPath = path.join(CONFIG.TEMP_DIR, `${taskId}_processed.mp4`)

  console.log(`开始去除水印: ${taskId}`)

  // 设置FFmpeg路径（如果使用了层）
  try {
    const ffmpegPath = '/opt/bin/ffmpeg';
    const ffprobePath = '/opt/bin/ffprobe';

    if (fs.existsSync(ffmpegPath)) {
      console.log(`使用FFmpeg路径: ${ffmpegPath}`);
      ffmpeg.setFfmpegPath(ffmpegPath);
    }

    if (fs.existsSync(ffprobePath)) {
      console.log(`使用FFprobe路径: ${ffprobePath}`);
      ffmpeg.setFfprobePath(ffprobePath);
    }
  } catch (error) {
    console.warn(`设置FFmpeg路径失败: ${error.message}`);
  }

  // 检查输入文件
  try {
    const stats = fs.statSync(inputPath);
    console.log(`输入文件大小: ${stats.size} 字节`);
    if (stats.size === 0) {
      throw new Error('输入文件大小为0，无法处理');
    }
  } catch (error) {
    console.error(`检查输入文件失败: ${error.message}`);
    throw error;
  }

  return new Promise((resolve, reject) => {
    // 使用FFmpeg去除水印
    // 这里使用简单的裁剪方式，实际应用中可能需要更复杂的算法
    ffmpeg(inputPath)
      .videoFilters([
        // 裁剪掉常见水印位置（右下角）
        'crop=iw-100:ih-80:0:0'
      ])
      .outputOptions([
        '-c:v libx264',
        '-preset ultrafast', // 使用最快的预设
        '-crf 28', // 降低质量以加快处理
        '-c:a copy',
        '-t 30' // 限制输出视频长度为30秒（测试用）
      ])
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('FFmpeg命令:', commandLine)
      })
      .on('progress', (progress) => {
        if (progress && progress.percent) {
          console.log(`处理进度: ${Math.round(progress.percent)}%`)
        } else {
          console.log('处理中...')
        }
      })
      .on('end', () => {
        console.log(`水印去除完成: ${taskId}`)
        resolve(outputPath)
      })
      .on('error', (error) => {
        console.error('FFmpeg处理失败:', error)
        reject(new Error(`水印处理失败: ${error.message}`))
      })
      .run()
  })
}

/**
 * 上传文件到云存储
 * @param {string} filePath - 本地文件路径
 * @param {string} taskId - 任务ID
 * @returns {string} 云存储URL
 */
async function uploadToCloud(filePath, taskId) {
  const cloudPath = `processed/${taskId}.mp4`

  console.log(`上传到云存储: ${cloudPath}`)

  try {
    // 读取文件内容
    const fileContent = fs.readFileSync(filePath)

    // 使用云函数API上传文件
    const result = await cloud.uploadFile({
      cloudPath: cloudPath,
      fileContent: fileContent
    })

    console.log(`上传成功: ${result.fileID}`)
    return result.fileID

  } catch (error) {
    console.error('云存储上传失败:', error)
    throw new Error(`上传失败: ${error.message}`)
  }
}

/**
 * 记录任务信息
 * @param {string} taskId - 任务ID
 * @param {string} cloudUrl - 云存储URL
 * @param {number} timestamp - 时间戳
 */
async function recordTask(taskId, cloudUrl, timestamp) {
  try {
    await db.collection('tasks').add({
      data: {
        taskId,
        cloudUrl,
        createTime: new Date(timestamp),
        expiryTime: new Date(timestamp + CONFIG.EXPIRY_HOURS * 60 * 60 * 1000),
        status: 'completed'
      }
    })
  } catch (error) {
    console.error('记录任务失败:', error)
    // 不抛出错误，避免影响主流程
  }
}

/**
 * 清理过期文件
 * @param {Object} event - 事件参数
 */
async function cleanupExpiredFiles(event) {
  console.log('开始清理过期文件')

  try {
    const now = new Date()
    const expiredTasks = await db.collection('tasks')
      .where({
        expiryTime: db.command.lt(now),
        status: 'completed'
      })
      .get()

    let cleanedCount = 0

    for (const task of expiredTasks.data) {
      try {
        // 删除云存储文件
        await cloud.deleteFile({
          fileList: [task.cloudUrl]
        })

        // 更新任务状态
        await db.collection('tasks').doc(task._id).update({
          data: { status: 'cleaned' }
        })

        cleanedCount++
        console.log(`清理文件: ${task.taskId}`)

      } catch (error) {
        console.error(`清理文件失败 ${task.taskId}:`, error)
      }
    }

    console.log(`清理完成，共清理 ${cleanedCount} 个文件`)

    return {
      success: true,
      cleanedCount
    }

  } catch (error) {
    console.error('清理过程失败:', error)
    return {
      success: false,
      error: error.message
    }
  }
}

/**
 * 获取处理进度
 * @param {Object} event - 事件参数
 */
async function getProgress(event) {
  const { taskId } = event

  try {
    const task = await db.collection('tasks')
      .where({ taskId })
      .get()

    if (task.data.length === 0) {
      return {
        progress: 0,
        status: 'not_found',
        message: '任务不存在'
      }
    }

    const taskData = task.data[0]
    return {
      progress: taskData.status === 'completed' ? 100 : 50,
      status: taskData.status,
      message: '处理中...'
    }

  } catch (error) {
    console.error('获取进度失败:', error)
    return {
      progress: 0,
      status: 'error',
      message: error.message
    }
  }
}

/**
 * 清理临时文件
 * @param {Array} filePaths - 文件路径数组
 */
function cleanupTempFiles(filePaths) {
  filePaths.forEach(filePath => {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        console.log(`清理临时文件: ${filePath}`)
      }
    } catch (error) {
      console.error(`清理文件失败 ${filePath}:`, error)
    }
  })
}

/**
 * 生成任务ID
 * @param {number} timestamp - 时间戳
 * @returns {string} 任务ID
 */
function generateTaskId(timestamp) {
  return `task_${timestamp}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 获取随机User-Agent
 * @returns {string} User-Agent字符串
 */
function getRandomUserAgent() {
  return CONFIG.USER_AGENTS[Math.floor(Math.random() * CONFIG.USER_AGENTS.length)]
}

/**
 * 获取文件大小
 * @param {string} filePath - 文件路径
 * @returns {string} 格式化的文件大小
 */
async function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath)
    const bytes = stats.size

    if (bytes === 0) return '0 B'

    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  } catch (error) {
    return '未知大小'
  }
}
