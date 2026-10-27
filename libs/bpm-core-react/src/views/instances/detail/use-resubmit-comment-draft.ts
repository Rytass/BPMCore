'use client';

import { useCallback, useState } from 'react';

export interface ResubmitCommentDraft {
  /** The applicant's unsent resubmission comment for the current case. */
  readonly comment: string;
  readonly setComment: (value: string) => void;
  /**
   * Clears the draft after `submittedInstanceId` was resubmitted, unless the
   * page has since moved to another case whose draft must stay.
   */
  readonly clearAfterResubmit: (submittedInstanceId: string) => void;
}

interface DraftState {
  readonly instanceId: string;
  readonly text: string;
}

/**
 * The resubmission comment draft of the case at `instanceId`. One draft is
 * kept, stored with the case it was written for and read back only for that
 * case: another case shows empty from its very first render, a refresh of the
 * same case (an upload, a decision elsewhere) keeps it, and coming back to the
 * case shows it again unless the applicant has typed on another case since.
 */
export function useResubmitCommentDraft(
  instanceId: string,
): ResubmitCommentDraft {
  const [draft, setDraft] = useState<DraftState>({ instanceId, text: '' });

  const setComment = useCallback(
    (value: string): void => setDraft({ instanceId, text: value }),
    [instanceId],
  );
  const clearAfterResubmit = useCallback(
    (submittedInstanceId: string): void =>
      setDraft((previous): DraftState =>
        previous.instanceId === submittedInstanceId
          ? { instanceId: submittedInstanceId, text: '' }
          : previous,
      ),
    [],
  );

  return {
    clearAfterResubmit,
    comment: draft.instanceId === instanceId ? draft.text : '',
    setComment,
  };
}
