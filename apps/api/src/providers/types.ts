export interface ToolCall {
  name: string;
  arguments: any;
  call_id: string;
}
export interface ToolSpec {
  name: string;
  description: string;
  parameters: any;
}
export interface AgentModelInput {
  instructions: string;
  transcript: any[];
  tools: ToolSpec[];
}
export interface ProviderStep {
  assistant_text: string;
  tool_calls: ToolCall[];
  response_items?: any[];
}
export interface TextAgentProvider {
  next(input: AgentModelInput, signal: AbortSignal): Promise<ProviderStep>;
}
