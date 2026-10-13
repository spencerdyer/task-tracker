import { keepLineBreaks } from '../markdownText';

// One item per line stays one item per line; code fences and paragraphs are left alone
describe('keepLineBreaks', () => {
  it('turns single line breaks into hard breaks', () => {
    expect(keepLineBreaks('SETUP: a\nTESTS: b')).toBe('SETUP: a  \nTESTS: b');
  });
  it('leaves paragraphs, the last line and code fences alone', () => {
    expect(keepLineBreaks('one\n\ntwo')).toBe('one\n\ntwo');
    expect(keepLineBreaks('```\nx = 1\ny = 2\n```')).toBe('```\nx = 1\ny = 2\n```');
    expect(keepLineBreaks('text\n```\ncode\n```')).toBe('text\n```\ncode\n```');
  });
});
