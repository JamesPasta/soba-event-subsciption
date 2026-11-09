# Notification emails

How SOBA builds and sends notification emails, and what every email must follow. People receiving
them know the product as CHEFS, so every email says CHEFS.

## How a send works

Every email is sent by a job; see [Sending from a job](#sending-from-a-job). The job sends through
`sendEachAddress`, which calls `notificationService.sendEmail(context, email)`
(`backend/src/features/notifications/service.ts`) once per address. The service checks the
`notifications` feature, calls the active notification plugin and writes one `notification_audit`
row per call, with the job's id. It never throws: the outcome comes back in the result.
`NOTIFICATION_DEFAULT_CODE` picks the plugin: `notification-noop` by default, `notify-v1` where
Notify is set up; see the [Notify v1 README](../backend/src/plugins/notify-v1/README.md) for its
settings.

Notify takes a finished subject and one body, typed `text` or `html`. SOBA renders every email
itself; there are no provider templates. What Notify does with the body:

- It puts the body into its own HTML page, behind a Government of British Columbia header: a logo
  (a remote image) and a grey rule, 600px wide. A `text` body gets the same treatment, so every
  email reaches people as HTML.
- The message has one `text/html` part in UTF-8 and no plain-text alternative. A reader whose
  client shows mail as plain text sees the words of a link but may not see its address.
- Subjects with accents and dashes arrive intact.
- It adds no footer.

Notify's test service delivers only to the addresses on its safelist.

## The email kit

`backend/src/core/integrations/notification/email/` builds every email. It has two layers: the
layout frames any email, and a block for each kind of email fills it.

| file                 | role                                                                                                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `html.ts`            | `markup`, a template tag that escapes every value unless it is markup the tag built, and `SafeHtml`, which nothing else can make. A look-alike object or `true` throws                                   |
| `url.ts`             | `designerSubmissionUrl` and `formsSubmissionUrl`, the only makers of `SafeUrl`. `assertEmailLinkBases`, which stops startup when `DESIGNER_APP_URL` or `FORMS_APP_URL` is set but unusable               |
| `language.ts`        | `EmailLanguage` (`en`, `fr`), `EmailLanguages` (adds `both`) and `DEFAULT_EMAIL_LANGUAGE`                                                                                                                |
| `layout.ts`          | `renderEmail(parts, languages)`: the container, the order of `both`, "(Le français suit)", the divider, the footer and a one-line subject. Also `paragraph`, `link`, `languageSection`, `withLineBreaks` |
| `submissionEmail.ts` | the block for an email about a submission: `defineSubmissionEmail` and `renderSubmissionEmail`                                                                                                           |

The tag is named `markup`, not `html`: Prettier reformats the contents of any template tagged
`html`, which would change the emails.

The layout knows nothing about submissions. An email about something else, such as a form reminder
or a finished export, gets its own small block on the layout. It does not stretch the submission
block or fake a Confirmation ID.

## Templates

A template holds words only, in English and French; the type requires both. It never writes markup.
An email about a submission supplies, for each language, a subject and one sentence, as functions of
the form name, and link text:

```ts
export const ASSIGNED_EMAIL = defineSubmissionEmail({
  en: {
    subject: ({ form }) => `${form} Submission Assignment`,
    sentence: ({ form }) =>
      `You have been assigned to a ${form} submission. Please sign in to review it.`,
    linkText: "View this submission",
  },
  fr: {
    subject: ({ form }) => `Attribution de soumission : ${form}`,
    sentence: ({ form }) =>
      `Une soumission pour ${form} vous a été attribuée. Veuillez vous connecter pour l’examiner.`,
    linkText: "Voir cette soumission",
  },
});
```

The sender renders it with the facts and the language:

```ts
const content = renderSubmissionEmail(
  ASSIGNED_EMAIL,
  {
    formName: facts.formName,
    confirmationCode: facts.confirmationCode,
    link: (language) =>
      designerSubmissionUrl(
        env.getDesignerAppUrl(),
        language,
        facts.formId,
        submissionId,
      ),
    comment, // only when the reviewer attached it to the email
  },
  DEFAULT_EMAIL_LANGUAGE,
);
```

For each language, the submission block renders the Confirmation ID in bold, the sentence and the
link. After every language's section it adds the reviewer's comment, once, under "Comments:",
"Commentaires :", or "Comments: / Commentaires :" in an email in both. The subject ends with the
Confirmation ID, as ` (code)`, so mail clients do not thread every email about one form into a
single conversation.

- **Form names** go through `cleanName` before a template sees them: no control or format
  characters, no links, one line, at most 200 characters.
- **Subjects** are plain text, never HTML. The layout puts the finished subject on one line.
- **Comments** are shown as typed: escaped, with their line breaks kept. Nothing is removed from
  them, so a mail client may still turn a URL in one into a link.
- **Links** are `SafeUrl`s, made only by the link helpers. They require `https`, allowing `http`
  only on localhost; they refuse credentials, a query or a fragment; they are built from the parsed
  base, so stray whitespace in a setting never reaches a link; and they encode each path segment.
  A link is built when the email renders, once for each language, so each language links
  under its own path. With no base URL set, the email has no link.

Templates live beside the feature that sends them, such as
`backend/src/features/submission-review/statusEmailTemplates.ts` and the notice in
`backend/src/plugins/post-submission-email-addresses/notice.ts`.

## Language

Every template has English and French, and every send says which to use: `en`, `fr` or `both`.
SOBA does not record recipients' languages, so every email goes out in `DEFAULT_EMAIL_LANGUAGE`,
which is `both`.

An email in both languages is one message: "(Le français suit)" first, the English section, a
divider, the French section, the comment once, then one footer with each language's sentence on its
own line. Each section and each footer sentence carries its `lang` attribute; the comment claims no
language. The subject is `English subject / French subject (code)`.

French copy is reviewed by a fluent French speaker before it merges.

## Content

- **What an email carries:** the Confirmation ID, the form name, the reviewer's comment when one is
  attached, and a link. Never submitted answers or other personal data.
- **One email per address,** so no recipient sees another's address.
- **No email to the person who made the change.** Assigning a submission to yourself sends nothing,
  and whoever made the change is left out of the submitters an email goes to, even a reviewer who
  is also a submitter. A submitter sending their own submission back to revise emails no one.
- **Words:** CHEFS, "sign in" (never "login") and "Confirmation ID" ("ID de confirmation", as the
  app's French screens say). Links say what they open, such
  as "View this submission"; the URL itself is not printed.
- **Where links go:** staff links open the designer; submitter links open the forms app.
- **Markup:** inline styles only, with text that meets WCAG AA contrast. Links have an explicit
  colour and an underline. Layout tables have `role="presentation"`. No images.
- **Shape:** a fragment, with no `<html>` or `<body>`, in one container of `max-width: 600px` to
  line up with Notify's header. No header or logo of our own, since Notify adds one; the footer is
  ours.

## Sending from a job

Code that causes an email never calls Notify, and never queues the email itself. It records an
event: a job queued in the transaction that saves what happened. When the event job runs, its
fan-out queues one job for each reaction recorded with the event, and the email is one of those
reactions. The event commits or rolls back with the change, and its jobs retry while Notify is slow
or down. A failed email never undoes the change that caused it. Every review status change records
its event; a submit records one only where post-submission actions are available.

| event                       | recorded by                                          | its reactions                                                                                                                          |
| --------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `submission.submitted`      | a submit (`submissionService`)                       | the post-submission actions the form has on, such as "Email a notice" (`features/post-submission`)                                     |
| `submission.status-changed` | a review status change (`updateStatus`, `reviseOwn`) | the entries in `STATUS_REACTIONS` that the change calls for (`features/submission-review/statusReactions.ts`): today, the status email |

- **One event job per event,** with its type named `<resource>.<event>`. Its dedupe key is
  `<type>:<event id>`, so a retried request records nothing new. After the commit, `nudgeJobs` wakes
  the pool, so the reactions run within seconds. Dev-data seeding records no events.
- **Reactions are recorded with the event.** Which ones are available here, such as whether
  notifications are on, is checked before the transaction. Which ones the event calls for is
  decided inside it, and the event's `params.actions` records them, so later settings changes don't
  alter them. The Jobs tabs show them as "Actions recorded". A new reaction to an existing event is
  a new entry in that event's list; the code that records the event does not change.
- **The fan-out queues the reactions.** In one transaction it marks the event's children queued and
  inserts one job per recorded reaction, with dedupe key `<reaction type>:<event id>`, the event as
  parent and the event's creator as its own. Once the children are queued, the event can't be run
  again; their jobs can. When the submission, its form or its workspace is already gone, the event
  ends cancelled with that reason and queues nothing.
- **Params hold ids and choices, never content.** A status-changed event's params are
  `{ statusChangeId, actions }`, and its status email's are
  `{ statusChangeId, options: { attachComment } }`: a reaction's job keeps its recorded options
  under `options`, as an action's job does, so the admin Jobs tab lists them. The reaction reads the
  recipients and the comment when it runs, so addresses and comments stay out of job rows and their
  backups. The Jobs tabs count such a job's sent and refused addresses from its audit rows; how
  many it has in all, and how many are left, aren't known until it has run.
- **The reaction checks the event still applies.** A status email ends cancelled once the
  submission, its form or its workspace is gone, or when the submission's status has moved on since
  the change, so a late retry or a re-run never sends an out-of-date email.
- **Retry or stop:**

  | the job                       | when                                                                                                                                                                 |
  | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | throws, so it retries         | the provider fails without refusing the address, or times out; an audit row could not be written                                                                     |
  | ends cancelled, with a reason | notifications are off; the event no longer applies; no one is left to send to; a recipient cannot be resolved, such as an assignee who can no longer review the form |

  Cancel reasons show in the Jobs tabs, so they name no address, comment or form name.

- **One send step,** `sendEachAddress` (`backend/src/core/integrations/notification/sendEachAddress.ts`):
  1. Puts each address in lower case and drops duplicates.
  2. Counts an address no provider would take as refused, without sending to it.
  3. Skips the addresses this job already handled. With none left it stops, unless none was ever
     sent (step 7).
  4. Checks that notifications are on.
  5. Runs the policy's `checkBudgets`, if any, until the run has handled an address.
  6. Sends to one address at a time. A refused address (400 or 422) is recorded and skipped; any
     other failure throws.
  7. Ends cancelled when no email on the list has been sent, on this attempt or an earlier one:
     every address was refused.
- **Attribution.** `jobNotifications(job, actorId)` binds the service to the job; `actorId` is a
  function that gives the user each send is attributed to. A send is attributed to the person whose
  action caused it. Running an email's job again attributes its sends to whoever ran it; running an
  event again does not, since the jobs it queues keep the event's creator. An action a form is
  configured with, such as the notice, sends as the system user.
- **Hourly limits** apply where staff choose the recipients: the notice checks its form, workspace
  and environment limits before its run sends anything. Status emails go out one per person's
  action and have none.

## Emails today

| email                   | sent to                                              | link                                            | sent by                                                                                                                                              |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| New submission (notice) | the addresses a form's "Email a notice" action lists | the submission in the designer                  | the action's job, queued by the `submission.submitted` fan-out (`plugins/post-submission-email-addresses`), as the system user                       |
| Assigned                | the reviewer the submission is assigned to           | the submission in the designer                  | a `submission.status-email` job, queued by the `submission.status-changed` fan-out (`features/submission-review/statusEmailJob.ts`), as the reviewer |
| Revision requested      | the submission's owner and active collaborators      | the submission's `submit` page in the forms app | a `submission.status-email` job, as the reviewer; none when a submitter sends their own submission back                                              |
| Review complete         | the submission's owner and active collaborators      | the submission in the forms app                 | a `submission.status-email` job, as the reviewer                                                                                                     |

## Adding an email

1. Choose the block. An email about a submission uses `defineSubmissionEmail`; anything else gets a
   block of its own on `layout.ts`.
2. Write the template beside the feature that sends it, in English and French.
3. Build its link with a link helper, or add one to `url.ts` if the page is new.
4. Add a `JobType` code (`backend/src/core/db/codes/index.ts`) and a job spec in
   `backend/src/core/jobs/` with its pool, `maxAttempts`, `timeoutMs` and params schema. Keep the
   spec apart from the handler, so queuing the job does not load the handler.
5. Write the handler beside the feature. It loads the event and checks it still applies, resolves
   the recipients without the person who caused it, renders with `DEFAULT_EMAIL_LANGUAGE`, and
   calls `sendEachAddress` with `jobNotifications(job, () => Promise.resolve(actorId))`.
6. Register the handler in `getJobRegistry` (`backend/src/core/jobs/catalog.ts`) and name the type:
   `TYPE_NAMES` in `backend/src/core/services/jobViewService.ts` for the admin filter, and the
   constant and its `OWN_TYPE_LABELS` entry in `frontend/src/features/jobs/jobs.ts` with
   `jobs.types` in `en.json` and `fr.json`. Add it to `submissionJobTypes()` if it belongs to a
   submission.
7. Hang it off its event as a reaction. For an existing event, add an entry to the event's list,
   such as `STATUS_REACTIONS`, with its job spec, whether it can run here, and the rule that decides
   which events call for it and the options to record. For a new kind of event, add the event the
   way `submission.submitted` and `submission.status-changed` are built:
   - a `JobType` code and a spec
   - an enqueue function in `backend/src/core/jobs/enqueue.ts`, run in the transaction that saves
     the event, which records the reactions
   - `nudgeJobs` after the commit
   - a fan-out registered in the catalog
   - its names in the Jobs tabs
   - its type in both `FAN_OUT_TYPES` sets, in `jobViewService.ts` and
     `frontend/src/features/jobs/jobs.ts`, so neither the server nor the page offers to run it again
     once it has queued its reactions
8. Test it: the full English body, a French subject and body, the reaction's rule, the handler's
   recipients, cancel reasons and attribution, and that the event records the reaction once. Unit
   tests use no real database.
9. Send it to a safelisted mailbox through Notify test and look at it before it merges. Get the
   French reviewed.
