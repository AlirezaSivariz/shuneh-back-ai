import { normalizePath } from '../src/modules/redirect/redirect.service';

describe('normalizePath', () => {
  it('adds a leading slash and lowercases', () => {
    expect(normalizePath('Stylists/Old-Name')).toBe('/stylists/old-name');
  });

  it('keeps a single leading slash', () => {
    expect(normalizePath('/stylists/old-name')).toBe('/stylists/old-name');
  });

  it('drops a trailing slash', () => {
    expect(normalizePath('/blog/post/')).toBe('/blog/post');
  });

  it('collapses duplicate slashes', () => {
    expect(normalizePath('//blog//post')).toBe('/blog/post');
  });

  it('strips the query string and hash', () => {
    expect(normalizePath('/blog/post?utm=1#top')).toBe('/blog/post');
  });

  it('handles the root path', () => {
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
  });
});
