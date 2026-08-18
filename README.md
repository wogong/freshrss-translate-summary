# FreshRSS 翻译与摘要

这是一个 FreshRSS 用户扩展，可通过 OpenAI 兼容 API 对文章内容进行中文翻译或生成中文摘要。

## 功能

- 一键翻译文章内容
- 一键生成中文摘要
- 支持多个 OpenAI 兼容 API 地址与模型配置
- 可在文章工具栏中快速切换 API 配置和模型
- 可自定义请求超时、连接超时、翻译提示词和摘要提示词
- 适配 FreshRSS 明暗主题
- 界面与操作提示中文化

## 安装

1. 从 Releases 下载扩展压缩包。
2. 解压后确认目录名为 `freshrss-translate-summary`。
3. 将目录放入 FreshRSS 扩展目录：

   ```text
   /var/www/FreshRSS/extensions/
   ```

4. 进入 FreshRSS 的“设置 → 扩展”，启用“FreshRSS 翻译与摘要”。

## 配置

进入扩展设置页，可以添加一个或多个 API 配置组。每个配置组包含：

- 配置名称
- API 基础地址，例如 `https://api.openai.com/v1`
- API 密钥
- 模型名称，例如 `gpt-4o`

如果同一个 API 地址需要使用多个模型，可以新增多个配置组，并复用相同的 API 地址和密钥。

扩展还支持配置：

- 请求超时，默认 180 秒
- 连接超时，默认 30 秒
- 翻译提示词
- 摘要提示词

保存后，打开任意文章，在工具栏下拉框中选择需要使用的 API 配置，再点击“翻译”或“摘要”。最近选择的配置会保存在当前浏览器中。

旧版本中保存的单一 API 地址、密钥和模型会自动迁移为第一个配置组。

## 隐私与安全

扩展前端只接收配置名称、模型名称和配置编号。API 地址和 API 密钥仅保存在 FreshRSS 用户配置中，不会下发到浏览器工具栏。

## 致谢

本扩展最初参考了 [xExtension-ArticleSummary](https://github.com/LiangWei88/xExtension-ArticleSummary)。
