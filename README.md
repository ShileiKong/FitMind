# FitMind · 个人健身 Agent MVP

**0.3.8 日期修复**：对话和今日额度按设备当前日期与用户时区重新读取当天记录，保留每日目标与历史。旧对话标明原始日期，跨午夜恢复或离线补记仍使用原采集日期，成功回执不会重复记账。

黑绿风格的 iPhone 客户端（Expo / React Native）、可持久化后端、可替换模型接口。真实记录保存到 SQLite；每次消息有固定日期、操作回执和幂等 ID，长期使用不依赖模型记住整段聊天。

微信小程序 **0.3.8 手机本地版**：无需电脑或自建服务器，记录、计划、训练、目标、记忆与对话保存到手机；AI 直接联网调用 DeepSeek。配置个人 Key 并使用 DeepSeek Flash 系列支持的模型后，可识别餐食照片和营养标签，核对或编辑份量、营养值后确认保存；识别本身不会记账。语音按钮引导使用手机键盘听写，听写文字可编辑，点击发送后才处理；这不是小程序内置 ASR，不需要另一家语音服务。

照片单张上限 5 MiB，本地缓存最多 30 张或 40 MiB，超过上限会清理最旧照片，已保存饮食记录保留。业务 JSON 备份含照片元数据，不含原图或 API Key；导入和重置会清理照片缓存，保留 Key。管理员只需配置 `https://api.deepseek.com` 为 request 合法域名。`npm run export:miniprogram` 构建至 `apps/miniprogram/dist`，`npm run package:miniprogram` 生成可导入 ZIP。手机配置、键盘听写操作、备份及真实设备验收见 [微信验收说明](docs/wechat-testing.md)。下文的后端/模型配置适用于 Expo 与电脑版。

## 从源码运行

需要 Node.js **24.16.0 或更新版本**及 npm。克隆本仓库后，在仓库根目录安装依赖：

```sh
npm ci
```

### 网页与 Expo 客户端

```sh
npm run dev
```

`npm run dev` 同时启动后端和网页；缺少 `apps/api/.env` 时自动复制 `.env.example`。网页默认 http://localhost:8081，后端默认 http://127.0.0.1:8787。不要重复启动占用同一端口的服务。

首次启动生成 **data/access-token**。打开 App「连接与设置」，填写后端地址及该文件内的**个人访问令牌**。数据库为 `data/fitmind.sqlite`，上传附件为 `data/media/`。首次启动是空白数据，无模型密钥时仍可手动记录和使用规则建议。

安装依赖后，后续只需 `npm run dev`。Ctrl+C 停止本命令启动的进程。也可以分别执行 `npm run dev:api` 与 `npm run dev:mobile -- --web --port 8081`。iPhone 原生运行见下文。

### 微信手机本地版

```sh
npm run export:miniprogram
```

在微信开发者工具中导入 **apps/miniprogram/dist**，选择普通小程序工程。默认 `touristappid` 可用于工具内查看；手机预览和体验版需使用自己的小程序 AppID。使用真实 AppID 构建时，把示例值替换为自己的 AppID：

```sh
npm run export:miniprogram -- --appid wx0123456789abcdef
npm run package:miniprogram -- --appid wx0123456789abcdef --out data/releases/FitMind-miniprogram.zip
```

ZIP 内的 `miniprogram/` 也可导入开发者工具；不需要在工具中执行“构建 npm”。手机本地版无需启动后端，模型 Key 在手机设置页填写。联网调用 DeepSeek 前需配置自己的小程序 request 合法域名，详见 [微信说明](docs/wechat-testing.md)。

手机本地版的单次模型请求最多 **120 秒**，一条消息的多轮工具调用共用 **360 秒**预算。等待期间可在完整对话查看新问题与处理状态；超时后先查看回执，再恢复原消息，沿用原请求编号与采集日期。已保存的操作不会因恢复再次记账。

## 接入模型 API

只编辑 **apps/api/.env**，保存后重启后端。模型密钥不填进手机，也不放进 EXPO*PUBLIC*\*。

```dotenv
AI_PROVIDER=responses
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=你的模型服务密钥
AI_MODEL=你账户可用且支持工具调用的模型
```

兼容 Chat Completions 的服务改成 AI_PROVIDER=chat_completions；AI_BASE_URL 填 API 根地址，例如以 /v1 结尾的地址，适配器自动追加 /chat/completions。Responses 模式追加 /responses。模型必须支持工具调用；图片解析还需要结构化 JSON 输出支持。兼容能力需用真实服务验收。

图片和转写可独立配置：

```dotenv
VISION_PROVIDER=responses
VISION_MODEL=支持图片和结构化输出的模型
VISION_BASE_URL=
VISION_API_KEY=
TRANSCRIPTION_BASE_URL=https://api.openai.com/v1
TRANSCRIPTION_API_KEY=转写服务密钥
TRANSCRIPTION_MODEL=支持文件转写的模型
```

图片地址和密钥留空时沿用文字服务，**图片模型仍需单独填写**；语音独立配置。设置页「已配置」表示配置存在，未代表实际调用通过。没有密钥时手动记录、目标、计划和规则建议照常工作。AI_PROVIDER=demo 是显式演示模式，只演示简单饮水句子；默认不会启用。

APP_ACCESS_TOKEN 是私人后端访问密码，与供应商 AI_API_KEY 不同；空白则自动生成。请求模型时会发送当前任务需要的资料、记录和你选择的附件。调用失败保留输入，已提交回执仍可查询。

