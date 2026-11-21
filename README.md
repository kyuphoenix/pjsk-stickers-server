# pjsk-stickers-server

高性能 Project Sekai (PJSK) 表情包生成服务端，支持 **Serverless 云部署**、**Docker/容器云独立部署** 与 **Web 前端可视化制作工坊**。

- **核心引擎 (Node.js)**：采用 `@napi-rs/canvas`（Rust 编写的高性能 Skia 原生绑定），零动态链接库依赖，专为 Vercel 等 Serverless 平台设计。
- **备用引擎 (Python)**：位于 `python_server/`，纯 Pillow 实现，独立目录与配置，适用于翼龙面板 (Pterodactyl)、VPS 或轻量容器。

---

## ✨ 核心特性

- **⚡ 零底层动态库依赖**：采用 `@napi-rs/canvas`，所有图形渲染与字体库均静态编译进原生扩展，**完全不需要安装 `libEGL` 或 `libGL`**。
- **🌐 完整 Serverless 支持**：原生适配 **Vercel**（自带 `vercel.json` 和 `api/index.js`），支持即开即用、按量计费，冷启动低于 150ms。
- **⚡ 双引擎实时渲染 (纯前端 0ms + 后端 API)**：
  - **纯前端 Canvas 2D 硬件加速**：浏览器本地 GPU 实时渲染，打字、滑块调节 **0ms 延迟**，无需等待网络请求！
  - **后端 Serverless 接口**：供 QQ 机器人、Discord 机器人、Markdown 外链等第三方客户端直接调用。
- **🎯 完美字体内环填充算法 (No Background Leak)**：
  - 针对 `o`、`g`、`e`、`a`、`p` 等字母在厚描边下容易产生微小透明缝隙导致背景露出的瑕疵，内置自动内孔/字谷连通闭包检测与描边底色混合算法，彻底杜绝背景漏色。
- **🎨 交互式 Web Playground**：浏览器通过 `GET /` 访问即响应完整的表情包制作工坊，支持实时预览、滑块调节、一键复制图片到剪贴板与下载。
- **📦 内置热门贴纸 + 云端按需拉取**：内置 Project Sekai (PJSK) 与 Arcaea 精选预设，并支持自动按需从 Hub 拉取全量 380+ 贴纸素材。

---

## 🚀 快速开始

### 1. 本地运行

```bash
# 进入项目目录
cd pjsk-stickers-server

# 安装依赖
pnpm install # 或 npm install

# 启动本地服务 (默认监听 3000 端口)
pnpm start   # 或 npm start
```

启动后在浏览器打开：
👉 **http://localhost:3000** 即可进入表情包 Playground 工作台！

---

## ☁️ 部署到 Vercel (1 分钟极速上线)

本项目已经预配置了 `vercel.json` 与 `api/index.js`：

