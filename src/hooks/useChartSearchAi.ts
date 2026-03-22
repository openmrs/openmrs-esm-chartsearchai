import { useCallback, useEffect, useRef, useState } from 'react';
import { useConfig } from '@openmrs/esm-framework';
import {
  type AiReference,
  type AiSearchResponse,
  searchPatientChart,
  searchPatientChartStream,
} from '../api/chartsearchai';
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
      // Guard against rapid duplicate submissions (ref is synchronous,
      // unlike the isLoading state which only updates on next render)
      if (abortControllerRef.current) {
        return;
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setAnswer('');
      setDisclaimer('');
      setReferences([]);
      setError(null);
      setIsLoading(true);

      try {
        if (config.useStreaming) {
          searchPatientChartStream(
            patientUuid,
            question,
            {
              onToken: (token) => {
                setAnswer((prev) => prev + token);
              },
              onDone: (response: AiSearchResponse) => {
                abortControllerRef.current = null;
                setAnswer(response.answer);
                setDisclaimer(response.disclaimer);
                setReferences(response.references);
                setIsLoading(false);
              },
              onError: (errMessage) => {
                abortControllerRef.current = null;
                setError(errMessage);
                setIsLoading(false);
              },
            },
            abortController,
          );
        } else {
          searchPatientChart(patientUuid, question, abortController)
            .then((response) => {
              abortControllerRef.current = null;
              setAnswer(response.answer);
              setDisclaimer(response.disclaimer);
              setReferences(response.references);
              setIsLoading(false);
            })
            .catch((err) => {
              if (err.name !== 'AbortError') {
                abortControllerRef.current = null;
                setError(err?.responseBody?.error ?? err?.message ?? 'An unknown error occurred');
                setIsLoading(false);
              }
            });
        }
      } catch (err) {
        abortControllerRef.current = null;
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
        setIsLoading(false);
      }
    },
    [config.useStreaming],
  );

  // Abort any in-flight request when the component unmounts
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

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
