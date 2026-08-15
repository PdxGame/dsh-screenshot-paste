# 📎 dsh-screenshot-paste

为 DeepSeek Harness (DSH) Web GUI 提供截图与文件粘贴板功能：**粘贴、拖拽或浏览上传文件**，以引用芯片的形式置于输入框上方，发送消息时**自动附带文件路径**。

![version](https://img.shields.io/badge/version-0.1.0-blue)
![license](https://img.shields.io/badge/license-MIT-green)
![platform](https://img.shields.io/badge/platform-DSH%20Web-lightgrey)
![size](https://img.shields.io/badge/dependencies-0-orange)

> 纯外部插件：不修改 DSH 源码，仅使用官方扩展点（UI 插槽、API 路由、`agent/pre-step` 事件）。

---

## ✨ 功能特性

| | 特性 | 说明 |
|---|---|---|
| 📋 | **多方式上传** | Ctrl+V 粘贴、拖拽、点击浏览（支持多文件） |
| 🗂️ | **文件类型丰富** | 图片 / PDF / Office 文档 / 压缩包 / 音视频 / 文本；白名单之外的类型（如 `.exe`）明确拒绝 |
| 🏷️ | **引用芯片** | 上传的文件以芯片形式显示在输入框上方，支持预览与移除 |
| 📤 | **自动附带路径** | 发送消息时自动将文件路径追加至消息内容，发送后自动清空 |
| 🧹 | **零输入框污染** | 不向输入框、光标或草稿插入任何内容 |
| 💰 | **零常驻开销** | 不注册工具、不贡献提示词；无引用时对模型请求无任何影响 |
| 🔒 | **安全** | 所有 API 仅限本机回环访问；文件名经过校验，防止路径穿越；保存目录自动创建 |

## 📦 安装

### 环境要求

- 已安装 DeepSeek Harness 及其 `dsh` 命令行工具
- 目标 profile 为 `web`

### 安装插件

固定版本（推荐，可复现）：

```sh
dsh plugin --profile web add github:PdxGame/dsh-screenshot-paste@v0.1.0
```

如需跟踪最新 `main`，去掉 `@v0.1.0` 后缀。

> [!TIP]
> 若 `dsh` 不在 PATH（例如通过 `pnpm dsh` 启动的环境），在 DSH 安装目录下改用：
> ```sh
> pnpm dsh plugin --profile web add github:PdxGame/dsh-screenshot-paste@v0.1.0
> ```

> [!IMPORTANT]
> 安装完成后，**重启 `dsh web` 并强制刷新浏览器（Ctrl+F5）**，客户端资源才会重新加载。

### 安装后验证

重启后打开 `http://127.0.0.1:3080`，任意会话输入框工具区应出现 📎 按钮。也可命令行验证宿主 API：

```sh
curl http://127.0.0.1:3080/api/screenshot-paste/list
# 应返回 {"dir":"F:\\dsh-screenshots","files":[...]}
```

### 卸载

```sh
dsh plugin --profile web remove dsh-screenshot-paste
```

卸载后重启 `dsh web` 生效。

## ⚙️ 配置

插件**开箱即用，零配置**。保存目录按以下优先级解析：

| 优先级 | 配置来源 | 说明 |
|---|---|---|
| 1 | 设置项 `dsh-screenshot-paste.dir` | 在 DSH 设置页或 `~/.dsh/settings.yaml` 中配置，改动即时生效，无需重启 |
| 2 | 环境变量 `DSH_SCREENSHOT_DIR` | 显式指定保存目录 |
| 3 | 默认值 | `F:\dsh-screenshots`；该路径不可用时自动回退至 `~/.dsh/screenshots` |

设置项（优先级 1）与其他 DSH 插件（如 dsh-ssh）使用同一配置机制。示例：

```yaml
# ~/.dsh/settings.yaml
dsh-screenshot-paste:
  dir: "D:\\dsh-screenshots"
```

环境变量（优先级 2）示例：

```bat
set DSH_SCREENSHOT_DIR=D:\dsh-screenshots
```

设置项留空时，按优先级 2、3 依次解析。

## 🎯 使用

1. 打开任意会话，在输入框工具区找到 📎 按钮
2. 点击 📎 打开粘贴板面板，粘贴、拖拽或浏览上传文件
3. 文件保存后，输入框上方显示引用芯片（图片芯片可点击预览）
4. 输入消息并发送，消息自动附带文件路径：

```
[附件引用]
F:\dsh-screenshots\shot-142314.png
F:\dsh-screenshots\报告-150601.docx
```

5. 智能体按文件类型处理：文本与 Office 文档可直接读取；图片的识别依赖视觉能力（见下文）

> [!NOTE]
> 模型拿到的是文件路径（如 `F:\dsh-screenshots\报告-150601.docx`），需要智能体的文件访问能力能读到该路径。受限沙箱会话可能无法访问保存目录之外的文件——如需使用，请将保存目录配置在会话工作区可达的位置（见「⚙️ 配置」）。

## 👁️ 识图能力（可选，需自行配置）

本插件**不包含**任何视觉模型或识图能力，仅负责文件落地与路径附带。若需要智能体识别图片内容（描述图片、提取图中文字等），必须另行配置。

**推荐：安装 [`claude-vision-skill`](https://github.com/asuojun/claude-vision-skill)** ——让无视觉能力的模型获得识图能力，把图片交给视觉模型识别后用文字返回：

1. 克隆仓库：`git clone https://github.com/asuojun/claude-vision-skill.git`
2. 按仓库 README 配置：将 `vision.js` 放入 DSH 技能目录，填写 API Key 与模型名
3. 默认推荐阿里云百炼千问模型（新用户有免费额度）；也支持 OpenAI 等任何 OpenAI 兼容格式的服务，改 `BASE_URL` 即可

**备选方案**：使用其他支持视觉的 skill，或选择支持图片输入的多模态模型。

两种方式由你的运行环境提供，与本插件完全解耦，配置与否不影响插件本身的功能。

> [!NOTE]
> 未配置视觉能力时：文本、Office 文档等文件照常处理；图片仍会以路径形式附带，但模型无法查看其内容，通常会明确说明这一点——**不会静默失败**。

## ❓ 常见问题

**Q：不附带引用时，会影响 token 消耗或缓存吗？**

不会。插件不注册工具、不贡献提示词；无引用时 `agent/pre-step` 监听器直接放行，模型请求与未安装插件时完全一致。唯一的额外开销是附带引用时追加的路径文本（约几十 token）。

**Q：插件自带识图能力吗？**

不带。插件只负责文件落地与路径附带，不调用任何视觉模型。识别图片内容需要自行配置视觉 skill（推荐 `claude-vision-skill`，见上文「👁️ 识图能力」）或使用支持视觉的模型。没有识图能力时，文本类文件照常处理，图片会得到明确提示而非静默失败。

**Q：DSH 升级会影响插件吗？**

插件安装于 profile（用户数据区），独立于 DSH 安装目录，升级不会丢失。插件仅依赖官方扩展点；若 DSH 大版本变更相关接口，需要按新接口适配。

**Q：为什么修改后需要重启服务器？**

DSH 的客户端资源版本号在服务器启动时生成。任何插件变更（宿主端或客户端）都需要重启 `dsh web` 并硬刷新浏览器才能生效。

## 🧪 开发

仓库自带离线冒烟测试，运行于临时目录，不触碰真实数据：

```sh
node tests/test-host.mjs
```

## 📁 项目结构

```
dsh-screenshot-paste/
├── lib/
│   ├── index.js    # 宿主端：文件 API、引用存储、agent/pre-step 附带
│   └── client.js   # 浏览器端：📎 入口、粘贴板面板、引用芯片
├── tests/test-host.mjs   # 离线冒烟测试
├── cordis.patch.yml      # 插件注册（bundle patch）
└── package.json          # 包声明（dsh.bundle / dsh.client）
```

## 📄 许可证

[MIT](./LICENSE)
