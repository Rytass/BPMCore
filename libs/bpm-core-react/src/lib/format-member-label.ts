/**
 * How the e-mail is attached to the name: `ascii` is `name (email)`,
 * `fullwidth` is `name（email）` and `dot` is `name · email`. Each call site
 * keeps the separator it always had.
 */
export type MemberLabelStyle = 'ascii' | 'dot' | 'fullwidth';

/**
 * `name` followed by the e-mail in the given style. A host may resolve a member
 * with `email: ''` (or a blank string), and then the label is just the name —
 * never `name ()` or `name · `.
 */
export function formatMemberLabel(
  name: string,
  email: string | null | undefined,
  style: MemberLabelStyle = 'ascii',
): string {
  if (!email?.trim()) {
    return name;
  }

  switch (style) {
    case 'fullwidth':
      return `${name}（${email}）`;
    case 'dot':
      return `${name} · ${email}`;
    case 'ascii':
      return `${name} (${email})`;
  }
}
