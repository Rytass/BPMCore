export interface FormFieldLink {
  /** Absolute links open in a new tab; site-relative ones stay in this tab. */
  readonly external: boolean;
  readonly href: string;
}

const UNICODE_WHITESPACE_PATTERN = /\s/u;

// Whitespace and control characters are refused anywhere in the value: URL
// parsers silently drop tabs and newlines, so "/\t/evil.example" would turn
// into the protocol-relative "//evil.example" after our `//` check passed.
function hasUnsafeCharacter(value: string): boolean {
  return [...value].some((character): boolean => {
    const codePoint = character.codePointAt(0) ?? 0;

    return (
      // C0 controls and the space, DEL, C1 controls and the no-break space.
      codePoint <= 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0xa0) ||
      UNICODE_WHITESPACE_PATTERN.test(character)
    );
  });
}

const ABSOLUTE_HTTP_PATTERN = /^https?:\/\//iu;

/**
 * Decides whether a `displayAs: 'link'` text value may become an anchor.
 * Returns `null` for everything that must stay plain text.
 *
 * Allowed: a site-relative path (`/` first, never `//`) or an absolute
 * `http(s)://` URL with a host and no embedded credentials. Everything else —
 * `javascript:`, `data:`, protocol-relative `//host`, backslash tricks
 * (`/\host` is `//host` to a browser), padded or multi-line values, non-strings
 * — is refused rather than repaired.
 */
export function resolveFormFieldLink(value: unknown): FormFieldLink | null {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    hasUnsafeCharacter(value)
  ) {
    return null;
  }

  if (value.startsWith('/')) {
    return value.startsWith('//') ? null : { external: false, href: value };
  }

  return ABSOLUTE_HTTP_PATTERN.test(value) && isSafeAbsoluteHttpUrl(value)
    ? { external: true, href: value }
    : null;
}

function isSafeAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
