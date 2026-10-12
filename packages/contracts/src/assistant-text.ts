// Providers may embed reasoning in content instead of a separate reasoning field.
// Keep their original response items for continuation; filter only visible text.
export function visibleAssistantText(text: string): string {
  return text.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi, '').trim();
}
