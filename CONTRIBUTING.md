# Contributing

## 发布新版本

1. 更新 `package.json` 中的 `version` 字段，并在 `README.md` 中同步安装示例的版本标签
2. 提交并推送：

```sh
git add .
git commit -m "release: vX.Y.Z"
git push origin main
```

3. 打标签并推送：

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

4. 本机验证打包产物：

```sh
pnpm pack
dsh plugin --profile web add file:F:/dsh-screenshot-paste/dsh-screenshot-paste-X.Y.Z.tgz
```

安装后重启 `dsh web` 并硬刷新浏览器（Ctrl+F5）。

## 开发

本机开发安装使用本地链接，便于即时迭代：

```sh
dsh plugin --profile web add link:F:/dsh-screenshot-paste
```

注意：`link:` 安装为符号链接，插件运行时无法解析官方包（`@deepseek-ai/*`），设置命名空间会静默降级为环境变量/默认配置。需要验证设置机制时，改用 tarball 安装。

修改宿主端或客户端代码后，均需重启 `dsh web` 并硬刷新浏览器（Ctrl+F5）才能生效。

## 测试

```sh
node tests/test-host.mjs
```

测试使用临时目录，不触碰真实数据。
