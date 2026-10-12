# FitMind API 接入

实际路由生成的 [OpenAPI JSON](openapi.json) 可导入 API 调试工具。运行时 GET /api/v1/openapi.json，需个人令牌。共享 Schema 和 DTO 在 packages/contracts/src/；客户端使用同一合约。

## 通用规则

前缀 /api/v1。除 GET /health 外携带 Authorization: Bearer <个人访问令牌>。写操作携带唯一 Idempotency-Key；重试保持相同键和正文，改正文使用新键。同键不同正文返回 409 IDEMPOTENCY_CONFLICT。修改使用 expected_version；过期返回 409 VERSION_CONFLICT，刷新并核对后重新提交。

PATCH /profile 同样必须提供 expected_version，初始资料版本为 0。时区不可留空；提供有效的新时区可以修复旧的无效设置。仅提交要修改的字段，避免旧页面覆盖其他设置。

日期 YYYY-MM-DD，时间 UTC ISO 8601，时区 IANA。水 ml、能量 kcal、营养素 g、训练 kg。未知值 null，零是明确的零。JSON 数字 / 布尔值不接受字符串自动转换。

```json
{
  "data": {},
  "request_id": "req-1",
  "server_time": "2026-10-11T02:00:00.000Z",
  "timezone": "Asia/Shanghai"
}
```

错误为 error:{code,message,retryable} 加 request_id。状态码 400 输入 / 日期错误、401 鉴权、404 不存在、409 版本 / 幂等冲突、413 文件过大、429 工具轮数、502 供应商错误、503 未配置、504 超时。响应回执中的记录才是已保存数据。

## 公共接口

| 请求                                                                       | 用途 / 主要字段                                                                                                                  |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET /health、/capabilities                                                 | 状态与已配置能力，无密钥                                                                                                         |
| GET /context                                                               | now_utc、timezone、local_date、当前 target、active_workout                                                                       |
| GET /profile；PATCH /profile                                               | name、timezone、reminder_time、notifications_enabled                                                                             |
| GET /days/{date}/summary                                                   | 每项预算：target、known_total、remaining、over、estimated、incomplete                                                            |
| GET /targets；POST /targets/drafts                                         | effective_from / effective_to、water_ml、calories_kcal、carbs_g、protein_g、fat_g；历史生效需 allow_history=true                 |
| POST /targets/drafts/{id}/confirm                                          | expected_version；可选 apply_from 日期，从该日启用                                                                                |
| POST /chat/messages；GET /chat/messages/{id}                               | 发消息、查回执                                                                                                                   |
| GET /chat/conversations/{id}/messages                                      | 最近 50 条带日期消息                                                                                                             |
| GET /records；POST /records；GET /records/{id}                             | 手动数据；筛选 kind / local_date / start_date / end_date / cursor / limit（最多 500）                                            |
| PATCH /records/{id}；POST /records/{id}/undo                               | expected_version；更正另带 patch                                                                                                 |
| GET /plans；POST /plans；GET /plans/{id}                                   | 创建草案，指定 days、repeat 或 weekly 三选一                                                                                     |
| POST /plans/{id}/confirm；PATCH /plans/{id}；POST /plans/{id}/cancel       | expected_version；确认可选 apply_from，修订另带 patch                                                                             |
| GET /workout-days；GET /workout-days/{id}                                  | 日期化训练日及最新状态                                                                                                           |
| POST /workout-sessions；GET /workout-sessions；GET /workout-sessions/{id}  | workout_day_id；会话快照与真实 sets                                                                                              |
| PATCH /workout-sessions/{id}                                               | expected_version、action=pause/resume/switch/skip/complete/abandon/change_date；switch 带 exercise_id，change_date 带 local_date |
| POST /workout-sessions/{id}/sets                                           | exercise_id、reps、weight_kg 可空、difficulty 可选 easy/normal/hard、rpe 可空、pain 可选                                         |
| PATCH /workout-sets/{id}；POST /workout-sets/{id}/undo                     | expected_version / patch，旧建议失效并重算                                                                                       |
| GET /workout-sessions/{id}/recommendations                                 | 下一组与下次建议，含 basis 记录版本及规则                                                                                        |
| POST /recommendations/{id}/accept                                          | expected_version；仅 proposed 的 next_workout，更新未来可比计划，幂等事务                                                        |
| POST /media/images；POST /media/audio；GET /media/{id}                     | multipart 的 file；按归属读取附件字节                                                                                            |
| POST /nutrition/analyze                                                    | asset_id、mode=label/meal、description 可选；返回草案，不写摄入                                                                  |
| POST /audio/transcriptions                                                 | multipart 音频或 JSON asset_id；只返回可编辑 text                                                                                |
| GET /memories；POST /memories；PATCH /memories/{id}；DELETE /memories/{id} | 新记忆 key/value/source_message_id；更正 expected_version/value；删除 expected_version                                           |
| GET /trends                                                                | 日期范围、metric；身体指标或 water_ml / 四项营养 / workout；训练可筛 exercise_id / variant / equipment / load_convention         |
| GET /reminders；POST /reminders/device-status                              | 未来提醒规格；permission / scheduled / cancelled / failed 等设备结果                                                             |

兼容路径保留：POST /chat、GET /messages、GET /messages/{id}、POST /messages/{id}/recover、POST /targets/{id}/confirm、POST /plans/drafts、POST /workout-sessions/{id}/transition、GET /recommendations?session_id=...、POST /memories/{id}/forget。所有别名调用同一业务逻辑。

## 示例

```json
{ "kind": "water", "amount_ml": 500, "local_date": "2026-10-10" }
```

POST /records 返回 {entity:{id,version,...},version,affected_dates}。更正正文：

