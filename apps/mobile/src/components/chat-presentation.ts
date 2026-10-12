import { visibleAssistantText } from '@fitmind/contracts/assistant-text';

export function replyPreview(raw: string) {
  const full = visibleAssistantText(raw);
  const chars = Array.from(full);
  if (chars.length <= 200 && full.split('\n').length <= 6)
    return { full, preview: full, hasDetails: false };
  const firstParagraph = full.split(/\n\s*\n/)[0];
  let preview = Array.from(firstParagraph).slice(0, 200).join('');
  const lastBoundary = Math.max(
    preview.lastIndexOf('。'),
    preview.lastIndexOf('！'),
    preview.lastIndexOf('？'),
    preview.lastIndexOf('\n'),
  );
  if (lastBoundary >= 80) preview = preview.slice(0, lastBoundary + 1);
  return { full, preview: preview.trimEnd() + '…', hasDetails: true };
}

export function agentErrorText(error: { code: string; message: string }) {
  const messages: Record<string, string> = {
    AMBIGUOUS_PROPOSAL: '有多个草案，请打开要确认的草案，核对后点击确认。',
    PROPOSAL_MISMATCH: '草案确认遇到问题，请打开草案，核对后点击确认。',
    MEMORY_SOURCE_REQUIRED: '长期偏好保存遇到问题，请到「长期记忆」检查结果。',
    MODEL_TIMEOUT: '回复超时了，请查看已保存的结果，或点击下方按钮继续。',
    MODEL_HTTP_ERROR:
      'AI 暂时无法连接，请稍后继续；已保存的结果可在记录中查看。',
    MODEL_FORMAT: 'AI 回复遇到问题，请稍后继续；已保存的结果可在记录中查看。',
    TOOL_LIMIT: '这条消息还没处理完，请核对已保存的结果，再继续说明剩余事项。',
    INVALID_TOOL_ARGUMENTS: '这次操作没有完成，请补充具体的日期、数量或对象。',
  };
  return messages[error.code] ?? error.message;
}

export function receiptText(receipt: any) {
  const r = receipt.entity ?? receipt;
  const status = r.undone_at ? '已撤销' : '已保存';
  let detail = '更正记录';
  if (r.kind === 'water') detail = `${r.amount_ml} 毫升水`;
  else if (r.kind === 'body') {
    const metric: Record<string, [string, string]> = {
      weight_kg: ['体重', '公斤'],
      body_fat_percent: ['体脂率', '%'],
      waist_cm: ['腰围', '厘米'],
      chest_cm: ['胸围', '厘米'],
      hip_cm: ['臀围', '厘米'],
      arm_cm: ['臂围', '厘米'],
    };
    const [name, unit] = metric[r.metric] ?? ['身体数据', ''];
    detail = `${name} ${r.value} ${unit}`.trimEnd();
  } else if (r.kind === 'food') {
    const calories = r.nutrition?.calories_kcal;
    detail = `${r.name} · ${calories == null ? '热量待补充' : `${calories} 千卡`}${r.source === 'estimate' ? '（估算）' : ''}`;
  } else if (r.reps != null) {
    detail = `${r.weight_kg == null ? '重量未填写' : `${r.weight_kg} 公斤`} × ${r.reps} 次`;
  }
  return `${status} · ${detail}${r.local_date ? ` · ${r.local_date}` : ''}`;
}

export function proposalPreview(p: any) {
  if (p.type === 'target')
    return `${p.calories_kcal == null ? '热量待设定' : `${p.calories_kcal} 千卡 / 天`} · ${p.effective_from} 起，确认后生效`;
  const dates: string[] = (p.days ?? []).map((d: any) => d.local_date).sort();
  return `${dates.length} 个训练日${dates.length ? ` · ${dates[0]} 至 ${dates.at(-1)}` : ''} · 确认后生效`;
}
