// Must be first: initializes .env + .env.local for this process.
import { env } from '../../../core/config/env';
env.loadEnv();

import { parseArgs } from 'node:util';

import { AppError } from '../../../core/errors';
import { parseOrUsage, runCli, UsageError } from '../cliSupport';
import { describeTarget } from '../guard';
import {
  checkCoverage,
  explainForm,
  explainSubmission,
  loadCoverageManifest,
  type ExplainLine,
} from './check';
import { mismatchesOf, type CaseResult } from './expectations';
import {
  COVERAGE_FORM_KEYS,
  COVERAGE_SUBMISSION_KEYS,
  COVERAGE_WORKSPACE_KEYS,
  PERSONA_KEYS,
  type CoverageFormKey,
  type CoverageSubmissionKey,
  type PersonaKey,
} from './plan';

const USAGE = `Checks the dev data coverage set against its expectations table.

Usage:
  pnpm db:dev-data:verify
  pnpm db:dev-data:verify --persona <key> --form <key>
  pnpm db:dev-data:verify --persona <key> --submission <key>

Options:
  --persona <key>      ${PERSONA_KEYS.join(', ')}
  --form <key>         ${COVERAGE_FORM_KEYS.join(', ')}
  --submission <key>   ${COVERAGE_SUBMISSION_KEYS.join(', ')}
  --help               Show this message.

With no options, checks every persona against every case and exits 1 on any difference.
With --persona, prints what the rules read for one case and each answer.

Run "pnpm db:dev-data --seed" first.`;

type Options =
  | { kind: 'verify' }
  | { kind: 'form'; persona: PersonaKey; form: CoverageFormKey }
  | { kind: 'submission'; persona: PersonaKey; submission: CoverageSubmissionKey };

function oneOf<T extends string>(name: string, keys: readonly T[], value: string): T {
  if (!(keys as readonly string[]).includes(value)) {
    throw new UsageError(`--${name} must be one of ${keys.join(', ')}`);
  }
  return value as T;
}

function parse(argv: string[]): Options {
  const { values } = parseOrUsage(() =>
    parseArgs({
      args: argv,
      options: {
        persona: { type: 'string' },
        form: { type: 'string' },
        submission: { type: 'string' },
        help: { type: 'boolean', default: false },
      },
    }),
  );
  if (values.help) throw new UsageError('');

  const { persona, form, submission } = values;
  if (!persona && !form && !submission) return { kind: 'verify' };
  if (!persona || Boolean(form) === Boolean(submission)) {
    throw new UsageError('Pass --persona with exactly one of --form or --submission');
  }
  const personaKey = oneOf('persona', PERSONA_KEYS, persona);
  if (form) {
    return { kind: 'form', persona: personaKey, form: oneOf('form', COVERAGE_FORM_KEYS, form) };
  }
  return {
    kind: 'submission',
    persona: personaKey,
    submission: oneOf('submission', COVERAGE_SUBMISSION_KEYS, submission ?? ''),
  };
}

const PERSONA_WIDTH = Math.max(...PERSONA_KEYS.map((p) => p.length)) + 2;

/** One letter per check when it is allowed, '.' when not, then '!' when any differs. */
function cell<TCheck extends string>(
  result: CaseResult<string, TCheck> | undefined,
  letters: Record<TCheck, string>,
): string {
  if (!result) return '-'.repeat(Object.keys(letters).length + 1);
  const checks = Object.keys(letters) as TCheck[];
  const marks = checks.map((check) => (result.actual[check] ? letters[check] : '.')).join('');
  const differs = checks.some((check) => result.actual[check] !== result.expected[check]);
  return `${marks}${differs ? '!' : ' '}`;
}

