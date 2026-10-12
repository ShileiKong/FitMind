/** A mention or question about confirmation is not permission to activate a draft. */
export function explicitlyApproves(
  text: string,
  action: 'proposal' | 'recommendation',
): boolean {
  const actions = /确认|同意|接受|敲定|就按|加重/;
  const clauses = text
    .split(/[，。！；,;\n]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const negated =
    /(?:不(?:要|用|想|会|能|再|打算|准备)?|别|未|没(?:有)?|暂缓|取消|拒绝)[^，。！？；,;\n]{0,80}(?:确认|同意|接受|敲定|就按|加重)/;
  const delayed =
    /(?:晚点|稍后|以后|下次|过会|(?:明天|之后)再)[^，。！？；,;\n]{0,24}(?:确认|同意|接受|敲定)/;
  const postponed =
    /(?:确认|同意|接受|敲定|就按)[^，。！？；,;\n]{0,24}(?:先等(?:等|一下|一会)|等等|暂缓|稍后|晚点|以后再|明天再|待定|还要改|先不要|不急)/;
  const delayedLoad =
    /(?:晚点|稍后|以后|过会|(?:明天|之后)再)[^，。！？；,;\n]{0,24}加重/;
  const awaitingApproval =
    /(?:供|待|等|留给|交给)(?:我|用户|你)?确认|(?:确认|同意|接受)(?:后|以后|之后)才/;
  if (
    negated.test(text) ||
    delayed.test(text) ||
    postponed.test(text) ||
    delayedLoad.test(text) ||
    awaitingApproval.test(text)
  )
    return false;
  const affirmative =
    action === 'proposal'
      ? /确认|同意|接受|敲定|就按/
      : /确认|同意|接受|就按|(?:可以|请|我要|我想|决定|就|帮我)加重|^(?:下次|下一次)?加重(?:吧|到|$)/;
  return clauses.some(
    (clause) =>
      actions.test(clause) &&
      affirmative.test(clause) &&
      !/[?？]|吗|么|是否|要不要|能不能|可不可以|如何|怎么|何时|什么时候/.test(
        clause,
      ),
  );
}
