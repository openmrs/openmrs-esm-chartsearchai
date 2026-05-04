import { Type } from '@openmrs/esm-framework';

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
  chatLaunchMode: {
    _type: Type.String,
    _default: 'floating',
    _description: 'Controls how the AI chat panel is launched. One of: "floating", "workspace", "both"',
  },
};

export interface ChartSearchAiConfig {
  aiSearchPlaceholder: string;
  maxQuestionLength: number;
  useStreaming: boolean;
  chatLaunchMode: 'floating' | 'workspace' | 'both';
}
