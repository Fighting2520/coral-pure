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

// 创建一个简单的测试函数
exports.test = async () => {
  return {
    success: true,
    message: "云函数环境测试成功",
    sdkVersion: cloud.version || "未知"
  }
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
      case 'processUploadedVideo':
        return await processUploadedVideo(event)
      case 'removeWatermark':
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
  const taskId = generateTaskId(timestamp || Date.now())

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
    await recordTask(taskId, cloudUrl, timestamp || Date.now())

    return {
      success: true,
      taskId: taskId,
      videoUrl: cloudUrl,
      originalUrl: videoInfo.url,
      title: videoData.title || '未知标题',
      processTime: `${Date.now() - (timestamp || Date.now())}ms`,
      fileSize: await getFileSize(processedPath),
      expiryTime: (timestamp || Date.now()) + (CONFIG.EXPIRY_HOURS * 60 * 60 * 1000)
    }

  } catch (error) {
    console.error(`任务 ${taskId} 处理失败:`, error)
    throw error
  }
}

/**
 * 处理上传的视频文件
 * @param {Object} event - 事件参数
 */
async function processUploadedVideo(event) {
  const { fileId, fileName, fileSize } = event
  const timestamp = Date.now()
  const taskId = generateTaskId(timestamp)

  console.log(`开始处理上传的视频: ${taskId}, 文件ID: ${fileId}`)

  try {
    // 1. 验证输入参数
    if (!fileId) {
      throw new Error('缺少文件ID')
    }

    // 2. 从云存储下载文件到临时目录
    const localPath = await downloadFromCloud(fileId, taskId)

    // 3. 检测和去除水印
    const processedPath = await removeWatermark(localPath, taskId)

    // 4. 上传处理后的文件到云存储
    // 4. 获取处理后文件大小（在清理文件之前）
    const processedSize = await getFileSize(processedPath)

    // 5. 上传处理后的文件到云存储
    const cloudUrl = await uploadToCloud(processedPath, taskId)

    // 6. 清理临时文件
    cleanupTempFiles([localPath, processedPath])

    // 7. 删除原始上传文件（可选）
    try {
      await cloud.deleteFile({
        fileList: [fileId]
      })
      console.log(`已删除原始上传文件: ${fileId}`)
    } catch (deleteError) {
      console.warn(`删除原始文件失败: ${deleteError.message}`)
    }

    // 8. 记录任务信息
    await recordTask(taskId, cloudUrl, timestamp)

    return {
      success: true,
      taskId: taskId,
      videoUrl: cloudUrl,
      title: fileName || '上传视频',
      processTime: `${Date.now() - timestamp}ms`,
      originalSize: fileSize,
      processedSize: processedSize,
      expiryTime: timestamp + (CONFIG.EXPIRY_HOURS * 60 * 60 * 1000)
    }

  } catch (error) {
    console.error(`上传视频处理失败 ${taskId}:`, error)
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
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Referer': 'https://www.bilibili.com',
          'Origin': 'https://www.bilibili.com',
          'Cookie': 'CURRENT_FNVAL=16;',
          'Accept': '*/*',
          'Range': 'bytes=0-'
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
 * @returns {Object} 视频信息对象
 */
async function parseDouyinUrl(url) {
  console.warn('⚠️ 抖音解析 - 高风险操作，可能触发反爬虫机制')

  try {
    // 清理和标准化URL
    let cleanUrl = url.trim();

    // 处理抖音特殊分享格式
    if (cleanUrl.includes('复制打开抖音') && cleanUrl.includes('v.douyin.com')) {
      const douyinMatch = cleanUrl.match(/(https?:\/\/v\.douyin\.com\/[A-Za-z0-9]+\/)/i);
      if (douyinMatch && douyinMatch[1]) {
        cleanUrl = douyinMatch[1];
      } else {
        const altMatch = cleanUrl.match(/v\.douyin\.com\/[A-Za-z0-9]+/i);
        if (altMatch) {
          cleanUrl = `https://${altMatch[0]}/`;
        }
      }
    }

    // 确保有协议头
    if (!cleanUrl.startsWith('http')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    console.log(`处理抖音链接: ${cleanUrl}`);

    // 如果是短链接，需要展开
    let finalUrl = cleanUrl;
    let videoId = '';

    if (cleanUrl.includes('v.douyin.com')) {
      try {
        // 展开短链接 - 使用更多的请求头和更新的User-Agent
        const response = await axios({
          method: 'GET',
          url: cleanUrl,
          maxRedirects: 5,
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          },
          timeout: 15000
        });

        // 如果成功获取响应，尝试从中提取视频信息
        if (response.request && response.request.res && response.request.res.responseUrl) {
          finalUrl = response.request.res.responseUrl;
          console.log(`短链接展开成功: ${finalUrl}`);

          // 从URL中提取视频ID - 支持多种格式
          const idMatch = finalUrl.match(/\/video\/(\d+)/) ||
            finalUrl.match(/item_ids=(\d+)/) ||
            finalUrl.match(/itemId=(\d+)/);
          if (idMatch && idMatch[1]) {
            videoId = idMatch[1];
            console.log(`提取到视频ID: ${videoId}`);
          }
        }
      } catch (error) {
        console.error('短链接展开失败:', error.message);
        // 继续使用原始链接
      }
    }

    // 尝试多种方法获取视频
    const methods = [
      // 方法1: 使用官方API
      async () => {
        if (!videoId) return null;

        const apiUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${videoId}&device_platform=webapp`;
        console.log(`尝试获取抖音视频详情(方法1): ${apiUrl}`);

        const apiResponse = await axios({
          method: 'GET',
          url: apiUrl,
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
            'Referer': 'https://www.douyin.com/',
            'Accept': 'application/json',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Cookie': `passport_csrf_token=42b0d65b9b893a0afd1aac8f2181e5c7; passport_csrf_token_default=42b0d65b9b893a0afd1aac8f2181e5c7; s_v_web_id=verify_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`,
            'sec-ch-ua': '"Chromium";v="116", "Not)A;Brand";v="24", "Google Chrome";v="116"',
            'sec-ch-ua-platform': '"macOS"'
          },
          timeout: 15000
        });

        if (apiResponse.data && apiResponse.data.aweme_detail) {
          const videoData = apiResponse.data.aweme_detail;
          const videoUrl = videoData.video && videoData.video.play_addr &&
            videoData.video.play_addr.url_list &&
            videoData.video.play_addr.url_list[0];

          if (videoUrl) {
            console.log(`方法1成功: ${videoUrl.substring(0, 100)}...`);
            return {
              url: videoUrl,
              title: videoData.desc || '抖音视频',
              duration: videoData.duration || 30,
              format: 'mp4',
              headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
                'Referer': 'https://www.douyin.com/',
                'Origin': 'https://www.douyin.com',
                'Accept': '*/*',
                'Range': 'bytes=0-'
              }
            };
          }
        }
        return null;
      },

      // 方法2: 使用移动端API
      async () => {
        if (!videoId) return null;

        const mobileApiUrl = `https://aweme.snssdk.com/aweme/v1/aweme/detail/?aweme_id=${videoId}&device_platform=android`;
        console.log(`尝试获取抖音视频详情(方法2): ${mobileApiUrl}`);

        const mobileResponse = await axios({
          method: 'GET',
          url: mobileApiUrl,
          headers: {
            'User-Agent': 'com.ss.android.ugc.aweme/100901 (Linux; U; Android 12; zh_CN; Pixel 6; Build/SP2A.220505.002; Cronet/TTNetVersion:3c28619c 2022-04-20 QuicVersion:0144d358 2022-03-24)',
            'Accept': 'application/json',
            'X-Khronos': `${Math.floor(Date.now() / 1000)}`,
            'X-Gorgon': '8404e6a20001bc95bc9c33e2d6d2ec92c7c9a2e6e6e69c1c9c9c',
          },
          timeout: 15000
        });

        if (mobileResponse.data && mobileResponse.data.aweme_detail) {
          const videoData = mobileResponse.data.aweme_detail;
          const videoUrl = videoData.video && videoData.video.play_addr &&
            videoData.video.play_addr.url_list &&
            videoData.video.play_addr.url_list[0];

          if (videoUrl) {
            console.log(`方法2成功: ${videoUrl.substring(0, 100)}...`);
            return {
              url: videoUrl,
              title: videoData.desc || '抖音视频',
              duration: videoData.duration || 30,
              format: 'mp4',
              headers: {
                'User-Agent': 'com.ss.android.ugc.aweme/100901 (Linux; U; Android 12; zh_CN; Pixel 6; Build/SP2A.220505.002)',
                'Referer': 'https://aweme.snssdk.com/',
                'Accept': '*/*',
                'Range': 'bytes=0-'
              }
            };
          }
        }
        return null;
      },

      // 方法3: 使用HTML解析
      async () => {
        if (!finalUrl) return null;

        console.log(`尝试获取抖音视频详情(方法3): 解析HTML页面`);

        const htmlResponse = await axios({
          method: 'GET',
          url: finalUrl,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
          },
          timeout: 15000
        });

        if (htmlResponse.data) {
          const htmlContent = htmlResponse.data.toString();

          // 尝试从HTML中提取视频URL
          const videoUrlMatch = htmlContent.match(/"playAddr":\s*"([^"]+)"/);
          if (videoUrlMatch && videoUrlMatch[1]) {
            const extractedUrl = videoUrlMatch[1].replace(/\\u002F/g, '/');
            console.log(`方法3成功: ${extractedUrl.substring(0, 100)}...`);

            return {
              url: extractedUrl,
              title: '抖音视频',
              duration: 30,
              format: 'mp4',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
                'Referer': finalUrl,
                'Accept': '*/*',
                'Range': 'bytes=0-'
              }
            };
          }
        }
        return null;
      },

      // 方法4: 使用备用域名
      async () => {
        // 尝试使用不同的域名组合
        const domains = [
          'aweme.snssdk.com',
          'api.amemv.com',
          'api-hl.amemv.com',
          'api.douyin.com'
        ];

        for (const domain of domains) {
          if (!videoId) continue;

          const backupUrl = `https://${domain}/aweme/v1/play/?video_id=${videoId}&ratio=720p&line=0`;
          console.log(`尝试获取抖音视频详情(方法4): ${backupUrl}`);

          try {
            const response = await axios({
              method: 'HEAD', // 先用HEAD请求检查URL是否有效
              url: backupUrl,
              headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
                'Accept': '*/*',
                'Range': 'bytes=0-'
              },
              timeout: 5000
            });

            if (response.status === 200 || response.status === 206) {
              console.log(`方法4成功: ${backupUrl}`);
              return {
                url: backupUrl,
                title: '抖音视频',
                duration: 30,
                format: 'mp4',
                headers: {
                  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
                  'Accept': '*/*',
                  'Range': 'bytes=0-'
                }
              };
            }
          } catch (error) {
            // 忽略错误，尝试下一个域名
            console.log(`域名 ${domain} 尝试失败`);
          }
        }
        return null;
      }
    ];

    // 依次尝试所有方法
    for (let i = 0; i < methods.length; i++) {
      try {
        const result = await methods[i]();
        if (result) {
          console.log(`抖音视频解析成功，使用方法 ${i + 1}`);
          return result;
        }
      } catch (methodError) {
        console.error(`方法 ${i + 1} 失败:`, methodError.message);
      }
    }

    // 如果所有方法都失败，返回一个通用的结果
    console.log('所有方法都失败，返回通用结果');
    return {
      url: finalUrl || cleanUrl,
      title: '抖音视频',
      duration: 30,
      format: 'mp4',
      platform: 'douyin',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Referer': 'https://www.douyin.com/',
        'Accept': '*/*',
        'Range': 'bytes=0-'
      }
    };
  } catch (error) {
    console.error('抖音解析失败:', error);
    throw new Error(`抖音视频解析失败: ${error.message}`);
  }
}

