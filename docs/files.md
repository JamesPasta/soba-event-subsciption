# Files

Files are stored through storage profiles and recorded in `soba.file`. Each feature that owns files
links to them from its own table: attachments through `submission_file`, document templates through
`document_template`.

## Storage plugins

Each plugin in `backend/src/plugins/storage-*` exports a `storagePluginDefinition` whose adapter
implements `StorageEngineAdapter` (`backend/src/core/integrations/storage-engine/`).

| plugin           | bytes                                                              | ref                 |
| ---------------- | ------------------------------------------------------------------ | ------------------- |
| `storage-memory` | in the memory of the replica that took the upload, lost on restart | `memory:<id>`       |
| `storage-local`  | on the filesystem under `BASE_PATH` (default `./data/storage`)     | `local:<path>`      |
| `storage-s3`     | in an S3-compatible bucket                                         | `s3:<bucket>:<key>` |

`storage-local` and `storage-s3` store bytes at `<prefix>/<workspace id>/<uuidv7>`, under
`BASE_PATH` or the profile's `PREFIX`. The prefix is the owning feature's. The uploaded name is kept
only in `soba.file.filename`.

`storage-local` reads and deletes only inside `BASE_PATH`; `storage-s3` only in its bucket and under
its `PREFIX`. A ref outside them reads as missing.

## Profiles

A profile is a named backend with its own settings. `STORAGE_PROFILES` lists the profile names. Each
needs `STORAGE_PROFILE_<NAME>_BACKEND` (a plugin code) and reads its settings from
`STORAGE_PROFILE_<NAME>_<KEY>`.

| key                        | plugin        | value                                                                     |
| -------------------------- | ------------- | ------------------------------------------------------------------------- |
| `BASE_PATH`                | storage-local | directory, default `./data/storage`                                       |
| `ENDPOINT`                 | storage-s3    | URL or host; a URL sets SSL from its scheme, and the port when it has one |
| `PORT`                     | storage-s3    | default `443` (https URL), `80` (http URL) or `9000` (host)               |
| `USE_SSL`                  | storage-s3    | host only; default `false`                                                |
| `ACCESS_KEY`, `SECRET_KEY` | storage-s3    | required                                                                  |
| `BUCKET_NAME`              | storage-s3    | required (or `BUCKET`)                                                    |
| `PREFIX`                   | storage-s3    | optional; lowercase words joined by dashes, in slash-separated segments   |

An empty `STORAGE_PROFILES` gives a single `default` profile on `storage-memory` when `NODE_ENV` is
`development`, and is an error otherwise. `/api/v1/health/ready` reports each profile but never
fails on one.

`soba.file` records the profile and ref each file was stored with; reads go through that profile.
Renaming a profile, or changing its backend, `BASE_PATH`, bucket or `PREFIX`, after files are stored
leaves them unreadable until they are moved.

Each feature chooses a profile, a key prefix and an upload limit:

| feature     | profile                                 | prefix                                   | max upload (MB)                   |
| ----------- | --------------------------------------- | ---------------------------------------- | --------------------------------- |
| attachments | `FILES_STORAGE_PROFILE` (`default`)     | `FILES_STORAGE_PREFIX` (`attachments`)   | `FILES_MAX_FILE_SIZE_MB` (10)     |
| templates   | `TEMPLATES_STORAGE_PROFILE` (`default`) | `TEMPLATES_STORAGE_PREFIX` (`templates`) | `TEMPLATES_MAX_FILE_SIZE_MB` (10) |

### Helm

`backend.storage` configures the `default` profile. Dev, test, UAT and prod use `storage-s3`, each
under its own `defaultPrefix` (`dev`, `test`, `uat`, `prod`). Their endpoint, bucket and credentials
come from Vault: `s3VaultKeyInfix` (`DEV`, `TEST`, `UAT`, `PROD`) picks the keys
`S3_<infix>_ENDPOINT`, `S3_<infix>_BUCKET_NAME`, `S3_<infix>_ACCESS_KEY_ID` and
`S3_<infix>_ACCESS_SECRET_KEY` in `vault.secretPath`, and every key must be there.

PR deployments use `storage-local` on the `<fullname>-backend-filestore` PVC (ReadWriteMany,
`netapp-file-standard`, 1Gi) mounted at `/app/files`, and write nothing to S3. The chart keeps the
PVC on uninstall unless `global.forceCleanup` is set; the PR close workflow deletes it.

The chart fails on `storage-memory` with more than one replica or with autoscaling, `storage-local`
without an absolute `defaultBasePath`, `storage-s3` without a valid `defaultPrefix`,
`s3VaultKeyInfix` without `vault.enabled`, and a malformed feature prefix. Without
`s3VaultKeyInfix` it does not set the S3 `ACCESS_KEY` or `SECRET_KEY`.

## File store

`fileStore` (`backend/src/core/services/fileStore.ts`) writes and deletes files for every feature.

An upload is virus scanned when the `antivirus` feature is on, then stored, then its `soba.file` row
and the feature's link row are written in one transaction. An infected file is refused with 422 and
an unavailable scanner with 503; neither is stored. If the rows fail, the stored bytes are deleted.
Uploads are multipart with one file, whose name is at most 255 UTF-8 bytes.

A delete removes the rows, then the bytes. A file shared by several links is deleted only when its
last link goes. A failed byte delete is logged and leaves the bytes unreferenced.

Downloads go through `sendStoredFile`. PDF, PNG, JPEG, GIF and WebP can be shown inline; plain
text, CSV, Microsoft Office and OpenDocument files download as attachments. Both keep their declared
type. Anything else downloads as `application/octet-stream`. Every download sends
`X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox; default-src 'none'`. A file
whose bytes are missing returns 503.