```json
{ "expected_version": 1, "patch": { "amount_ml": 200 } }
```

改日期返回原日期和新日期；撤销重新计算余额，保留历史修订。

目标 effective_to 为明确结束日期时，只覆盖指定区间，原有目标的前后区间保留。没有结束日期的新目标延续至下一个已安排目标前一天。

目标和计划确认可提供 `apply_from: "YYYY-MM-DD"`。小程序确认按钮采集设备今日日期，连同 expected_version 保存到同一待处理命令；跨日重试保持原日期和 Idempotency-Key。饮食目标从该日启用，有限期限保持原天数。周期运动计划从该日启用，保留原星期、各星期的周间隔、同日多课和处方，周期末日覆盖最后一次训练；单次日期计划保留相对日期间隔。已经进行的训练不会迁移。不提供 apply_from 的已有客户端沿用草案原日期；取消接口仍只接受 expected_version。

同动作表现按规范化名称、变式、器械和重量记法比较；exercise_id 是训练日内的动作编号。GET /trends 的 exercise_id 会找到对应动作，并查询同语义动作历史。未来加重建议绑定生成时计划版本与最新两次表现；新组、后续失败、依据修改或计划修订会使旧建议无法被接受。

AI 工具同时覆盖计划修订/取消、资料与提醒更新、开始/暂停/结束训练、接受未来建议、记忆更正。工具只调用相同业务服务；新目标和新计划仍需草案确认，未来建议仍需明确接受。

准确食品由后端按标签基准换算：

```json
{
  "kind": "food",
  "name": "标签食品",
  "source": "label",
  "nutrition": {
    "calories_kcal": null,
    "carbs_g": null,
    "protein_g": null,
    "fat_g": null
  },
  "label": {
    "basis_quantity": 100,
    "basis_unit": "g",
    "consumed_quantity": 150,
    "consumed_unit": "g",
    "nutrition_per_basis": {
      "calories_kcal": 200,
      "carbs_g": 20,
      "protein_g": 10,
      "fat_g": 5
    }
  }
}
```

估算食品 source=estimate，填写估算后的 nutrition、assumptions、可选 attachment_ids。单位不匹配先补充依据，不能把 ml 当 g；附件须是已上传的本人图片。体重例：

```json
{
  "kind": "body",
  "metric": "weight_kg",
  "value": 70,
  "local_date": "2026-10-11"
}
```

其他身体指标为 body_fat_percent、waist_cm、chest_cm、hip_cm、arm_cm。

对话字段以真实合约为准，消息 ID 使用 message_id：

```json
{
  "message_id": "unique-message-id",
  "conversation_id": "main",
  "text": "昨天喝了500毫升水",
  "attachment_ids": []
}
```

首次接收冻结日期；离线另带 offline_queued、captured_at、capture_timezone、capture_local_date。重试保持消息 ID 与正文；GET 查回执，失败可用 recover 重用已保存命令。目标 / 计划确认通过明确文字或 confirmation:{type,id,expected_version}；未确认只保存草案。

结果含 status（completed / partial / failed）、assistant_text、record_receipts、proposals、recommendations、affected_dates、summary、tool_errors、可选 error。澄清为 completed + 问题文字且无记录；模型尾段失败可能 partial，已有回执有效。删除记忆排除原来源重新进入上下文，审计修订仍保留。

计划示例：

多周重复训练使用 `weekly:{start_date,end_date,days:[{weekday,name,exercises}]}`。星期 `0` 为周日、`1` 为周一，依此到 `6` 周六，每个星期只能定义一套训练，多个动作放在同一套中。不同星期可有不同动作，服务按包含首尾的日期区间生成实际训练日。`days`、旧的同动作 `repeat`、新的 `weekly` 三选一，区间最长一年。

返回的 `days` 仍包含具体日期和独立训练日编号，周循环另有 `period:{start_date,end_date}` 保留原范围，兼容训练会话、编辑和提醒。旧计划无需迁移；客户端从真实日期与完整动作参数识别连续周循环，重量、组数、次数、休息或改期有差异时分阶段或单独显示。`PATCH /plans/{id}` 的 patch 也支持 `weekly` / `repeat`；修改同日期的周模板保留可唯一匹配的训练日编号。仅修改一天时继续提交带原编号的 `days`。

```json
{
  "name": "上肢计划",
  "days": [
    {
      "local_date": "2026-10-12",
      "name": "上肢",
      "exercises": [
        {
          "exercise_id": "bench-1",
          "name": "卧推",
          "variant": "杠铃平板",
          "equipment": "barbell",
          "load_convention": "total",
          "weight_kg": 100,
          "increment_kg": 2.5,
          "sets": 3,
          "reps_min": 10,
          "reps_max": 12,
          "rest_seconds": 90
        }
      ]
    }
  ]
}
```

修订保留原训练日 id；省略则创建新日，删去的旧日标记 cancelled。训练实际日期与处方日期分开；跨午夜沿用开始日，可整场更正。actual 与 recommendation 分开；更正不会自动改未来处方。接受建议才修改未来计划，已完成快照和实际数据保留。

## 模型扩展

TextAgentProvider.next 返回工具调用 / assistant_text / 完整响应项；VisionProvider.analyze 返回 NutritionAnalysisSchema；TranscriptionProvider.transcribe 返回 text。工具不能执行 SQL。服务端保存固定操作位置，事务提交事实与回执；重试不重复执行已有命令。

模型适配器在 providers/，规则在 modules/workouts/recommendation.ts，通知边界在客户端 native/notifications.ts。默认 5 轮工具、单次 30 秒、总计 90 秒，环境变量可调。供应商错误正文不直接透传。
