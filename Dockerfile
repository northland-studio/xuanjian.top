# 使用国内镜像源的Node.js官方镜像
FROM registry.cn-hangzhou.aliyuncs.com/nodejs/node:18-alpine

# 安装必要的系统依赖（用于bcrypt等原生模块）
RUN apk add --no-cache python3 make g++

# 设置工作目录
WORKDIR /app

# 复制package.json和package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制项目文件
COPY . .

# 创建必要的目录并设置权限
RUN mkdir -p data/uploads && \
    chmod -R 755 data && \
    chmod -R 755 data/uploads

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1

# 启动命令
CMD ["npm", "start"]
