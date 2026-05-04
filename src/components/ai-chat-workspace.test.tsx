import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AiChatWorkspace from './ai-chat-workspace.component';

jest.mock('./ai-chat-content.component', () => ({
  __esModule: true,
  default: ({ mode, patientUuid }: { mode: string; patientUuid: string }) => (
    <div data-testid="ai-chat-content" data-mode={mode} data-patient-uuid={patientUuid} />
  ),
}));

jest.mock('@openmrs/esm-framework', () => ({
  ...jest.requireActual('@openmrs/esm-framework'),
  Workspace2: jest.fn(({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="workspace2" data-title={title}>
      {children}
    </div>
  )),
}));

const baseProps = {
  groupProps: {
    patientUuid: 'test-patient-uuid',
    patient: {} as fhir.Patient,
    visitContext: undefined,
    mutateVisitContext: jest.fn(),
  },
};

describe('AiChatWorkspace', () => {
  it('renders Workspace2 with the correct title', () => {
    render(<AiChatWorkspace {...baseProps} />);
    expect(screen.getByTestId('workspace2')).toHaveAttribute('data-title', 'AI Chart Search');
  });

  it('renders AiChatContent with mode="workspace"', () => {
    render(<AiChatWorkspace {...baseProps} />);
    expect(screen.getByTestId('ai-chat-content')).toHaveAttribute('data-mode', 'workspace');
  });

  it('passes patientUuid from groupProps to AiChatContent', () => {
    render(<AiChatWorkspace {...baseProps} />);
    expect(screen.getByTestId('ai-chat-content')).toHaveAttribute('data-patient-uuid', 'test-patient-uuid');
  });
});