`pnpm db:dev-data --purge` and `--reset` delete the stored bytes of the files they remove, so they
need the backend's storage settings. Files on a profile they cannot resolve are skipped and counted.

## Attachments

Feature `files`. An attachment belongs to one submission through `submission_file`.

| route                      | does                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `POST /api/v1/files`       | multipart file and `submissionId`; returns `id`, `name`, `originalName`, `size`, `type` |
| `GET /api/v1/files/:id`    | download                                                                                |
| `DELETE /api/v1/files/:id` | delete                                                                                  |

The routes take anonymous and signed-in callers and need `submit-mode`. Access comes from the owning
submission (see [Submission participants](workspace-access-model.md#submission-participants)):
`read` to download, `write` to upload or delete while it is in progress, and `submission_update` on
the form to delete from a submitted one. A file whose submission is deleted returns 404 and keeps
its rows and bytes.

Staff download an attachment through `GET /api/v1/design/submissions/:id/files/:fileId`, which
needs sign-in, `design-mode`, the `files` feature and `submission_read` on the form. A file not
attached to that submission returns 404.

Removing a file from the form deletes it at once, not when the answers are next saved, so a draft
saved earlier can still reference it.

Extensions in `BLOCKED_FILE_EXTENSIONS` (`backend/src/features/files/config.ts`) are refused with
415 whatever the form allows. `GET /api/v1/meta/files-config` returns them and the upload limit.

## Templates

Feature `templates`. A template is a named file of a type, bound to one form version through
`document_template`. A version holds at most one template of each type. The types and the
extensions each accepts are `TEMPLATE_TYPES` and `TEMPLATE_TYPE_EXTENSIONS` in
`lib/src/schemas/templates.ts`: `cdogs` takes docx, xlsx and html. A template uploaded without a
name takes its type's name.

Each type needs a feature, `TEMPLATE_TYPE_FEATURES`: `cdogs` needs `document-generation`. Uploading
or replacing a file of a type whose feature is not available to the form returns 400. Listing,
downloading, renaming and deleting do not check it.

| route                                   | body                              | permission                            |
| --------------------------------------- | --------------------------------- | ------------------------------------- |
| `GET /api/v1/templates?formId=`         |                                   | `form_read`, `document_template_read` |
| `POST /api/v1/templates?formVersionId=` | multipart `file`, `type`, `name`? | `document_template_create`            |
| `GET /api/v1/templates/:id`             |                                   | `form_read`, `document_template_read` |
| `GET /api/v1/templates/:id/content`     |                                   | `form_read`, `document_template_read` |
| `PUT /api/v1/templates/:id/content`     | multipart `file`                  | `document_template_create`            |
| `PATCH /api/v1/templates/:id`           | `name`                            | `document_template_create`            |
| `DELETE /api/v1/templates/:id`          |                                   | `document_template_delete`            |

The routes need sign-in and `design-mode`. Templates can be changed on any version, published ones
included. Templates of a deleted form or form version return 404.

Creating a draft with `fromFormVersionId` (`POST /api/v1/design/form-versions`) gives the draft the
source version's templates, pointing at the same files. Replacing a template's file stores a new
file for that template only.

Rendering needs the `document-generation` and `templates` features:

| route                                          | access                                       | does                                                                                |
| ---------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /api/v1/submit/submissions/:id/templates` | the submitter `render` rule                  | the id of the form version's `cdogs` template, and `renderAvailable`                |
| `POST /api/v1/submit/submissions/:id/print`    | the submitter `render` rule                  | renders `templateId` with the saved submission                                      |
| `GET /api/v1/design/submissions/:id/templates` | `submission_read`                            | the form version's `cdogs` templates with file name and date, and `renderAvailable` |
| `POST /api/v1/design/submissions/:id/print`    | `submission_read`                            | renders `templateId` with the saved submission                                      |
| `POST /api/v1/design/print-upload/:id`         | `submission_read`, `submission_print_upload` | renders the multipart `file` with the saved submission `:id`, without storing it    |

The `render` rule needs access to the submission and `document_template_read`. Only `cdogs`
templates render, and only saved answers print; printing unsaved ones needs a new route.
`renderAvailable` is false when no backend serves the form. A print takes `options` (`convertTo`:
`pdf`, `reportName`); an upload takes them as multipart fields, and its file is virus scanned. Print
is rate limited by `RATE_LIMIT_RENDER_*`. Each pod renders at most
`DOCUMENT_GENERATION_MAX_CONCURRENT` (2) at a time and returns 503 beyond that; an upload takes its
slot before its body is read. A template that cannot be rendered, an infected upload, or a print
with no saved data returns 422. An unavailable backend, scanner or template bytes return 503. The
upload has its own path so its route can wait out the scan (300s, like the other uploads).

## Submit files (deprecated)

`/api/v1/submit/files` serves the same routes as `/api/v1/files` for the Form.io file component. New
callers use `/api/v1/files`.

The BC Gov file component (`bcgov-file`, from `bcgov/formio-components`) stores files through the
`chefs` storage provider. `frontend/src/features/formio-v5/registerBcgovFormio.ts` registers both
when the `files` feature is enabled and allowed by the app's `NEXT_PUBLIC_SOBA_FEATURES_ALLOWED`.
The provider uploads to `/submit/files` with the submission being filled, and the submission data
keeps each file's URL as `<api>/submit/files/<id>`.

`frontend/public/formio-v5/bcgov-file.css` applies Form.io's `.formio-component-file` rules to
`bcgov-file`, which matches them only through its `customClass`.