DeepSeek Responses 接入可使用 `AI_BASE_URL=https://api.deepseek.com`、`AI_MODEL=deepseek-flash`、`AI_REASONING_EFFORT=low`。思考强度留空时沿用供应商默认；配置值需为所选模型支持的档位。单次模型请求默认最多 60 秒，一条消息的多轮工具调用合计最多 180 秒；App 发送与恢复消息最多等待 190 秒。若提高后端总时限，也需同步提高客户端的请求时限。修改后端配置后需重启，静态网页代码修改后需重新导出。

## iPhone 运行

网页用于预览和业务验收。原生相机、录音、SecureStore 和本地通知需要 iOS development build。

1. 后端 .env 设置 HOST=0.0.0.0，重启。电脑和手机连接同一 Wi-Fi。
2. 手机后端地址填 http://电脑局域网IP:8787；手机上的 localhost 指手机自身。允许 Windows 防火墙接收此端口的局域网请求。
3. 在 apps/mobile 下执行下列命令，按 EAS 提示设置自己的项目、设备和 Apple 签名。
4. 安装后运行 npx expo start --dev-client --lan。独立预览构建使用 --profile preview。

```powershell
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform ios --profile development
npx expo start --dev-client --lan
```

目前没有代登录、申请签名或发布商店。构建需要你的 Expo / Apple 账号与相应权限。[EAS 官方步骤](https://docs.expo.dev/build/setup/)。公网运行应使用 HTTPS。

通知在**已确认计划的前一晚**触发，默认 21:00；点击加载最新训练日。每次同步安排最近 60 条未来本地通知，改期 / 取消替换旧版本。外部客户端改计划后，手机下次同步才更新通知；跨设备即时远程推送由通知接口扩展。

## 已有功能

- 今日饮水、能量、碳水、蛋白质、脂肪剩余额度；未知、估算、超额分别展示。
- 标签按实际重量換算；模糊饮食文字 / 图片估算，份量不足先补充。
- 体重、体脂率、围度；身体、摄入、同动作表现趋势 API。
- 目标草案确认、生效区间和历史；训练计划草案、确认、改期、取消。重复训练按“日期范围＋每周安排”展示，周循环可为不同星期定义不同动作；具体日期可展开，变更的重量、动作和阶段单独保留。
- 实际组、暂停恢复、休息计时、编辑撤销、下组推荐、接受下次加重建议。
- 长期记忆查看 / 更正 / 删除；按日期和当前训练读取真实历史。
- 相机 / 相册预览，录音转为可编辑文字，用户发送后才执行业务操作。
- 离线缓存及待同步队列；保留原日期、附件和请求 ID，重启后继续。
- 底部文字输入，相机与语音同侧，语音在最右。
- AI 默认用简短中文回复结果和下一步；思考内容不显示，长回复可展开，完整训练计划与目标从草案页面查看。重复错误合并提示，保存失败仍会说明。

微信 0.3.6 可在对话内直接确认目标，保持当前页面；再打开今日页即可看到生效目标与更新后的剩余额度。底部预览可展开回复全文；完整对话首次进入、发送问题与追加回复时跟随最新内容，阅读历史时刷新保持位置。

饮食建议在每次模型调用前重新读取所选自然日的完整食品账本、生效目标和营养汇总；同一轮工具调用新增或更正记录后，下一次模型调用使用更新后的全天预算。估算与待补项仍会标明，未知营养不会按零处理。

手动表单的重试沿用原提交编号，后台恢复成功后再次保存会核对原回执。新的一次相同饮水/训练仍会单独计数。离线训练页从缓存打开；组暂存后可选择「记录新的一组」，暂存内容在待同步中可见，联网提交后才计入实际组数。更正已有记录必须取得原记录和版本，加载失败不会转成新增。

AI 可以修改/取消现有计划、调整提醒、开始/暂停/结束训练和更正记忆。直接说稳定偏好或可用器械即可，无需固定的「记住」关键词；每条记忆保留本次输入来源。旧消息重试保留原始前文与事实上下文，最新版本冲突会要求核对。

## 接口与验证

[API 使用说明](docs/api.md)、[自动导出的 OpenAPI](docs/openapi.json)、[iPhone 验收清单](docs/ios-testing.md)、[微信验收清单](docs/wechat-testing.md)。

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run export:openapi
npm run export:ios
```

build 包含后端 / 合约类型检查与网页导出；export:ios 是 iOS JavaScript / Hermes 资源导出，**不是已签名 IPA**。静态预览：npm run export:web 后 npm run preview，地址 http://127.0.0.1:8082；仍需启动后端。

## 代码与数据

apps/api：Fastify、SQLite、Agent 工具、模型适配器。apps/mobile/src/app：Expo Router 页面。packages/contracts：共享请求 Schema / DTO。scripts：Windows 可用的开发与预览命令。

数据和 `.env` 已加入 Git 忽略，仓库不包含个人密钥或记录。备份时先关闭后端，再复制整个 `data/`（含数据库和附件）；不要仅复制正在使用的 SQLite 文件。导出的个人备份也应保存在忽略的 `data/` 目录内。

这是个人使用开发 MVP。真实模型端到端、Apple 签名构建、iPhone 锁屏通知 / 相机 / 录音 / 键盘尚需按清单验收；网页和自动测试不代替这些结论。

## 许可与第三方素材

本项目自有代码采用 [MIT License](LICENSE)。依赖、Expo 模板和第三方素材保留各自的许可与权利，详见 [NOTICE](NOTICE.md)。DeepSeek 名称及角色皮肤不代表官方关联。
