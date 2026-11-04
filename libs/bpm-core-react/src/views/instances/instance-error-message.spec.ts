import { readErrorMessage } from './instance-error-message';

describe('readErrorMessage', () => {
  it('names a refused attachment in words instead of listing its id', () => {
    const message = readErrorMessage(
      new Error(
        'ATTACHMENT_NOT_BINDABLE: attachments 11111111-2222-4333-8444-555555555555 cannot be attached to this case: only files its applicant uploaded for it can be',
      ),
    );

    expect(message).toContain('附件無法附加到這個案件');
    expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it('passes any other server message through', () => {
    expect(
      readErrorMessage(new Error('Approval template is deactivated')),
    ).toBe('Approval template is deactivated');
  });
});