1. 将当前项目上传/推送到你的 GitHub 仓库（仓库名为 `pjsk-stickers-server`）。
2. 打开 [Vercel 控制台 (vercel.com)](https://vercel.com)，点击 **Add New...** ➔ **Project**。
3. 导入你的 GitHub 仓库，**Framework Preset 保持 Other，无需修改任何设置**。
4. 点击 **Deploy**，约 10 秒后即可获得全球访问的独立域名（例如 `https://your-project.vercel.app`）！

---

## 📖 API 接口文档

### 1. 访问 Playground 网页工坊
- **请求方式**：`GET /`
- **说明**：直接在浏览器中打开，展示可视化表情包工作台。

---

### 2. 直接图片流生成接口（最适合 Markdown 或聊天平台嵌入）
- **请求方式**：`GET /api/generate`
- **响应格式**：直接返回 `image/png` 或 `image/jpeg` 二进制图片流。
- **URL 查询参数**：

| 参数 | 类型 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- |
| `pack` | string | `pjsk` | 贴纸包 slug（如 `pjsk`、`arcaea`） |
| `sticker` | string | `Airi 01` | 贴纸名称 |
| `text` | string | 默认文本 | 要覆盖绘制的表情包文本 |
| `size` | number | 默认字号 | 字体大小 (px) |
| `rotate` | number | 默认角度 | 文本旋转角度 (-180 ~ 180) |
| `color` | string | 默认颜色 | 文字颜色（支持 `#RRGGBB` 或 `rgba(...)`） |
| `stroke` | string | `#FFFFFF` | 描边颜色 |
| `stroke_width`| number | `0.22` | 描边粗细系数 (相对于字号) |
| `align` | string | `center` | 文字对齐 (`center`、`left`、`right`) |
| `format` | string | `png` | 图片格式 (`png` 或 `jpeg`) |
| `auto_resize` | string | `true` | 是否启用超出边界自适应缩放 |

**使用示例：**
```markdown
<!-- 在 Markdown 或聊天工具中直接嵌入 -->
![Meme Sticker](https://your-domain.vercel.app/api/generate?pack=pjsk&sticker=Airi%2001&text=加油啊！&format=png)
```

---

### 3. JSON 数据生成接口（适合程序化调用）
- **请求方式**：`POST /api/generate`
- **请求头**：`Content-Type: application/json`
- **请求体 (Body)**：
```json
{
  "pack_slug": "pjsk",
  "sticker_name": "Airi 01",
  "text": "加油！",
  "font_size": 46,
  "text_x": 148,
  "text_y": 58,
  "text_rotate_degrees": -11.5,
  "text_color": [251, 138, 172, 255],
  "stroke_color": [255, 255, 255, 255],
  "stroke_width_factor": 0.23,
  "text_align": "center",
  "auto_resize": true,
  "image_format": "png"
}
```
- **响应体 (Response)**：
```json
{
  "status": "ok",
  "data": {
    "data_uri": "data:image/png;base64,iVBORw0KGgo...",
    "width": 296,
    "height": 256,
    "format": "png",
    "size_bytes": 71435
  }
}
```

---

### 4. 获取贴纸列表树
- **请求方式**：`GET /api/packs`
- **说明**：获取所有支持的贴纸包、角色/分类、贴纸列表及其默认排版参数。

---

### 5. 引擎状态检测
- **请求方式**：`GET /api/status`
- **响应示例**：
```json
{
  "status": "ok",
  "engine": "@napi-rs/canvas",
  "platform": "Node.js (Serverless Ready - Route A)",
  "version": "1.0.0"
}
```

---

## 🛠️ 项目目录结构

```text
pjsk-stickers-server/
├── api/
│   └── index.js         # Vercel Serverless Function 入口
├── public/              # 静态资源与 Playground 前端
│   ├── index.html       # 表情包工坊 HTML 网页
│   ├── app.js           # 网页交互逻辑（实时预览、API 链接生成）
│   └── style.css        # 现代暗色风格 UI 样式
├── src/
│   ├── renderer.js      # 路线 A 核心：@napi-rs/canvas 贴纸绘制与自适应引擎
│   ├── packManager.js   # 贴纸包元数据与 CDN 解析管理器
│   ├── presets.js       # 内置 PJSK / Arcaea 精选预设
│   └── app.js           # 全局 HTTP 路由分发器
├── python_server/      # 备用 Python 服务端（共享静态素材，已配置 .vercelignore 隔离）
│   ├── server.py        # 显式定义端口与路由的 Python 入口
│   ├── config.json      # 端口与主机配置文件
│   ├── renderer.py      # Python 图像绘制与内孔填充引擎
│   ├── pack_manager.py  # 贴纸数据管理器
│   ├── requirements.txt # Python 依赖清单
│   └── README.md        # 备用服务端说明
├── test/
│   ├── render.test.js   # 渲染器测试用例
│   └── server.test.js   # 接口与路由集成测试
├── .vercelignore        # 部署排除规则（确保 Serverless 部署不包含 Python 代码）
├── server.js            # 本地 / Docker 独立服务启动入口
├── vercel.json          # Vercel 一键部署路由重定向配置
└── package.json
```
