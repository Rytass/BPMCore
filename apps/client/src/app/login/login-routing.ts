export function sanitizeLoginNextPath(next: string | null): string {
  if (!next?.startsWith('/')) {
    return '/';
  }

  if (
    next.startsWith('//') ||
    next.includes('\\') ||
    decodeURIComponentSafe(next).includes('\\')
  ) {
    return '/';
  }

  return next;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
