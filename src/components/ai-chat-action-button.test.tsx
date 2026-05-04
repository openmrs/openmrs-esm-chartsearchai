import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionMenuButton2, useConfig, userHasAccess } from '@openmrs/esm-framework';
import AiChatActionButton from './ai-chat-action-button.component';

jest.mock('@openmrs/esm-framework', () => {
  const actual = jest.requireActual('@openmrs/esm-framework');
  return {
    ...actual,
    useSession: jest.fn(() => ({ user: { uuid: 'user-uuid', privileges: [{ name: 'AI Query Patient Data' }] } })),
    userHasAccess: jest.fn(() => true),
  };
});

const mockUseConfig = useConfig as jest.Mock;
const mockActionMenuButton2 = ActionMenuButton2 as jest.Mock;
const mockUserHasAccess = userHasAccess as jest.Mock;

describe('AiChatActionButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseConfig.mockReturnValue({ chatLaunchMode: 'workspace' });
  });

  it('renders nothing when chatLaunchMode is "floating"', () => {
    mockUseConfig.mockReturnValue({ chatLaunchMode: 'floating' });
    const { container } = render(<AiChatActionButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the user lacks the AI Query Patient Data privilege', () => {
    mockUserHasAccess.mockReturnValueOnce(false);
    const { container } = render(<AiChatActionButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the action menu button when chatLaunchMode is "workspace"', () => {
    render(<AiChatActionButton />);
    expect(screen.getByText('Ask AI')).toBeInTheDocument();
  });

  it('renders the action menu button when chatLaunchMode is "both"', () => {
    mockUseConfig.mockReturnValue({ chatLaunchMode: 'both' });
    render(<AiChatActionButton />);
    expect(screen.getByText('Ask AI')).toBeInTheDocument();
  });

  it('passes the correct workspaceName to ActionMenuButton2', () => {
    render(<AiChatActionButton />);
    expect(mockActionMenuButton2).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceToLaunch: { workspaceName: 'ai-chat-workspace' },
      }),
      expect.anything(),
    );
  });
});
