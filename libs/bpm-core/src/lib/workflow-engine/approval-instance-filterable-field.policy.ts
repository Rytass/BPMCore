import {
  type FilterableFieldPath,
  readFilterableFieldPaths,
} from '@rytass/bpm-core-shared';
import type { FormDefinitionSchema } from '@rytass/bpm-core-shared/form';
import type { BPMAuthContext } from '../bpm-auth';

/**
 * Which form fields a viewer may filter and sort the approval-instance list
 * by (ADR 25 §8.2). Internal: not exported from the library's public index.
 *
 * v1 answers with every field the template's current version marks
 * filterable, which is what the query did before this seam existed. Server-side
 * field masking (a field a viewer may not see must not be a filter either)
 * would replace this class; the query and the public API would not change.
 */
export class ApprovalInstanceFilterableFieldPolicy {
  readFilterableFieldPaths(
    _scope: BPMAuthContext | undefined,
    schema: FormDefinitionSchema | null | undefined,
  ): readonly FilterableFieldPath[] {
    return readFilterableFieldPaths(schema);
  }
}
