import React from 'react';
import { expect, it, type Mock } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openmrsFetch } from '@openmrs/esm-framework';
import AiFeedback from './ai-feedback.component';

it('serializes the internal audit id as the feedback controller questionId through the real client', async () => {
  const fetch = openmrsFetch as Mock;
  fetch.mockResolvedValueOnce({ data: {} });
  render(<AiFeedback auditLogId={42} />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Helpful' }));
  expect(await screen.findByText('Thanks for your feedback')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith(
    '/ws/rest/v1/chartsearchai/feedback',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ questionId: '42', rating: 'positive' }),
    }),
  );
});
