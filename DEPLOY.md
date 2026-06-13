# 🌐 网站部署指南

## 方案一：Vercel 部署（免费、国内可访问、推荐）

### 1. 注册
打开 https://vercel.com ，用 GitHub 账号登录。

### 2. 安装 CLI
```bash
npm i -g vercel
```

### 3. 部署
在项目目录执行：
```bash
cd c:\Users\9\Desktop\CodeTest\BeijingGreenWaste\webapp
vercel
```
按提示操作，会得到一个网址如 `greenroute.vercel.app`。

### 4. 更新高德 Key
部署后需要在[高德控制台](https://console.amap.com/)中将该域名加入白名单。

---

## 方案二：ngrok 临时公网（最快、演示用）

### 1. 下载
https://ngrok.com/download

### 2. 运行
```bash
ngrok http 3000
```
得到一个临时公网地址如 `https://xxxx.ngrok-free.app`，直接发给导师查看。

---

## 方案三：阿里云/腾讯云服务器（最正式）

购买一台轻量应用服务器（学生价约 ¥10/月），安装 Node.js 后将项目上传运行。

---

## 论文中的引用格式

部署后，在论文中这样写：

> 本研究开发了基于 WebGIS 的绿色固废运输最优路径规划系统，部署于 [网址]，用户可通过浏览器直接访问。
> 系统前端采用高德地图 JavaScript API v2.0 实现地图可视化，后端基于 Node.js 提供路径计算和气象数据代理服务。
> 系统支持用户自定义六因子权重，实时调用高德 Web 服务 API 获取路况数据，并基于两层 AHP 模型计算综合最优路径。
