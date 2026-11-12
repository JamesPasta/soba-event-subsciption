import {
  appUrlProblem,
  assertEmailLinkBases,
  designerSubmissionFileUrl,
  designerSubmissionUrl,
  formsSubmissionUrl,
} from '../../../../../src/core/integrations/notification/email/url';

describe('email links', () => {
  it("points at the submission in the designer, in the email's language, whatever the base's trailing slash", () => {
    expect(designerSubmissionUrl('https://soba.example/designer', 'en', 'f1', 's1')).toBe(
      'https://soba.example/designer/en/build/f1/submissions/s1',
    );
    expect(designerSubmissionUrl('https://soba.example/designer/', 'fr', 'f1', 's1')).toBe(
      'https://soba.example/designer/fr/build/f1/submissions/s1',
    );
  });

  it("points at a submission's file in the designer, encoding each part", () => {
    expect(
      designerSubmissionFileUrl('https://soba.example/designer/', 'en', 'f1', 's1', 'a/b'),
    ).toBe('https://soba.example/designer/en/build/f1/submissions/s1/files/a%2Fb');
    expect(designerSubmissionFileUrl(undefined, 'en', 'f1', 's1', 'file-1')).toBeNull();
  });

  it('points at the submission in the forms app, on the page asked for', () => {
    expect(formsSubmissionUrl('https://soba.example/forms', 'fr', 'submit', 's1')).toBe(
      'https://soba.example/forms/fr/submit/s1',
    );
    expect(formsSubmissionUrl('https://soba.example/forms', 'en', 'submission', 's1')).toBe(
      'https://soba.example/forms/en/submission/s1',
    );
  });

  it('encodes each part of the path', () => {
    expect(designerSubmissionUrl('https://soba.example', 'en', 'a/b', 's?1#x')).toBe(
      'https://soba.example/en/build/a%2Fb/submissions/s%3F1%23x',
    );
  });

  it.each([
    ['an empty query', 'https://soba.example/designer?'],
    ['an empty fragment', 'https://soba.example/designer#'],
    ['surrounding whitespace', ' https://soba.example/designer \n'],
    ['a tab in the host', 'https://soba.exa\tmple/designer'],
  ])('builds a clean link from a base with %s', (_case, base) => {
    expect(designerSubmissionUrl(base, 'en', 'f1', 's1')).toBe(
      'https://soba.example/designer/en/build/f1/submissions/s1',
    );
  });

  it('is left out when the base is not set', () => {
    expect(designerSubmissionUrl(undefined, 'en', 'f1', 's1')).toBeNull();
    expect(formsSubmissionUrl('', 'en', 'submit', 's1')).toBeNull();
  });

  it.each([
    ['https://soba.example/designer', null],
    ['http://localhost:3101/designer', null],
    ['http://127.0.0.1:3100/forms', null],
    ['http://soba.example/designer', 'must use https, or http on localhost'],
    ['javascript:alert(1)', 'must use https, or http on localhost'],
    ['data:text/html,hello', 'must use https, or http on localhost'],
    ['https://user:secret@soba.example', 'must not carry credentials'],
    ['https://soba.example/designer?x=1', 'must not have a query or fragment'],
    ['soba.example/designer', 'is not a URL'],
  ])('judges %j as a link base', (base, problem) => {
    expect(appUrlProblem(base)).toBe(problem);
  });

  it('refuses to build a link from an unusable base', () => {
    expect(() => designerSubmissionUrl('javascript:alert(1)', 'en', 'f1', 's1')).toThrow(
      'An email link base must use https, or http on localhost',
    );
  });

  it('stops startup on an unusable base and names its variable, and lets unset ones pass', () => {
    expect(() =>
      assertEmailLinkBases({ DESIGNER_APP_URL: undefined, FORMS_APP_URL: 'https://soba.example' }),
    ).not.toThrow();
    expect(() => assertEmailLinkBases({ FORMS_APP_URL: 'http://soba.example/forms' })).toThrow(
      'FORMS_APP_URL must use https, or http on localhost',
    );
  });
});
