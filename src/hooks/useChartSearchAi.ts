import { useCallback, useRef, useState } from 'react';
import { useConfig } from '@openmrs/esm-framework';
import { type AiReference, type AiSearchResponse, searchPatientChart, searchPatientChartStream } from '../api/chartsearchai';
import { type ChartSearchAiConfig } from '../config-schema';

export interface UseChartSearchAiReturn {
  answer: string;
  disclaimer: string;
  references: AiReference[];
  isLoading: boolean;
  error: string | null;
  submitQuestion: (patientUuid: string, question: string) => void;
  clearResults: () => void;
}

export function useChartSearchAi(): UseChartSearchAiReturn {
  const config = useConfig<ChartSearchAiConfig>();
  const [answer, setAnswer] = useState('');
  const [disclaimer, setDisclaimer] = useState('');
  const [references, setReferences] = useState<AiReference[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const clearResults = useCallback(() => {
    setAnswer('');
    setDisclaimer('');
    setReferences([]);
    setError(null);
    setIsLoading(false);
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const submitQuestion = useCallback(
    (patientUuid: string, question: string) => {
      // Abort any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setAnswer('');
      setDisclaimer('');
      setReferences([]);
      setError(null);
      setIsLoading(true);

      if (config.useStreaming) {
        searchPatientChartStream(
          patientUuid,
          question,
          {
            onToken: (token) => {
              setAnswer((prev) => prev + token);
            },
            onDone: (response: AiSearchResponse) => {
              setAnswer(response.answer);
              setDisclaimer(response.disclaimer);
              setReferences(response.references);
              setIsLoading(false);
            },
            onError: (errMessage) => {
              setError(errMessage);
              setIsLoading(false);
            },
          },
          abortController,
        );
      } else {
        searchPatientChart(patientUuid, question, abortController)
          .then((response) => {
            setAnswer(response.answer);
            setDisclaimer(response.disclaimer);
            setReferences(response.references);
            setIsLoading(false);
          })
          .catch((err) => {
            if (err.name !== 'AbortError') {
              setError(err?.responseBody?.error ?? err?.message ?? 'An unknown error occurred');
              setIsLoading(false);
            }
          });
      }
    },
    [config.useStreaming],
  );

  return {
    answer,
    disclaimer,
    references,
    isLoading,
    error,
    submitQuestion,
    clearResults,
  };
}
