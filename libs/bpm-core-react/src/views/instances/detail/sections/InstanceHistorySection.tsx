'use client';

import {
  CSSProperties,
  Fragment,
  ReactElement,
  RefCallback,
  forwardRef,
} from 'react';
import { Stepper, Tooltip, Typography, type StepProps } from '@mezzanine-ui/react';
import { stepClasses } from '@mezzanine-ui/core/stepper';
import {
  ActivityLogRecord,
  ApprovalInstanceRecord,
  MemberProfileRecord,
  SignatureRecord,
  SignatureVerificationRecord,
  TaskDecisionRecord,
  TaskRecord,
  WorkflowTokenRecord,
} from '@rytass/bpm-core-client/workflow';
import { WorkflowDefinition } from '@rytass/bpm-core-shared/workflow';
import {
  ActivityStepDescriptionPart,
  ActivityStepRecord,
  isActivityDescriptionPart,
  isPresentText,
  readActivityStepRecords,
  readCurrentActivityStep,
} from './shared';

const SECTION_BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

const HISTORY_MEMBER_NAME_STYLE: CSSProperties = {
  cursor: 'help',
  textDecoration: 'underline dotted',
  textUnderlineOffset: 3,
};

const HISTORY_DANGER_TEXT_STYLE: CSSProperties = {
  color: 'var(--mzn-color-text-error)',
};

function joinClassNames(
  ...classNames: readonly (string | null | undefined)[]
): string {
  return classNames
    .filter((className): className is string =>
      isPresentText(className ?? null),
    )
    .join(' ');
}

interface ActivityHistoryStepProps extends StepProps {
  readonly descriptionParts: readonly ActivityStepDescriptionPart[];
  readonly forcePending?: boolean;
}

const ActivityHistoryStep = forwardRef<
  HTMLDivElement,
  ActivityHistoryStepProps
>(function ActivityHistoryStep(
  {
    className,
    descriptionParts,
    error,
    forcePending = false,
    index = 0,
    orientation,
    status = 'pending',
    title,
    type = 'number',
    ...rest
  },
  ref,
): ReactElement {
  const displayStatus = forcePending ? 'pending' : status;

  return (
    <div
      {...rest}
      className={joinClassNames(
        stepClasses.host,
        type === 'dot' ? stepClasses.dot : null,
        error && displayStatus !== 'processing' ? stepClasses.error : null,
        orientation === 'horizontal' ? stepClasses.horizontal : null,
        type === 'number' ? stepClasses.number : null,
        displayStatus === 'pending' ? stepClasses.pending : null,
        displayStatus === 'processing' ? stepClasses.processing : null,
        error && displayStatus === 'processing'
          ? stepClasses.processingError
          : null,
        !error && displayStatus === 'succeeded' ? stepClasses.succeeded : null,
        orientation === 'vertical' ? stepClasses.vertical : null,
        className,
      )}
      ref={ref}
    >
      {type === 'dot' ? (
        <span
          className={joinClassNames(
            stepClasses.statusIndicator,
            stepClasses.statusIndicatorDot,
          )}
        />
      ) : (
        <span className={stepClasses.statusIndicator}>{index + 1}</span>
      )}
      <div className={stepClasses.textContainer}>
        <Typography
          className={stepClasses.title}
          variant="label-primary-highlight"
        >
          {title}
          <span className={stepClasses.titleConnectLine} />
        </Typography>
        {descriptionParts.length > 0 ? (
          <Typography className={stepClasses.description} variant="caption">
            {descriptionParts.map((part, partIndex) => (
              <Fragment key={`${part.type}-${partIndex}`}>
                {partIndex > 0 ? ' · ' : null}
                {renderActivityDescriptionPart(part)}
              </Fragment>
            ))}
          </Typography>
        ) : null}
      </div>
    </div>
  );
});

function renderActivityDescriptionPart(
  part: ActivityStepDescriptionPart,
): ReactElement | string {
  if (part.type === 'text') {
    return part.text;
  }

  if (part.type === 'dangerText') {
    return <span style={HISTORY_DANGER_TEXT_STYLE}>{part.text}</span>;
  }

  if (!part.email) {
    return `${part.prefix}：${part.label}`;
  }

  return (
    <>
      {part.prefix}：
      <Tooltip title={part.email}>
        {({ onMouseEnter, onMouseLeave, ref }): ReactElement => (
          <span
            data-testid={
              part.memberId ? `member-tooltip-${part.memberId}` : undefined
            }
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            ref={ref as RefCallback<HTMLSpanElement>}
            style={HISTORY_MEMBER_NAME_STYLE}
          >
            {part.label}
          </span>
        )}
      </Tooltip>
    </>
  );
}

export interface InstanceHistorySectionProps {
  /** Activity log records for this instance. */
  readonly activityLogs: readonly ActivityLogRecord[];
  /** All tasks for this instance (used to compute pending/future steps). */
  readonly tasks: readonly TaskRecord[];
  /** All workflow tokens for this instance. */
  readonly workflowTokens: readonly WorkflowTokenRecord[];
  /** The workflow definition snapshot, or null if not yet loaded. */
  readonly workflowSnapshot: WorkflowDefinition | null;
  /** The current state of the instance. */
  readonly instanceState: ApprovalInstanceRecord['state'];
  /** Member profiles indexed by memberId. */
  readonly memberProfilesById: ReadonlyMap<string, MemberProfileRecord>;
  /** Task decisions indexed by taskId (latest per task). */
  readonly taskDecisionsByTaskId: ReadonlyMap<string, TaskDecisionRecord>;
  /** Signatures indexed by id. */
  readonly signaturesById: ReadonlyMap<string, SignatureRecord>;
  /** Signature chain verification result, or null. */
  readonly signatureVerification: SignatureVerificationRecord | null;
}

/**
 * Renders the activity history section of the approval instance detail page.
 * Computes the step records from the provided data and renders them as a
 * vertical dot stepper.
 */
export function InstanceHistorySection({
  activityLogs,
  instanceState,
  memberProfilesById,
  signatureVerification,
  signaturesById,
  taskDecisionsByTaskId,
  tasks,
  workflowSnapshot,
  workflowTokens,
}: InstanceHistorySectionProps): ReactElement {
  const activitySteps: readonly ActivityStepRecord[] = readActivityStepRecords(
    activityLogs,
    tasks,
    workflowTokens,
    workflowSnapshot,
    instanceState,
    memberProfilesById,
    taskDecisionsByTaskId,
    signaturesById,
    signatureVerification,
  );

  const currentActivityStep = readCurrentActivityStep(activitySteps);

  const filteredDescriptionParts = activitySteps.map((step) => ({
    ...step,
    descriptionParts: step.descriptionParts.filter(isActivityDescriptionPart),
  }));

  return (
    <div style={SECTION_BODY_STYLE}>
      <Typography component="h2" variant="h3">
        歷程
      </Typography>
      {filteredDescriptionParts.length > 0 ? (
        <Stepper
          currentStep={currentActivityStep}
          orientation="vertical"
          type="dot"
        >
          {filteredDescriptionParts.map((activityStep) => (
            <ActivityHistoryStep
              descriptionParts={activityStep.descriptionParts}
              error={activityStep.error}
              forcePending={activityStep.forcePending}
              key={activityStep.id}
              title={activityStep.title}
            />
          ))}
        </Stepper>
      ) : (
        <Typography color="text-neutral" variant="body">
          尚無歷程紀錄。
        </Typography>
      )}
    </div>
  );
}
