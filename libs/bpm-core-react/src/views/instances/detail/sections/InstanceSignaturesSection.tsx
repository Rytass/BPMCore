'use client';

import { CSSProperties, ReactElement, useMemo } from 'react';
import { Table, Typography } from '@mezzanine-ui/react';
import type { TableColumn } from '@mezzanine-ui/core/table';
import {
  SignatureRecord,
  SignatureVerificationRecord,
} from '@rytass/bpm-core-client/workflow';
import { formatDateTime } from '../../../../lib/format-date-time';
import { SignatureRow, readShortHash } from './shared';

const SECTION_BODY_STYLE: CSSProperties = {
  display: 'grid',
  gap: 16,
};

export interface InstanceSignaturesSectionProps {
  /** The list of signatures for this instance. */
  readonly signatures: readonly SignatureRecord[];
  /** The signature chain verification result, or null if not yet loaded. */
  readonly signatureVerification: SignatureVerificationRecord | null;
}

/**
 * Renders the signatures section of the approval instance detail page.
 * Shows the signature chain verification status and a table of individual
 * signature records.
 */
export function InstanceSignaturesSection({
  signatureVerification,
  signatures,
}: InstanceSignaturesSectionProps): ReactElement {
  const signatureRows = useMemo(
    (): SignatureRow[] =>
      signatures.map((signature) => ({
        algorithm: signature.algorithm,
        hashLabel: readShortHash(signature.signedPayloadHash),
        key: signature.id,
        keyVersion: signature.keyVersion,
        signedAtLabel: formatDateTime(signature.signedAt),
        signerMemberId: signature.signerMemberId,
      })),
    [signatures],
  );

  const signatureColumns = useMemo(
    (): TableColumn<SignatureRow>[] => [
      {
        dataIndex: 'signerMemberId',
        key: 'signerMemberId',
        title: '簽章者',
        width: 160,
      },
      { dataIndex: 'algorithm', key: 'algorithm', title: '演算法', width: 150 },
      {
        dataIndex: 'keyVersion',
        key: 'keyVersion',
        title: 'Key 版本',
        width: 100,
      },
      {
        dataIndex: 'hashLabel',
        key: 'hashLabel',
        title: 'Payload Hash',
        width: 180,
      },
      {
        dataIndex: 'signedAtLabel',
        key: 'signedAtLabel',
        title: '簽章時間',
        width: 220,
      },
    ],
    [],
  );

  return (
    <div style={SECTION_BODY_STYLE}>
      <Typography component="h2" variant="h3">
        簽章
      </Typography>
      <Typography
        color={
          signatureVerification?.valid ? 'text-success' : 'text-error'
        }
        variant="body"
      >
        {signatureVerification
          ? signatureVerification.valid
            ? `簽章鏈已驗證，共 ${signatureVerification.checkedCount} 筆。`
            : `簽章鏈驗證失敗：${signatureVerification.errors.join('、')}`
          : '尚無簽章紀錄。'}
      </Typography>
      {signatureRows.length > 0 ? (
        <Table
          columns={signatureColumns}
          dataSource={signatureRows}
          fullWidth
        />
      ) : null}
    </div>
  );
}
