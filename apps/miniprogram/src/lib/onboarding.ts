import type { FitnessProfile, Profile } from '@fitmind/contracts';

export type SetupStep =
  | 'body'
  | 'sex'
  | 'goal'
  | 'strength'
  | 'availability'
  | 'limitations'
  | 'review';
export const setupQuestions = {
  body: {
    id: 'body',
    text: '先认识一下你：现在的身高和体重是多少？',
    hint: '例如：177cm，72kg。也可以分开告诉我。',
    choices: [],
  },
  sex: {
    id: 'sex',
    text: '你的性别是？也可以暂不透露。',
    hint: '用于个性化建议，不想填可以跳过。',
    choices: ['男', '女', '暂不透露'],
  },
  goal: {
    id: 'goal',
    text: '你最想达到什么目标？',
    hint: '用自己的话说就好，例如：减脂，练成薄肌身材。',
    choices: ['减脂', '增肌', '薄肌塑形', '保持健康'],
  },
  strength: {
    id: 'strength',
    text: '你愿意做力量训练吗？',
    hint: '我会根据你的选择安排；不接受也可以。',
    choices: ['可以', '暂不接受', '还不确定'],
  },
  availability: {
    id: 'availability',
    text: '一周哪些时间方便运动？',
    hint: '例如：每周四五六早上，每次45分钟。暂时没想好也可以。',
    choices: ['暂未确定'],
  },
  limitations: {
    id: 'limitations',
    text: '还有需要我考虑的身体限制或器械条件吗？',
    hint: '例如：膝盖不舒服、只在家练、有哑铃。没有想补充的可以跳过。',
    choices: ['无已知限制，去健身房', '在家徒手训练', '跳过'],
  },
  review: {
    id: 'review',
    text: '这些是你刚才告诉我的，确认一下吧。',
    hint: '保存资料后，可让 AI 生成目标和每周训练草案。',
    choices: [],
  },
} as const;

export function nextSetupQuestion(
  profile: Pick<Profile, 'fitness' | 'onboarding_status'>,
) {
  const f = profile.fitness || {};
  if (profile.onboarding_status === 'completed') return setupQuestions.review;
  if (!f.height_cm || !f.weight_kg) {
    return {
      ...setupQuestions.body,
      text: f.weight_kg
        ? '你的身高是多少？'
        : f.height_cm
          ? '你现在的体重是多少？'
          : setupQuestions.body.text,
    };
  }
  if (!f.sex) return setupQuestions.sex;
  if (!f.goal) return setupQuestions.goal;
  if (!f.strength_training) return setupQuestions.strength;
  if (!f.availability_text) return setupQuestions.availability;
  if (!f.limitations) return setupQuestions.limitations;
  return setupQuestions.review;
}

