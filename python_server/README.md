# Meme Stickers Python 独立服务端 (Python Backend Service)

> 本目录为 Node.js / Serverless 渲染后端的 **Python 备用独立实现**。  
> 拥有完全独立的文件结构与资源路径，**不向上引用任何父级目录资源**，可在任意 Python 环境下独立打包、部署与运行。

---

## 📁 目录与资源组织

所有资源与代码均完全封闭在 `python_server/` 自身目录下：

```text
python_server/
├── server.py              # 服务核心入口（显式定义端口与路由）
├── config.json            # 端口与主机配置文件
├── renderer.py            # 贴纸渲染引擎（支持字体内孔填充、自适应字号与旋转）
├── pack_manager.py        # 贴纸数据管理器
├── presets.py             # 内置精选预设（PJSK / Arcaea）
├── requirements.txt       # Python 依赖清单
├── packs/                 # 📦 贴纸包资源占位目录（读取本目录下的本地素材包）
│   ├── .gitkeep
│   └── README.md
├── fonts/                 # 🔤 字体资源占位目录（读取本目录下的字体文件）
│   ├── .gitkeep
│   └── README.md
└── public/                # 🌐 Web Playground 前端目录
    ├── index.html
    ├── app.js
    ├── style.css
    └── README.md
```

---

## 🌟 核心特性

1. **完全自包含，无父目录依赖**：
   - 贴纸数据从同级 `packs/` 读取，字体从同级 `fonts/` 读取，前端网页从同级 `public/` 读取。
   - 内置了热门预设数据 (`presets.py`) 与字体优雅降级机制：即使 `packs/` 与 `fonts/` 目录为空占位状态，服务启动与测试也能稳定运行不报错。
2. **灵活的端口监听配置**：
   - **方式一（代码显式定义）**：直接在 `server.py` 开头的 `DEFAULT_PORT = 3000` 处修改。
   - **方式二（配置文件）**：在同级 `config.json` 中修改 `"port": 3000, "host": "0.0.0.0"`。
   - **方式三（环境变量优先）**：运行时传入环境变量，如 `PORT=8080 python server.py`。
3. **Serverless 部署完全隔离**：
   - 上级目录的 `.vercelignore` 与 `.gitignore` 已配置忽略 `python_server/`。
   - 将主项目部署到 Vercel 等 Serverless 平台时，平台仅读取 Node.js 环境，**绝对不会上传或解析 Python 部分**。
4. **与 AstrBot API 插件无缝兼容**：
   - `astrbot_plugin_meme_stickers_api` 可在配置中将 `server_url` 直接指向本 Python 服务，调用效果与 Node.js 版完全一致。

---

## 📦 安装与启动

### 1. 安装依赖
```bash
cd python_server
pip install -r requirements.txt
```

### 2. 启动服务
```bash
python server.py
```

默认将在 `http://0.0.0.0:3000` 启动服务：
- 🌐 **Web Playground 游乐场**：`http://localhost:3000/`
- ⚡ **API 生成接口**：`http://localhost:3000/api/generate`
- 📊 **贴纸树信息**：`http://localhost:3000/api/packs`
- 🔍 **服务状态**：`http://localhost:3000/api/status`

---

## ⚙️ 配置文件说明 (`config.json`)

```json
{
  "host": "0.0.0.0",
  "port": 3000,
  "default_pack": "pjsk"
}
```
修改保存后重新运行 `python server.py` 即可立即生效。