function printGrid<TCase extends string, TCheck extends string>(args: {
  title: string;
  letters: Record<TCheck, string>;
  caseKeys: readonly TCase[];
  caseLabels: Record<TCase, string>;
  personas: PersonaKey[];
  results: CaseResult<TCase, TCheck>[];
}): void {
  const legend = Object.entries(args.letters)
    .map(([check, letter]) => `${String(letter)} ${check}`)
    .join('  ');
  console.log(`\n${args.title}  (${legend}; ! differs from the table)`);
  args.caseKeys.forEach((key, i) => {
    console.log(`  ${String(i + 1).padStart(2)} ${key.padEnd(26)} ${args.caseLabels[key]}`);
  });

  const width = Object.keys(args.letters).length + 2;
  const header = args.caseKeys.map((_key, i) => String(i + 1).padEnd(width)).join('');
  console.log(`\n${''.padEnd(PERSONA_WIDTH)}${header}`);
  for (const persona of args.personas) {
    const cells = args.caseKeys.map((key) =>
      cell(
        args.results.find((r) => r.persona === persona && r.caseKey === key),
        args.letters,
      ).padEnd(width),
    );
    console.log(`${persona.padEnd(PERSONA_WIDTH)}${cells.join('')}`);
  }

  for (const miss of mismatchesOf(args.results)) {
    const [got, want] = miss.expected ? ['no', 'yes'] : ['yes', 'no'];
    console.log(`  ${miss.persona} x ${miss.caseKey}: ${miss.check} ${got}, expected ${want}`);
  }
}

/** A grid's case labels, one per key. */
const labelsOf = <TCase extends string>(
  keys: readonly TCase[],
  label: (key: TCase) => string,
): Record<TCase, string> =>
  Object.fromEntries(keys.map((key) => [key, label(key)])) as Record<TCase, string>;

async function verify(): Promise<void> {
  const manifest = await loadCoverageManifest();
  const report = await checkCoverage(manifest);
  const formLabels = labelsOf(COVERAGE_FORM_KEYS, (key) => manifest.forms[key].name);

  printGrid({
    title: 'Forms',
    letters: { listed: 'L', start: 'S', draft: 'D', templates: 'T', update: 'U' },
    caseKeys: COVERAGE_FORM_KEYS,
    caseLabels: formLabels,
    personas: report.personas,
    results: report.forms,
  });
  printGrid({
    title: 'Design',
    letters: {
      designListed: 'L',
      designRead: 'R',
      designUpdate: 'U',
      submissionsRead: 'S',
      staffTemplates: 'T',
      printUpload: 'P',
    },
    caseKeys: COVERAGE_FORM_KEYS,
    caseLabels: formLabels,
    personas: report.personas,
    results: report.design,
  });
  printGrid({
    title: 'Workspaces',
    letters: { peopleRead: 'P', formCreate: 'C' },
    caseKeys: COVERAGE_WORKSPACE_KEYS,
    caseLabels: labelsOf(COVERAGE_WORKSPACE_KEYS, (key) => manifest.workspaces[key].name),
    personas: report.personas,
    results: report.workspaces,
  });
  printGrid({
    title: 'Submissions',
    letters: {
      mine: 'M',
      read: 'R',
      write: 'W',
      upload: 'U',
      fileDelete: 'F',
      render: 'P',
      delete: 'X',
    },
    caseKeys: COVERAGE_SUBMISSION_KEYS,
    caseLabels: labelsOf(COVERAGE_SUBMISSION_KEYS, (key) => manifest.submissions[key].submissionId),
    personas: report.personas,
    results: report.submissions,
  });

  for (const line of report.skipped) console.log(`\nSkipped ${line}`);
  for (const line of report.inconsistencies) console.log(`\nInconsistent: ${line}`);

  const failures =
    mismatchesOf(report.forms).length +
    mismatchesOf(report.design).length +
    mismatchesOf(report.workspaces).length +
    mismatchesOf(report.submissions).length +
    report.inconsistencies.length;
  if (failures > 0) {
    throw new AppError(`\n${failures} difference(s) from the expectations table`, 1);
  }
  console.log('\nEvery case matches the expectations table');
}

function printLines(lines: ExplainLine[]): void {
  const width = Math.max(...lines.map(([label]) => label.length)) + 2;
  for (const [label, value] of lines) console.log(`  ${label.padEnd(width)}${value}`);
}

async function run(options: Options): Promise<void> {
  console.log(`Target ${describeTarget()}`);
  if (options.kind === 'verify') return verify();

  const manifest = await loadCoverageManifest();
  printLines(
    options.kind === 'form'
      ? await explainForm(manifest, options.persona, options.form)
      : await explainSubmission(manifest, options.persona, options.submission),
  );
}

runCli(() => run(parse(process.argv.slice(2))), USAGE);
