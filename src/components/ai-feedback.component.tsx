import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ThumbsUp, ThumbsDown } from '@carbon/react/icons';
import { type FeedbackRating, submitFeedback } from '../api/chartsearchai';
import styles from './ai-feedback.scss';

interface AiFeedbackProps {
  questionId: string;
  patientUuid: string;
}

const AiFeedback: React.FC<AiFeedbackProps> = ({ questionId, patientUuid }) => {
  const { t } = useTranslation();
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRate = useCallback(
    async (selectedRating: FeedbackRating) => {
      setRating(selectedRating);

      if (selectedRating === 'positive') {
        setSubmitted(true);
        try {
          await submitFeedback({ questionId, patient: patientUuid, rating: selectedRating });
        } catch {
          // Silently fail — feedback is non-critical
        }
      }
    },
    [questionId, patientUuid],
  );

  const handleCommentSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await submitFeedback({
        questionId,
        patient: patientUuid,
        rating: 'negative',
        comment: comment.trim() || undefined,
      });
    } catch {
      // Silently fail
    }
    setIsSubmitting(false);
    setSubmitted(true);
  }, [questionId, patientUuid, comment]);

  const handleCommentKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleCommentSubmit();
      }
    },
    [handleCommentSubmit],
  );

  if (submitted) {
    return (
      <div className={styles.feedbackContainer}>
        <span className={styles.thanksText}>{t('feedbackThanks', 'Thanks for your feedback')}</span>
      </div>
    );
  }

  return (
    <div className={styles.feedbackContainer}>
      {!rating && (
        <div className={styles.ratingRow}>
          <span className={styles.promptText}>{t('wasThisHelpful', 'Was this helpful?')}</span>
          <button
            className={styles.ratingButton}
            onClick={() => handleRate('positive')}
            aria-label={t('helpful', 'Helpful')}
            type="button"
            disabled={isSubmitting}
          >
            <ThumbsUp size={16} />
          </button>
          <button
            className={styles.ratingButton}
            onClick={() => handleRate('negative')}
            aria-label={t('notHelpful', 'Not helpful')}
            type="button"
            disabled={isSubmitting}
          >
            <ThumbsDown size={16} />
          </button>
        </div>
      )}

      {rating === 'negative' && (
        <div className={styles.commentSection}>
          <textarea
            className={styles.commentInput}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={handleCommentKeyDown}
            placeholder={t('feedbackPlaceholder', 'What was wrong? (optional)')}
            rows={2}
            maxLength={500}
            disabled={isSubmitting}
            autoFocus
          />
          <button className={styles.submitButton} onClick={handleCommentSubmit} type="button" disabled={isSubmitting}>
            {t('submitFeedback', 'Submit')}
          </button>
        </div>
      )}
    </div>
  );
};

export default AiFeedback;