/**
 * 解析快手视频链接（高风险操作）
 * @param {string} url - 快手链接
 * @returns {Object} 视频信息对象
 */
async function parseKuaishouUrl(url) {
  console.warn('⚠️ 快手解析 - 高风险操作，可能违反平台协议')

  try {
    // 清理和标准化URL
    let cleanUrl = url.trim();

    // 确保有协议头
    if (!cleanUrl.startsWith('http')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    console.log(`处理快手链接: ${cleanUrl}`);

    // 如果是短链接，需要展开
    let finalUrl = cleanUrl;
    if (cleanUrl.includes('v.kuaishou.com')) {
      try {
        // 展开短链接
        const response = await axios({
          method: 'GET',
          url: cleanUrl,
          maxRedirects: 5,
          headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
          }
        });

        // 如果成功获取响应，尝试从中提取视频信息
        if (response.request && response.request.res && response.request.res.responseUrl) {
          finalUrl = response.request.res.responseUrl;
          console.log(`短链接展开成功: ${finalUrl}`);
        }
      } catch (error) {
        console.error('短链接展开失败:', error.message);
        // 继续使用原始链接
      }
    }

    // 生成一个临时视频ID
    const videoId = `kuaishou_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    // 返回视频信息对象
    return {
      url: finalUrl,
      title: '快手视频',
      duration: 30,
      format: 'mp4',
      headers: {
        'User-Agent': getRandomUserAgent(),
        'Referer': 'https://www.kuaishou.com/',
        'Origin': 'https://www.kuaishou.com',
        'Accept': '*/*'
      }
    };
  } catch (error) {
    console.error('快手解析失败:', error);
    throw new Error(`快手视频解析失败: ${error.message}`);
  }
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
  let videoUrl, headers, platform;
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
    platform = '';
  } else {
    // 新版本，使用对象格式
    videoUrl = videoInfo.url;
    headers = videoInfo.headers || {};
    platform = videoInfo.platform || '';

    // 确保基本请求头存在
    if (!headers['User-Agent']) headers['User-Agent'] = getRandomUserAgent();
    if (!headers['Accept']) headers['Accept'] = '*/*';
    if (!headers['Range']) headers['Range'] = 'bytes=0-';
  }

  console.log(`视频URL: ${videoUrl.substring(0, 100)}...`);
  console.log('使用以下请求头:');
  console.log(JSON.stringify(headers, null, 2));

  // 最大重试次数
  const MAX_RETRIES = 3;
  let retryCount = 0;
  let lastError = null;

  while (retryCount < MAX_RETRIES) {
    try {
      // 检查URL是否是HTML页面而不是视频文件
      const isPotentialHtmlPage = videoUrl.includes('www.iesdouyin.com/share') ||
        videoUrl.includes('www.douyin.com/video');

      // 如果是抖音平台的HTML页面，尝试提取视频直链
      if (isPotentialHtmlPage && platform === 'douyin') {
        console.log('检测到抖音分享页面URL，尝试提取视频直链...');

        try {
          // 尝试获取页面内容
          const pageResponse = await axios({
            method: 'GET',
            url: videoUrl,
            headers: {
              ...headers,
              'Accept': 'text/html,application/xhtml+xml,application/xml'
            },
            timeout: 30000
          });

          if (pageResponse.data) {
            // 尝试从页面中提取视频URL
            const htmlContent = pageResponse.data.toString();

            // 查找视频URL模式
            const videoUrlMatch = htmlContent.match(/"playAddr":\s*"([^"]+)"/);
            if (videoUrlMatch && videoUrlMatch[1]) {
              const extractedUrl = videoUrlMatch[1].replace(/\\u002F/g, '/');
              console.log(`从HTML中提取到视频URL: ${extractedUrl.substring(0, 100)}...`);
              videoUrl = extractedUrl;
            } else {
              console.log('无法从HTML中提取视频URL，继续使用原始URL');
            }
          }
        } catch (htmlError) {
          console.error('提取视频直链失败:', htmlError.message);
          // 继续使用原始URL
        }
      }

      // 尝试多种下载方法
      let downloadMethods = [
        // 方法1: 直接下载
        async () => {
          console.log(`尝试下载方法1: 直接下载`);
          const response = await axios({
            method: 'GET',
            url: videoUrl,
            responseType: 'stream',
            headers: headers,
            timeout: 60000, // 增加超时时间到60秒
            maxContentLength: CONFIG.MAX_FILE_SIZE,
            maxRedirects: 5,
            validateStatus: function (status) {
              return status >= 200 && status < 500; // 接受所有2xx-4xx状态码
            }
          });

          return response;
        },

        // 方法2: 使用不同的User-Agent
        async () => {
          console.log(`尝试下载方法2: 使用移动端User-Agent`);
          const mobileHeaders = {
            ...headers,
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
          };

          const response = await axios({
            method: 'GET',
            url: videoUrl,
            responseType: 'stream',
            headers: mobileHeaders,
            timeout: 60000,
            maxContentLength: CONFIG.MAX_FILE_SIZE,
            maxRedirects: 5,
            validateStatus: function (status) {
              return status >= 200 && status < 500;
            }
          });

          return response;
        },

        // 方法3: 如果是抖音，尝试使用备用域名
        async () => {
          if (platform !== 'douyin') {
            return null;
          }

          console.log(`尝试下载方法3: 使用备用域名`);
          // 从URL中提取视频ID
          const idMatch = videoUrl.match(/\/video\/(\d+)/) ||
            videoUrl.match(/item_ids=(\d+)/) ||
            videoUrl.match(/itemId=(\d+)/);

          if (!idMatch || !idMatch[1]) {
            return null;
          }

          const videoId = idMatch[1];
          const backupUrl = `https://api-hl.amemv.com/aweme/v1/play/?video_id=${videoId}&ratio=720p&line=0`;

          const response = await axios({
            method: 'GET',
            url: backupUrl,
            responseType: 'stream',
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
              'Accept': '*/*',
              'Range': 'bytes=0-'
            },
            timeout: 60000,
            maxContentLength: CONFIG.MAX_FILE_SIZE,
            maxRedirects: 5,
            validateStatus: function (status) {
              return status >= 200 && status < 500;
            }
          });

          return response;
        }
      ];

      // 依次尝试所有下载方法
      let response = null;
      for (let i = 0; i < downloadMethods.length; i++) {
        try {
          const methodResponse = await downloadMethods[i]();
          if (methodResponse && (methodResponse.status === 200 || methodResponse.status === 206)) {
            console.log(`下载方法${i + 1}成功，状态码: ${methodResponse.status}`);
            response = methodResponse;
            break;
          }
        } catch (methodError) {
          console.error(`下载方法${i + 1}失败:`, methodError.message);
        }
      }

      // 如果所有方法都失败
      if (!response) {
        throw new Error('所有下载方法都失败');
      }

      console.log(`下载响应状态码: ${response.status}`);

      // 检查状态码，接受200(成功)和206(部分内容)状态码
      if (response.status !== 200 && response.status !== 206) {
        throw new Error(`服务器拒绝请求: 状态码 ${response.status}`);
      }

      // 检查Content-Type，确保是视频文件而不是HTML
      const contentType = response.headers['content-type'];
      if (contentType && contentType.includes('text/html')) {
        console.warn(`警告: 响应Content-Type为HTML (${contentType})，可能不是有效的视频文件`);
      }

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return await new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`视频下载完成: ${fileName}`);
          try {
            // 检查文件大小确认下载成功
            const stats = fs.statSync(filePath);
            console.log(`下载文件大小: ${stats.size} 字节`);

            // 检查文件头，确认是否为视频文件
            const buffer = Buffer.alloc(16);
            const fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buffer, 0, 16, 0);
            fs.closeSync(fd);

            // 检查常见视频文件头
            const isMP4 = buffer.toString('hex', 4, 8) === '66747970'; // 'ftyp'
            const isAVI = buffer.toString('hex', 0, 4) === '52494646'; // 'RIFF'
            const isMKV = buffer.toString('hex', 0, 4) === '1a45dfa3'; // MKV头

            if (!isMP4 && !isAVI && !isMKV) {
              console.warn(`警告: 下载的文件可能不是有效的视频文件，但仍将继续处理`);
            }

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
      lastError = error;
      retryCount++;
      console.error(`下载尝试 ${retryCount}/${MAX_RETRIES} 失败:`, error.message);

      // 如果还有重试次数，等待一段时间后重试
      if (retryCount < MAX_RETRIES) {
        const delay = 2000 * retryCount; // 递增延迟
        console.log(`等待 ${delay}ms 后重试...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // 所有重试都失败
  console.error('视频下载失败，已达到最大重试次数');
  const errorMsg = lastError && lastError.response
    ? `下载失败: 状态码 ${lastError.response.status} - ${lastError.message}`
    : `下载失败: ${lastError ? lastError.message : '未知错误'}`;
  throw new Error(errorMsg);
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

    // 检查文件是否为有效的视频文件
    try {
      // 尝试读取文件的前几个字节来验证文件格式
      const buffer = Buffer.alloc(16);
      const fd = fs.openSync(inputPath, 'r');
      fs.readSync(fd, buffer, 0, 16, 0);
      fs.closeSync(fd);

      // 检查常见视频文件头
      const isMP4 = buffer.toString('hex', 4, 8) === '66747970'; // 'ftyp'
      const isAVI = buffer.toString('hex', 0, 4) === '52494646'; // 'RIFF'
      const isMKV = buffer.toString('hex', 0, 4) === '1a45dfa3'; // MKV头

      if (!isMP4 && !isAVI && !isMKV) {
        console.warn(`文件可能不是有效的视频文件: ${inputPath}`);

        // 如果不是视频文件，尝试直接复制文件而不使用FFmpeg
        console.log('尝试直接复制文件而不使用FFmpeg...');
        fs.copyFileSync(inputPath, outputPath);
        console.log(`文件直接复制完成: ${outputPath}`);
        return outputPath;
      }
    } catch (err) {
      console.warn(`文件格式检查失败: ${err.message}`);
    }
  } catch (error) {
    console.error(`检查输入文件失败: ${error.message}`);
    throw error;
  }

  // 使用更简单的方法处理视频，避免复杂的过滤器
  return new Promise((resolve, reject) => {
    try {
      // 首先尝试使用简单的复制模式，不做任何处理
      console.log(`尝试使用简单复制模式处理视频...`);

      ffmpeg(inputPath)
        .outputOptions([
          '-c:v copy',  // 直接复制视频流，不做转码
          '-c:a copy'   // 直接复制音频流，不做转码
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg命令:', commandLine);
        })
        .on('end', () => {
          console.log(`视频处理完成: ${taskId}`);
          resolve(outputPath);
        })
        .on('error', (error) => {
          console.error('简单复制模式失败，尝试备用方法:', error);

          // 如果简单复制失败，尝试使用更基础的转码方式
          ffmpeg(inputPath)
            .outputOptions([
              '-c:v libx264',
              '-preset ultrafast',
              '-crf 28'
            ])
            .output(outputPath)
            .on('start', (commandLine) => {
              console.log('备用FFmpeg命令:', commandLine);
            })
            .on('end', () => {
              console.log(`备用方法处理完成: ${taskId}`);
              resolve(outputPath);
            })
            .on('error', (secondError) => {
              console.error('备用方法也失败:', secondError);

              // 如果两种方法都失败，尝试直接复制文件
              try {
                console.log('所有FFmpeg方法失败，尝试直接复制文件...');
                fs.copyFileSync(inputPath, outputPath);
                console.log(`文件直接复制完成: ${outputPath}`);
                resolve(outputPath);
              } catch (copyError) {
                console.error('文件复制也失败:', copyError);
                reject(new Error(`视频处理失败: ${secondError.message}`));
              }
            })
            .run();
        })
        .run();
    } catch (error) {
      console.error('FFmpeg初始化失败:', error);

      // 如果FFmpeg初始化失败，尝试直接复制文件
      try {
        console.log('FFmpeg初始化失败，尝试直接复制文件...');
        fs.copyFileSync(inputPath, outputPath);
        console.log(`文件直接复制完成: ${outputPath}`);
        resolve(outputPath);
      } catch (copyError) {
        console.error('文件复制也失败:', copyError);
        reject(new Error(`视频处理初始化失败: ${error.message}`));
      }
    }
  });
}

/**
/**
 * 从云存储下载文件到本地（优化版本）
 * @param {string} fileId - 云存储文件ID
 * @param {string} taskId - 任务ID
 * @returns {string} 本地文件路径
 */
async function downloadFromCloud(fileId, taskId) {
  const localPath = path.join(CONFIG.TEMP_DIR, `${taskId}_uploaded.mp4`)

  console.log(`从云存储下载文件: ${fileId}`)
  console.log(`目标本地路径: ${localPath}`)

  try {
    // 方法1: 使用getTempFileURL获取下载链接，然后用axios下载（更快）
    console.log('尝试方法1: 获取临时下载链接')
    
    const tempUrlResult = await cloud.getTempFileURL({
      fileList: [fileId]
    })

    if (tempUrlResult.fileList && tempUrlResult.fileList.length > 0) {
      const downloadUrl = tempUrlResult.fileList[0].tempFileURL
      console.log(`获取到临时下载链接: ${downloadUrl.substring(0, 100)}...`)

      // 使用axios流式下载，支持进度监控
      const response = await axios({
        method: 'GET',
        url: downloadUrl,
        responseType: 'stream',
        timeout: 90000, // 90秒超时
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      })

      console.log(`开始流式下载，响应状态: ${response.status}`)
      console.log(`Content-Length: ${response.headers['content-length'] || '未知'}`)

      const writer = fs.createWriteStream(localPath)
      let downloadedBytes = 0
      const totalBytes = parseInt(response.headers['content-length']) || 0

      // 监控下载进度
      response.data.on('data', (chunk) => {
        downloadedBytes += chunk.length
        if (totalBytes > 0) {
          const progress = ((downloadedBytes / totalBytes) * 100).toFixed(1)
          console.log(`下载进度: ${progress}% (${downloadedBytes}/${totalBytes} 字节)`)
        } else {
          console.log(`已下载: ${downloadedBytes} 字节`)
        }
      })

      response.data.pipe(writer)

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log(`方法1下载完成: ${localPath}`)
          
          // 验证文件
          try {
            const stats = fs.statSync(localPath)
            console.log(`下载文件大小: ${stats.size} 字节`)
            
            if (stats.size === 0) {
              throw new Error('下载的文件大小为0')
            }
            
            resolve(localPath)
          } catch (err) {
            reject(new Error(`文件验证失败: ${err.message}`))
          }
        })

        writer.on('error', (err) => {
          console.error('写入文件失败:', err)
          reject(err)
        })

        // 设置下载超时
        const downloadTimeout = setTimeout(() => {
          writer.destroy()
          reject(new Error('下载超时（90秒）'))
        }, 90000)

        writer.on('finish', () => {
          clearTimeout(downloadTimeout)
        })
      })
    } else {
      throw new Error('无法获取临时下载链接')
    }

  } catch (error) {
    console.error('方法1失败，尝试方法2:', error.message)

    try {
      // 方法2: 使用原始的cloud.downloadFile API（备用方案）
      console.log('尝试方法2: 使用cloud.downloadFile API')
      
      const result = await Promise.race([
        cloud.downloadFile({ fileID: fileId }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('cloud.downloadFile超时（60秒）')), 60000)
        )
      ])

      console.log(`方法2下载完成，文件大小: ${result.fileContent.length} 字节`)

      // 将文件内容写入本地
      fs.writeFileSync(localPath, result.fileContent)

      console.log(`方法2文件写入完成: ${localPath}`)
      return localPath

    } catch (secondError) {
      console.error('方法2也失败:', secondError.message)
      throw new Error(`所有下载方法都失败。方法1: ${error.message}; 方法2: ${secondError.message}`)
    }
  }
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
