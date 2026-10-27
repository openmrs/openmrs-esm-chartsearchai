import { Type, validators } from '@openmrs/esm-framework';

export const configSchema = {
  aiSearchPlaceholder: {
    _type: Type.String,
    _default: 'Ask AI about this patient...',
    _description: 'Placeholder text for the AI search input',
  },
  maxQuestionLength: {
    _type: Type.Number,
    _default: 1000,
    _description: 'Maximum number of characters allowed in a question',
  },
  useStreaming: {
    _type: Type.Boolean,
    _default: true,
    _description: 'Whether to use the streaming SSE endpoint for AI responses',
  },
  showReasoning: {
    _type: Type.Boolean,
    _default: true,
    _description:
      "Whether the model's reasoning is shown at all: streamed live while the model thinks, then kept behind a collapsed disclosure under the answer. When false it is neither shown nor retained. Only the streaming endpoint emits reasoning, so this has no effect when useStreaming is false.",
  },
  chatLaunchMode: {
    _type: Type.String,
    _default: 'both',
    _description: 'Controls how the AI chat panel is launched. One of: "floating", "workspace", "both"',
    _validators: [validators.oneOf(['floating', 'workspace', 'both'])],
  },
};

export interface ChartSearchAiConfig {
  aiSearchPlaceholder: string;
  maxQuestionLength: number;
  useStreaming: boolean;
  showReasoning: boolean;
  chatLaunchMode: 'floating' | 'workspace' | 'both';
}
