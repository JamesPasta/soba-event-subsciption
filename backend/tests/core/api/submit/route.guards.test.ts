import { submitRouter } from '../../../../src/core/api/submit/route';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: { name: string } }[] };
}

const GUARDS = [
  'requireSubmissionStart',
  'requireVersionSchemaRead',
  'requireSubmissionRead',
  'requireSubmissionWrite',
  'requireSubmissionDelete',
  'requireSubmissionRevise',
  'requireSignedInSubmitter',
];

const routes = (submitRouter as unknown as { stack: RouteLayer[] }).stack.flatMap((l) =>
  l.route
    ? Object.keys(l.route.methods).map((method) => ({
        method,
        path: l.route!.path,
        handlers: l.route!.stack.map((s) => s.handle.name),
      }))
    : [],
);

/** Names of the handlers mounted on one route, in order. */
const handlersFor = (method: string, path: string): string[] => {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`No ${method.toUpperCase()} ${path} on the submit router`);
  return route.handlers;
};

it.each([
  ['get', '/submissions/:id', 'requireSubmissionRead'],
  ['get', '/submissions/:id/data', 'requireSubmissionRead'],
  ['get', '/submissions/:id/schema', 'requireSubmissionRead'],
  ['get', '/submissions/:id/fill', 'requireSubmissionRead'],
  ['post', '/submissions/:id/save', 'requireSubmissionWrite'],
  ['post', '/submissions/:id/submit', 'requireSubmissionWrite'],
  ['delete', '/submissions/:id', 'requireSubmissionDelete'],
  ['post', '/submissions/:id/revise', 'requireSubmissionRevise'],
])('%s %s loads the submission once, then decides with %s', (method, path, guard) => {
  const handlers = handlersFor(method, path);
  expect(handlers.filter((name) => name === 'loadSubmitterSubmission')).toHaveLength(1);
  expect(handlers.indexOf('loadSubmitterSubmission')).toBeLessThan(handlers.indexOf(guard));
});

it.each([
  ['post', '/submissions', 'loadSubmitterForm', 'requireSubmissionStart'],
  ['get', '/forms/:formId', 'loadSubmitterForm', 'requireSubmissionStart'],
  ['get', '/form-versions/:id/schema', 'loadSubmitterFormVersion', 'requireVersionSchemaRead'],
])('%s %s reads once with %s, then decides with %s', (method, path, load, guard) => {
  const handlers = handlersFor(method, path);
  expect(handlers.filter((name) => name.startsWith('loadSubmitter'))).toEqual([load]);
  expect(handlers.indexOf(load)).toBeLessThan(handlers.indexOf(guard));
});

it.each(['/submissions/mine', '/forms/mine', '/workspaces/mine'])(
  'GET %s goes through requireSignedInSubmitter',
  (path) => {
    expect(handlersFor('get', path)).toContain('requireSignedInSubmitter');
  },
);

it.each([
  ['/submissions/mine', '/submissions/:id'],
  ['/forms/mine', '/forms/:formId'],
])('registers GET %s before GET %s, which would take it as an id', (mine, byId) => {
  const order = routes.filter((r) => r.method === 'get').map((r) => r.path);
  expect(order.indexOf(mine)).toBeGreaterThanOrEqual(0);
  expect(order.indexOf(mine)).toBeLessThan(order.indexOf(byId));
});

it.each(routes.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r.handlers] as const))(
  '%s runs exactly one submit-mode guard, before its handler',
  (_route, handlers) => {
    const guards = handlers.filter((name) => GUARDS.includes(name));
    expect(guards).toHaveLength(1);
    expect(handlers.indexOf(guards[0])).toBeLessThan(handlers.length - 1);
  },
);

it.each([
  ['/submissions/:id/save', 'replayRecordedSave'],
  ['/submissions/:id/submit', 'replayRecordedSubmit'],
])('POST %s answers a recorded write after the load, before any guard', (path, replay) => {
  const handlers = handlersFor('post', path);
  const at = handlers.indexOf(replay);
  expect(at).toBeGreaterThan(handlers.indexOf('loadSubmitterSubmission'));
  expect(at).toBeLessThan(handlers.indexOf('requireSubmissionWrite'));
});

it('POST /submissions answers a recorded open before it reads the form', () => {
  const handlers = handlersFor('post', '/submissions');
  expect(handlers.indexOf('replayRecordedOpen')).toBeGreaterThanOrEqual(0);
  expect(handlers.indexOf('replayRecordedOpen')).toBeLessThan(
    handlers.indexOf('loadSubmitterForm'),
  );
});

it('POST /submissions/:id/save checks drafts after write access, before its handler', () => {
  const handlers = handlersFor('post', '/submissions/:id/save');
  const draftGuard = handlers.indexOf('requireDraftSave');
  expect(draftGuard).toBeGreaterThan(handlers.indexOf('requireSubmissionWrite'));
  expect(draftGuard).toBeLessThan(handlers.length - 1);
});

it.each(['/submissions', '/submissions/:id/submit'])('POST %s does not check drafts', (path) => {
  expect(handlersFor('post', path)).not.toContain('requireDraftSave');
});
