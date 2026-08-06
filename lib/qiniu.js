// 七牛云对象存储工具库（运行时凭证生成，零外部依赖）
const crypto = require('crypto');

const ACCESS_KEY = process.env.QINIU_ACCESS_KEY || '';
const SECRET_KEY = process.env.QINIU_SECRET_KEY || '';
const BUCKET = process.env.QINIU_BUCKET || 'xuanjian-top';
const DOMAIN = process.env.QINIU_DOMAIN || 'https://cdn.xuanjian.top';
const UPLOAD_URL = process.env.QINIU_UPLOAD_URL || 'https://up-as0.qiniup.com';

/**
 * URL安全的Base64编码
 */
function urlsafeBase64(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * 生成七牛云上传凭证（HMAC-SHA1 签名）
 * @param {string} key 上传对象 key，如 images/uuid.jpg
 */
function generateUploadToken(key) {
  if (!ACCESS_KEY || !SECRET_KEY) {
    throw new Error('七牛云配置缺失，请检查 .env 中的 QINIU_ACCESS_KEY / QINIU_SECRET_KEY');
  }

  const putPolicy = {
    scope: key ? `${BUCKET}:${key}` : BUCKET,
    deadline: Math.floor(Date.now() / 1000) + 3600, // 1小时有效
    fsizeLimit: 5 * 1024 * 1024, // 最大5MB
    returnBody: '{"key":"$(key)","hash":"$(etag)","fsize":$(fsize)}',
  };

  const encodedPutPolicy = urlsafeBase64(JSON.stringify(putPolicy));
  const sign = crypto
    .createHmac('sha1', SECRET_KEY)
    .update(encodedPutPolicy)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${ACCESS_KEY}:${sign}:${encodedPutPolicy}`;
}

module.exports = {
  generateUploadToken,
  QINIU_DOMAIN: DOMAIN,
  QINIU_UPLOAD_URL: UPLOAD_URL,
};
