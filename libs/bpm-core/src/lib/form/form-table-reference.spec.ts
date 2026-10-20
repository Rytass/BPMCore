import { referencesFormField } from './form-table-reference';

describe('referencesFormField', (): void => {
  it.each([
    ['form.x'],
    ['form . x'],
    ['form\n.\nx'],
    ['form["x"]'],
    ["form['x']"],
    ['form [ "x" ]'],
    ['formData.x'],
    ['formData["x"]'],
    ['form.x == "B2B"'],
    ['amount > 1 && form.x != ""'],
    ['has(form.x)'],
    ['size(form.x) > 0'],
    ['(form.x)'],
    ['form.x.y'],
    ['form.x[0]'],
  ])('finds the field in %j', (expression): void => {
    expect(referencesFormField(expression, 'x')).toBe(true);
  });

  it('finds a field key written in the bracket spelling with non-ASCII characters', (): void => {
    expect(referencesFormField('form["稅額"] > 0', '稅額')).toBe(true);
    expect(referencesFormField('formData["稅額"] > 0', '稅額')).toBe(true);
  });

  it.each([
    ['form.xy'],
    ['form.x_y'],
    ['form.x1'],
    ['form["xy"]'],
    ['myform.x'],
    ['xform.x'],
    ['formData2.x'],
    ['a.form.x'],
    ['a.formData.x'],
    ['form.y'],
    ['form'],
    ['form.'],
    ['initiator.x'],
    ['subject.x'],
    ['x'],
    [''],
  ])('does not find the field in %j', (expression): void => {
    expect(referencesFormField(expression, 'x')).toBe(false);
  });

  it('does not treat a key that merely starts with the other key as a hit, in either spelling', (): void => {
    expect(referencesFormField('form.invoiceKindNote == ""', 'invoiceKind')).toBe(
      false,
    );
    expect(
      referencesFormField('form["invoiceKindNote"] == ""', 'invoiceKind'),
    ).toBe(false);
    expect(referencesFormField('form.invoiceKind == ""', 'invoiceKind')).toBe(
      true,
    );
  });

  it('reads the key literally, not as a pattern', (): void => {
    expect(referencesFormField('form.axb', 'a.b')).toBe(false);
    expect(referencesFormField('form["a.b"]', 'a.b')).toBe(true);
    expect(referencesFormField('form.a', '.*')).toBe(false);
  });
});