export function parseSetupAnswer(
  step: SetupStep,
  raw: string,
  known: FitnessProfile = {},
): FitnessProfile {
  const text = raw.trim();
  if (!text) throw new Error('先告诉我你的答案，或选择下面的选项。');
  if (step === 'body') {
    const weight =
      text.match(
        /(?:体重\s*(?:是|为|[:：])?\s*)([-+]?\d+(?:\.\d+)?)\s*(kg|公斤|千克|斤)?/i,
      ) || text.match(/([-+]?\d+(?:\.\d+)?)\s*(kg|公斤|千克)/i);
    const height =
      text.match(
        /(?:身高\s*(?:是|为|[:：])?\s*)([-+]?\d+(?:\.\d+)?)\s*(cm|厘米|公分|米|m)?/i,
      ) || text.match(/([-+]?\d+(?:\.\d+)?)\s*(cm|厘米|公分|米|m)(?!l|g)/i);
    const result: FitnessProfile = {};
    if (weight)
      result.weight_kg = Number(weight[1]) / (weight[2] === '斤' ? 2 : 1);
    if (height)
      result.height_cm =
        Number(height[1]) * (/^(米|m)$/i.test(height[2] || '') ? 100 : 1);
    if (/^[-+]?\d+(?:\.\d+)?$/.test(text)) {
      if (known.weight_kg && !known.height_cm) result.height_cm = Number(text);
      if (known.height_cm && !known.weight_kg) result.weight_kg = Number(text);
    }
    if (!Object.keys(result).length)
      throw new Error('请带上单位或名称，例如“72kg，177cm”或“身高177”。');
    if (
      (result.height_cm !== undefined &&
        (result.height_cm < 50 || result.height_cm > 260)) ||
      (result.weight_kg !== undefined &&
        (result.weight_kg < 10 || result.weight_kg > 400))
    )
      throw new Error('这个数值看起来不太对，请检查一下身高和体重的单位。');
    return result;
  }
  if (step === 'sex') {
    if (/暂不|跳过|不透露|保密/.test(text)) return { sex: 'unspecified' };
    if (/^(男|男性|我是男生|我是男性|男生)$/.test(text)) return { sex: 'male' };
    if (/^(女|女性|我是女生|我是女性|女生)$/.test(text))
      return { sex: 'female' };
    throw new Error('请选择男、女或暂不透露。');
  }
  if (step === 'strength') {
    if (/不(?:太)?确定|没想好|不清楚|跳过/.test(text))
      return { strength_training: 'unsure' };
    if (
      /不(?:太|那么|怎么|很)?(?:接受|愿意|可以)|不能|拒绝|不要|不练|^不$/.test(
        text,
      ) ||
      /不(?:太|那么|怎么|很)?想(?:做|练)?(?:力量|抗阻|举铁)/.test(text)
    )
      return { strength_training: 'no' };
    if (/可以|愿意|接受|能做|能练|^能$|^好|^是的?$/.test(text))
      return { strength_training: 'yes' };
    throw new Error('可以选择接受、暂不接受或还不确定。');
  }
  const key =
    step === 'goal'
      ? 'goal'
      : step === 'availability'
        ? 'availability_text'
        : step === 'limitations'
          ? 'limitations'
          : null;
  if (!key) throw new Error('请先选择需要修改的资料。');
  if (text.length > (key === 'limitations' ? 500 : 300))
    throw new Error('答案稍长，请缩短一下再保存。');
  return {
    [key]: key === 'limitations' && text === '跳过' ? '暂未提供' : text,
  };
}

export function setupSummary(f: FitnessProfile = {}) {
  return [
    {
      id: 'body',
      label: '身高 · 初始体重',
      value: `${f.height_cm || '—'} cm · ${f.weight_kg || '—'} kg`,
    },
    {
      id: 'sex',
      label: '性别',
      value: f.sex === 'male' ? '男' : f.sex === 'female' ? '女' : '暂未透露',
    },
    { id: 'goal', label: '目标', value: f.goal || '未填写' },
    {
      id: 'strength',
      label: '力量训练',
      value:
        f.strength_training === 'yes'
          ? '可以'
          : f.strength_training === 'no'
            ? '暂不接受'
            : '还不确定',
    },
    {
      id: 'availability',
      label: '运动时间',
      value: f.availability_text || '暂未确定',
    },
    {
      id: 'limitations',
      label: '身体限制 · 器械',
      value:
        [f.limitations, f.equipment].filter(Boolean).join(' · ') || '暂未提供',
    },
  ];
}

export function setupDraftPrompt() {
  return '我已核对并保存首次身体资料。请结合 profile.fitness 和最新身体记录制定可执行的每日饮水、能量、碳水、蛋白质和脂肪目标，以及按周重复的训练计划草案。尊重力量训练偏好、运动时间和身体限制。已有生效目标或计划时先评估，合适就沿用，不取消或覆盖。缺少选填信息用说明假设的保守起点，最多询问一个影响安排的关键问题。不重新询问我已填写的资料，不记录新的身体测量或饮食。只生成草案供我确认，不要确认任何目标或计划，简短解释理由。';
}
