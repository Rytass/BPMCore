/**
 * Header line of the designer. A published template version is named
 * explicitly because the bound form's own version sits right below it, and a
 * reader seeing only "v1" there takes it for the template's version.
 */
export function readTemplateVersionDescription(input: {
  draftVersion: number | null;
  hasPublishedVersion: boolean;
  publishedVersion: number | null;
}): string {
  const draftPart =
    input.draftVersion === null
      ? '尚未建立草稿'
      : `草稿 v${input.draftVersion}`;
  const publishedPart =
    input.publishedVersion !== null
      ? `已發布 v${input.publishedVersion}`
      : input.hasPublishedVersion
        ? '已發布版本'
        : '尚未發布';

  return `${draftPart} · ${publishedPart}`;
}

/**
 * The designer header's description line: the version line plus the
 * definition's expression dialect. `ContentHeader` drops any child that is not
 * a button, filter or back link, so a dialect `Tag` there never rendered; its
 * `description` string is the slot it does show.
 */
export function readTemplateHeaderDescription(
  versionDescription: string,
  expressionDialect: string,
): string {
  return `${versionDescription} · 運算式方言 ${expressionDialect}`;
}

/** The bound form's version, labelled so it is not mistaken for the template's. */
export function readFormVersionLabel(
  formName: string,
  version: number,
): string {
  return `表單：${formName} v${version}`;
}
