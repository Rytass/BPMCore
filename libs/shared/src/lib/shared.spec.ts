import { WorkflowDefinition } from './workflow';

describe('shared', () => {
  it('exports workflow definition types', () => {
    const workflow: WorkflowDefinition = {
      edges: [],
      meta: { schemaVersion: 1 },
      nodes: [],
    };

    expect(workflow.meta.schemaVersion).toBe(1);
  });
});
