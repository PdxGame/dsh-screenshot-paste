# dsh-screenshot-paste · DSH 附件粘贴板

一个 DeepSeek Harness (DSH) 的**零依赖、零构建** Web 插件：把截图/文件**粘贴、拖拽或浏览上传**到本地目录，以「引用芯片」形式挂在输入框上方，发送消息时**自动附带文件路径**，让智能体按类型处理（图片识图、文本直接读取）。

> 纯外部插件：不修改 DSH 任何源码，仅使用官方扩展点（插槽 / API 路由 / `agent/pre-step` 事件）。

---

## ✨ 功能特性

- 📎 **三通道上传**：Ctrl+V 粘贴、拖拽、点击浏览（多文件）
- 🗂️ **任意文件类型**：图片 / PDF / Office / 压缩包 / 音视频 / 文本；白名单外类型（如 .exe）明确拒绝
- 🏷️ **引用芯片**：输入框上方一行芯片（`🖼️` 图片 / `📄` 文件），带 × 可删，点击图片芯片可预览大图
- 📤 **自动送达**：发送消息时，宿主在 `agent/pre-step` 阶段自动把路径追加进消息（`[附件引用]`），发送后自动清空
- 🧹 **零输入框污染**：输入框、光标、草稿完全原生——没有任何占位符或隐藏字符
- 💰 **零常驻消耗**：不注册任何工具、不贡献提示词片段；无引用时对模型请求零影响、不破坏缓存命中
- 🔒 **安全**：全部 API 仅限本机回环（loopback）；文件名校验防路径穿越；保存目录按需自动创建

## 📦 安装

### 从 GitHub 安装（推荐）

```sh
# 方式一：直接装 GitHub 仓库（需仓库已发布）
dsh plugin --profile web add github:PdxGame/dsh-screenshot-paste

# 方式二：克隆后本地链接（开发/调试推荐）
git clone https://github.com/PdxGame/dsh-screenshot-paste.git
dsh plugin --profile web add link:<克隆到的路径>
```

装完**重启 `dsh web`**，并**硬刷新浏览器（Ctrl+F5）**——客户端 bundle 的版本号在服务器启动时锁定，改完必须重启才生效。

### 卸载

```sh
dsh plugin --profile web remove dsh-screenshot-paste
# 重启 dsh web 生效
```

### 发布到 GitHub（供其他电脑/用户安装）

```sh
git init
git add .
git commit -m "dsh-screenshot-paste 0.1.0"
git remote add origin https://github.com/PdxGame/dsh-screenshot-paste.git
git push -u origin main
git tag v0.1.0 && git push origin v0.1.0   # 可选：固定版本，README 中可写 github:<用户名>/dsh-screenshot-paste@v0.1.0
```

其他电脑安装：`dsh plugin --profile web add github:PdxGame/dsh-screenshot-paste`（或带 `@v0.1.0` 固定版本）→ 重启 `dsh web` → Ctrl+F5。

## ⚙️ 配置

**零配置开箱即用**：装好就能用，默认保存到 `F:\dsh-screenshots`（F 盘不存在时自动回退 `~/.dsh/screenshots`）。需要自定义时按以下优先级：

| 优先级 | 配置项 | 方式 | 说明 |
|---|---|---|---|
| 1 | **保存目录** | 设置命名空间 `dsh-screenshot-paste.dir` | 官方设置机制：GUI 设置页（Web）或 `~/.dsh/settings.yaml`，**改动即时生效，无需重启** |
| 2 | **保存目录** | 环境变量 `DSH_SCREENSHOT_DIR` | 显式指定（如 `D:\shots`），适合启动器/系统级固定 |
| 3 | 默认回退 | — | `F:\dsh-screenshots` → `~/.dsh/screenshots`（其他电脑开箱即用） |
| — | **自动引用** | 面板内复选框（记住选择） | 保存后是否自动加入引用芯片 |
| — | 文件大小上限 | 内置常量 | 单文件 ≤ 50MB |

> 设置项（方式 1）与 DSH 生态其他插件（dsh-ssh、dsh-web-ui 等）同一机制，`settings.yaml` 示例：
>
> ```yaml
> dsh-screenshot-paste:
>   dir: "D:\\dsh-screenshots"
> ```
>
> 环境变量（方式 2）示例：
> ```bat
> set DSH_SCREENSHOT_DIR=D:\dsh-screenshots
> ```
>
> 设置项留空 = 使用方式 2/3（自动回退）。

## 🎯 使用

1. 打开任意**真实会话**（空白首页无入口），输入框 `Full access` 右侧出现 📎 按钮
2. 点 📎 打开面板：粘贴 / 拖拽 / 「浏览…」上传文件
3. 文件自动保存，输入框上方出现引用芯片（图片 `🖼️` 可点击预览、`📄` 为文件）
4. 点芯片 `×` 删除引用；面板里每张文件有「引用/已引用」状态、可单独删除、可清空所有
5. 正常输入文字并发送 → 消息自动附带：

```
[附件引用]
F:\dsh-screenshots\shot-142314.png
F:\dsh-screenshots\附件1实习申请表-150601.docx
```

6. 智能体按类型处理：图片走识图能力、文本/Office 直接本地读取

## ❓ 常见问题

**Q：不发送引用时会影响 token / 缓存吗？**
不影响。插件不注册工具、不贡献提示词；`agent/pre-step` 监听器在无引用时直接放行，模型请求与未装插件时逐字节相同。唯一的 token 开销是带引用发送时附加的路径文本（几十 token）。

**Q：插件和识图 skill 是什么关系？**
完全解耦。插件只负责"文件落地 + 路径送达"，从不调用任何视觉模型/技能。识图是智能体处理图片路径时的最后一步，由你的环境提供（qwen-vision skill / 视觉插件 / 视觉模型）。没有识图能力时，文本文件照常处理，图片会得到明确提示而非静默失败。

**Q：DSH 升级会破坏插件吗？**
插件位于 profile（用户数据区），独立于 DSH 安装目录，升级不丢失。它只依赖官方扩展点（插槽名、`webServer` 路由、`agent/pre-step` 事件）；若 DSH 大版本修改这些接口，需按新接口适配（所有插件的共性）。

**Q：为什么会需要重启服务器？**
DSH 的客户端 bundle 版本号在服务器启动时生成。任何插件改动（宿主或客户端）都要重启 `dsh web` + 硬刷新浏览器才能生效。

## 🧪 自测

仓库自带离线冒烟测试（临时目录，不影响真实数据）：

```sh
node tests/test-host.mjs
```

## 📁 结构

```
dsh-screenshot-paste/
├── lib/
│   ├── index.js    # 宿主半区：文件 API + pending 存储 + agent/pre-step 追加
│   └── client.js   # 浏览器半区：📎 入口 + 粘贴面板 + 引用芯片条
├── tests/test-host.mjs   # 离线冒烟测试
├── cordis.patch.yml      # 插件行（bundle patch）
└── package.json          # dsh.bundle + dsh.client 声明
```

## 📄 许可证

[MIT](./LICENSE)
