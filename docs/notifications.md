# Notification emails

How SOBA builds and sends notification emails, and what every email must follow. People receiving
them know the product as CHEFS, so every email says CHEFS.

## How a send works

Backend code sends through `notificationService.sendEmail(context, email)`
(`backend/src/features/notifications/service.ts`). It checks the `notifications` feature, calls the
active notification plugin and writes one `notification_audit` row per call. It never throws: the
outcome comes back in the result. `NOTIFICATION_DEFAULT_CODE` picks the plugin: `notification-noop`
by default, `notify-v1` where Notify is set up; see the
[Notify v1 README](../backend/src/plugins/notify-v1/README.md) for its settings.

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
An email about a submission supplies, for each language, a subject, one sentence and link text, as
plain strings or as functions of the form name:

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
link. After every language's section it adds the reviewer's comment, once, under "Comments:". The
subject ends with the Confirmation ID, as ` (code)`, so mail clients do not thread every email about
one form into a single conversation.

- **Form names** go through `cleanName` before a template sees them: no control or format
  characters, no links, one line, at most 200 characters.
- **Subjects** are plain text, never HTML. The layout puts the finished subject on one line.
- **Comments** are shown as typed: escaped, with their line breaks kept. Nothing is removed from
  them, so a mail client may still turn a URL in one into a link.
- **Links** are `SafeUrl`s, made only by the link helpers. They require `https`, allowing `http`
  only on localhost; they refuse credentials, a query or a fragment; and they encode each path
  segment. A link is built when the email renders, once for each language, so each language links
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
  and the reviewer is left out of the submitters an email goes to.
- **Words:** CHEFS, "sign in" (never "login") and "Confirmation ID". Links say what they open, such
  as "View this submission"; the URL itself is not printed.
- **Where links go:** staff links open the designer; submitter links open the forms app.
- **Markup:** inline styles only, with text that meets WCAG AA contrast. Links have an explicit
  colour and an underline. Layout tables have `role="presentation"`. No images.
- **Shape:** a fragment, with no `<html>` or `<body>`, in one container of `max-width: 600px` to
  line up with Notify's header. No header or logo of our own, since Notify adds one; the footer is
  ours.

## Emails today

| email                   | sent to                                              | link                                            | sent by                                                                                                     |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| New submission (notice) | the addresses a form's "Email a notice" action lists | the submission in the designer                  | the action's job, queued by the submit (`plugins/post-submission-email-addresses`), as the system user      |
| Assigned                | the reviewer the submission is assigned to           | the submission in the designer                  | the status-change request, after it commits (`features/submission-review/statusEmails.ts`), as the reviewer |
| Revision requested      | the submission's owner and active collaborators      | the submission's `submit` page in the forms app | the status-change request, as the reviewer                                                                  |
| Review complete         | the submission's owner and active collaborators      | the submission in the forms app                 | the status-change request, as the reviewer                                                                  |

## Adding an email

1. Choose the block. An email about a submission uses `defineSubmissionEmail`; anything else gets a
   block of its own on `layout.ts`.
2. Write the template beside the feature that sends it, in English and French.
3. Build its link with a link helper, or add one to `url.ts` if the page is new.
4. Render it with `DEFAULT_EMAIL_LANGUAGE` and send one email per address through
   `notificationService.sendEmail`, leaving out the person who caused it.
5. Test it: the full English body, a French subject and body, and the sender's recipients and
   links. Unit tests use no real database.
6. Send it to a safelisted mailbox through Notify test and look at it before it merges. Get the
   French reviewed.
