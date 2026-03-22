import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { InlineLoading } from '@carbon/react';
import { navigate } from '@openmrs/esm-framework';
import { type AiReference } from '../api/chartsearchai';
import styles from './ai-response-panel.scss';

interface AiResponsePanelProps {
  answer: string;
  disclaimer: string;
  references: AiReference[];
  error: string | null;
  isLoading: boolean;
  patientUuid: string;
}

const RESOURCE_TYPE_TO_CHART_PAGE: Record<string, string> = {
  Obs: 'Results',
  Order: 'Orders',
  DrugOrder: 'Orders',
  TestOrder: 'Orders',
  Allergy: 'Allergies',
  Condition: 'Conditions',
  Diagnosis: 'Visits',
  PatientProgram: 'Programs',
  MedicationDispense: 'Orders',
};

function buildReferenceUrl(ref: AiReference, patientUuid: string): string | null {
  if (!patientUuid) {
    return null;
  }
  const chartPage = RESOURCE_TYPE_TO_CHART_PAGE[ref.resourceType];
  return `${window.spaBase}/patient/${patientUuid}/chart/${chartPage ?? 'Patient Summary'}`;
}

function renderAnswerWithCitations(answer: string, references: AiReference[], patientUuid: string): React.ReactNode[] {
  const refByIndex = new Map(references.map((r) => [r.index, r]));
  const parts: React.ReactNode[] = [];
  const pattern = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(answer)) !== null) {
    if (match.index > lastIndex) {
      parts.push(answer.slice(lastIndex, match.index));
    }
    const citIndex = parseInt(match[1], 10);
    const ref = refByIndex.get(citIndex);
    const url = ref ? buildReferenceUrl(ref, patientUuid) : null;
    if (url) {
      parts.push(
        <a
          key={`cit-${match.index}`}
          className={styles.inlineCitation}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            navigate({ to: url });
          }}
        >
          {match[0]}
        </a>,
      );
    } else {
      parts.push(match[0]);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < answer.length) {
    parts.push(answer.slice(lastIndex));
  }
  return parts;
}

const AiResponsePanel: React.FC<AiResponsePanelProps> = ({
  answer,
  disclaimer,
  references,
  error,
  isLoading,
  patientUuid,
}) => {
  const { t } = useTranslation();
  const renderedAnswer = useMemo(
    () => (answer ? renderAnswerWithCitations(answer, references, patientUuid) : null),
    [answer, references, patientUuid],
  );

  if (error && !answer) {
    return (
      <div className={styles.errorContainer}>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  return (
    <div className={styles.responseContainer}>
      {answer && (
        <div className={styles.answerSection}>
          <p className={styles.answerText}>{renderedAnswer}</p>
          {isLoading && <InlineLoading className={styles.streamingIndicator} />}
        </div>
      )}

      {error && answer && (
        <div className={styles.errorContainer}>
          <p className={styles.errorText}>
            {t('streamInterrupted', 'Response interrupted:')} {error}
          </p>
        </div>
      )}

      {disclaimer && (
        <div className={styles.disclaimerSection}>
          <p className={styles.disclaimerText}>{disclaimer}</p>
        </div>
      )}

      {references.length > 0 && (
        <div className={styles.referencesSection}>
          <span className={styles.referencesLabel}>{t('references', 'References')}:</span>
          <div className={styles.referencesList}>
            {references.map((ref) => {
              const url = buildReferenceUrl(ref, patientUuid);
              const label = `[${ref.index}] ${ref.resourceType} — ${ref.date}`;
              return url ? (
                <a
                  key={ref.index}
                  className={styles.referenceTag}
                  href={url}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate({ to: url });
                  }}
                >
                  {label}
                </a>
              ) : (
                <span key={ref.index} className={styles.referenceTagInert}>
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default AiResponsePanel;
