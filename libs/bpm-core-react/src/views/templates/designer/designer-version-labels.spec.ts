import {
  readFormVersionLabel,
  readTemplateVersionDescription,
} from './designer-version-labels';

describe('readTemplateVersionDescription', () => {
  it('names the published template version when there is no draft', () => {
    expect(
      readTemplateVersionDescription({
        draftVersion: null,
        hasPublishedVersion: true,
        publishedVersion: 16,
      }),
    ).toBe('尚未建立草稿 · 已發布 v16');
  });

  it('shows draft and published versions together', () => {
    expect(
      readTemplateVersionDescription({
        draftVersion: 17,
        hasPublishedVersion: true,
        publishedVersion: 16,
      }),
    ).toBe('草稿 v17 · 已發布 v16');
  });

  it('keeps the generic wording when the published version cannot be found', () => {
    expect(
      readTemplateVersionDescription({
        draftVersion: null,
        hasPublishedVersion: true,
        publishedVersion: null,
      }),
    ).toBe('尚未建立草稿 · 已發布版本');
  });

  it('says so when nothing is published', () => {
    expect(
      readTemplateVersionDescription({
        draftVersion: 1,
        hasPublishedVersion: false,
        publishedVersion: null,
      }),
    ).toBe('草稿 v1 · 尚未發布');
  });
});

describe('readFormVersionLabel', () => {
  it('prefixes the form part', () => {
    expect(readFormVersionLabel('請款單', 1)).toBe('表單：請款單 v1');
  });
});
