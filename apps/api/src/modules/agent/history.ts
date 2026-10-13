interface HistoricalTurn {
  text: string;
  result: { assistant_text: string; summary?: { local_date: string } | null };
  created_at?: string;
  reference_local_date?: string;
  timezone?: string;
}

/** Relative words in a prior turn belong to that turn, never to the new day. */
export function datedHistory(messages: HistoricalTurn[]) {
  return messages.flatMap((message) => {
    const date =
      message.reference_local_date ??
      message.result.summary?.local_date ??
      '未知（不得归入今天）';
    const prefix = `【历史对话｜发送时间 ${message.created_at ?? '未知'}｜相对日期基准 ${date}｜时区 ${message.timezone ?? '未知'}】\n`;
    return [
      { role: 'user', content: prefix + message.text },
      { role: 'assistant', content: prefix + message.result.assistant_text },
    ];
  });
}
