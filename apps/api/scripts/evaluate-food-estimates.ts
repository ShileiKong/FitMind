/** Opt-in real model check: synthetic conversation only, no database or tool execution. */
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { CompatibleProvider } from '../src/providers/compatible.js';
import { coachPrompt } from '../src/modules/agent/prompts.js';
import { agentTools } from '../src/modules/agent/tools.js';

const envPath = new URL('../.env', import.meta.url);
const env = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
const mode = env.AI_PROVIDER;
let origin = '';
try {
  origin = new URL(env.AI_BASE_URL ?? '').origin;
} catch {}
if (
  origin !== 'https://api.deepseek.com' ||
  !env.AI_API_KEY?.trim() ||
  !env.AI_MODEL ||
  !['responses', 'chat_completions'].includes(mode)
) {
  console.log(
    JSON.stringify({
      status: 'unavailable',
      reason: 'No configured official DeepSeek credentials; no request sent.',
    }),
  );
  process.exit(0);
}
const phase = process.argv.includes('--baseline') ? 'baseline' : 'updated';
const budget = (target: number, total = 0) => ({
  target,
  known_total: total,
  remaining: Math.max(0, target - total),
  over: Math.max(0, total - target),
  incomplete: false,
  estimated: false,
});
const summary = {
  local_date: '2026-10-11',
  target_id: 'synthetic-target',
  record_count: 1,
  water_ml: budget(2000, 1400),
  calories_kcal: budget(2200),
  carbs_g: budget(250),
  protein_g: budget(120),
  fat_g: budget(60),
};
const context = {
  current_time: {
    now_utc: '2026-10-11T10:00:00Z',
    timezone: 'Asia/Shanghai',
    local_date: '2026-10-11',
  },
  message_reference_date: '2026-10-11',
  attachment_ids: [],
  profile: {
    id: 'synthetic-profile',
    version: 1,
    name: '',
    timezone: 'Asia/Shanghai',
    reminder_time: '21:00',
    notifications_enabled: true,
  },
  target: {
    id: 'synthetic-target',
    version: 1,
    status: 'active',
    effective_from: '2026-10-11',
    water_ml: 2000,
    calories_kcal: 2200,
    carbs_g: 250,
    protein_g: 120,
    fat_g: 60,
  },
  today_summary: summary,
  relevant_summary: summary,
  active_workout: null,
  recent_workouts: [],
  recommendations: [],
  exercise_history: [],
  plans: [],
  memories: [],
  records: [
    {
      id: 'synthetic-water',
      version: 1,
      kind: 'water',
      amount_ml: 1400,
      local_date: '2026-10-11',
      source_message_id: 'synthetic-previous-message',
      undone_at: null,
    },
  ],
};
const cases = [
  {
    name: 'milk-and-two-noodles-follow-up',
    transcript: [
      {
        role: 'user',
        content:
          '今天喝了1400毫升水，早餐喝了225毫升纯牛奶，午餐吃了两份番茄牛肉面。',
      },
      {
        role: 'assistant',
        content:
          '水已记录1400毫升。牛奶有营养标签吗？牛肉面是一份还是两份，每碗多大？',
      },
      { role: 'user', content: '我不确定热量，你得估算。' },
    ],
    expected:
      'Save both foods as estimates with assumptions; no water write or more portion/calorie questions.',
  },
  {
    name: 'two-portions-total-500g',
    transcript: [
      {
        role: 'user',
        content: '午餐吃了两份番茄牛肉面，一共500g。不知道热量，请估算并记录。',
      },
    ],
    expected: 'One food estimate for 500g total; never multiply total by two.',
  },
  {
    name: 'two-portions-each-500g',
    transcript: [
      {
        role: 'user',
        content: '午餐吃了两份番茄牛肉面，每份500g。不知道热量，请估算并记录。',
      },
    ],
    expected: 'One food estimate for 1000g total; twice the 500g quantity.',
  },
];
const provider = new CompatibleProvider({
  mode: mode as 'responses' | 'chat_completions',
  base_url: env.AI_BASE_URL!,
  api_key: env.AI_API_KEY!,
  model: env.AI_MODEL!,
  reasoning_effort: env.AI_REASONING_EFFORT?.trim() || 'none',
});
const selected = phase === 'baseline' ? cases.slice(0, 1) : cases;
console.log(
  JSON.stringify({
    phase,
    provider: mode,
    origin,
    model: env.AI_MODEL,
    requests: selected.length,
    synthetic_only: true,
  }),
);
for (const scenario of selected) {
  try {
    const step = await provider.next(
      {
        instructions:
          coachPrompt + '\n当前真实状态：' + JSON.stringify(context),
        transcript: scenario.transcript,
        tools: agentTools,
      },
      AbortSignal.timeout(60000),
    );
    // Never print raw HTTP errors, reasoning, settings, or an accidentally echoed key.
    const report = {
      case: scenario.name,
      expected: scenario.expected,
      assistant_text: step.assistant_text,
      tools: step.tool_calls.map((call) => ({
        name: call.name,
        arguments: call.arguments,
      })),
    };
    console.log(
      JSON.stringify(report).split(env.AI_API_KEY!).join('[redacted]'),
    );
  } catch (error: any) {
    console.log(
      JSON.stringify({
        case: scenario.name,
        error: error?.code ?? 'MODEL_REQUEST_FAILED',
        message: 'Isolated provider evaluation failed; no data was written.',
      }),
    );
  }
}
