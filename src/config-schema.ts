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
    _description:
      'Whether to display answer tokens and reasoning incrementally. When false, the selected conversation provider delivers the completed answer without incremental output.',
  },
  showReasoning: {
    _type: Type.Boolean,
    _default: true,
    _description:
      "Whether the model's reasoning is shown at all: streamed live while the model thinks, then kept behind a collapsed disclosure above the answer. When false it is neither shown nor retained. With streaming disabled, any supplied reasoning is shown only after the complete answer arrives. A provider that emits no reasoning still delivers its answer.",
  },
  showModelPicker: {
    _type: Type.Boolean,
    _default: true,
    _description: 'Show the med-agent-hub product-profile picker in the chat panel footer.',
  },
  chatLaunchMode: {
    _type: Type.String,
    _default: 'both',
    _description: 'Controls how the AI chat panel is launched. One of: "floating", "workspace", "both"',
    _validators: [validators.oneOf(['floating', 'workspace', 'both'])],
  },
  queryResultsAnswer: {
    _description:
      "ChartSearch's section on the omnibar's Query results page, which answers a question the user just submitted there.",
    enabled: {
      _type: Type.Boolean,
      _default: true,
      _description:
        "Whether the section is shown. When false it renders nothing and never asks ChartSearch. The omnibar's hint still says Enter will ask ChartSearch while the extension is assigned, so removing chartsearch-query-results-view from omnibar-query-results-slot instead drops both the section and the hint.",
    },
  },
};

export interface ChartSearchAiConfig {
  showModelPicker: boolean;
  aiSearchPlaceholder: string;
  maxQuestionLength: number;
  useStreaming: boolean;
  showReasoning: boolean;
  chatLaunchMode: 'floating' | 'workspace' | 'both';
  queryResultsAnswer: { enabled: boolean };
}
