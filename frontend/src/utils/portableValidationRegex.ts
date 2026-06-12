export type PortableValidationRegexError = 'unsupported' | 'invalid';

export type PortableValidationRegexResult =
  | { ok: true; regex: RegExp }
  | { ok: false; error: PortableValidationRegexError };

function findUnsupportedPatternSyntax(pattern: string): PortableValidationRegexError | null {
  let inClass = false;
  let escaped = false;

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (escaped) {
      if (char >= '1' && char <= '9') return 'unsupported';
      if (char === 'k') return 'unsupported';
      if ((char === 'p' || char === 'P') && pattern[index + 1] === '{') return 'unsupported';
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '[') {
      if (pattern[index + 1] === ':' || pattern.slice(index, index + 3) === '[[:') {
        return 'unsupported';
      }
      inClass = true;
      continue;
    }

    if (char === ']' && inClass) {
      inClass = false;
      continue;
    }

    if (!inClass && char === '(' && pattern[index + 1] === '?' && pattern[index + 2] !== ':') {
      return 'unsupported';
    }
  }

  return null;
}

export function compilePortableValidationRegex(pattern: string): PortableValidationRegexResult {
  const unsupported = findUnsupportedPatternSyntax(pattern);
  if (unsupported) {
    return { ok: false, error: unsupported };
  }

  try {
    return { ok: true, regex: new RegExp(`^(?:${pattern})$`) };
  } catch {
    return { ok: false, error: 'invalid' };
  }
}
