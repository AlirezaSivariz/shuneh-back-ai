import { sanitizeRichHtml } from '../src/utils/sanitizeHtml';

describe('sanitizeRichHtml link rel', () => {
  it('adds the safety attributes but never nofollow on its own', () => {
    const out = sanitizeRichHtml('<a href="/stylists/tehran">تهران</a>');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain('nofollow');
  });

  it('keeps nofollow when the author enabled it in the editor', () => {
    const out = sanitizeRichHtml(
      '<a href="https://example.com" rel="noopener noreferrer nofollow">x</a>',
    );
    expect(out).toContain('nofollow');
    expect(out).toContain('noopener');
  });

  it('does not duplicate the rel tokens', () => {
    const out = sanitizeRichHtml('<a href="/x" rel="noopener noreferrer">x</a>');
    expect(out.match(/noopener/g)).toHaveLength(1);
    expect(out.match(/noreferrer/g)).toHaveLength(1);
  });

  it('still strips scripts and event handlers', () => {
    const out = sanitizeRichHtml('<a href="/x" onclick="alert(1)">x</a><script>alert(1)</script>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('<script');
  });
});
