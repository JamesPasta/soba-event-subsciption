# User search

Finds people to add to a workspace or a form's team. Each enabled search plugin is asked, and
the people they return are merged into one list.

## API

| Route | Returns |
| --- | --- |
| `GET /api/v1/workspaces/{id}/user-search` | People found |
| `GET /api/v1/workspaces/{id}/user-search/capabilities` | Identity providers searchable here, with the filters each accepts |
| `POST /api/v1/workspaces/{id}/user-search/users` | The Soba user for a person found, made from the directory if they have none |
| `GET /api/v1/design/forms/{id}/user-search` | Same as the workspace route, with access checked on the form |
| `GET /api/v1/design/forms/{id}/user-search/capabilities` | Same as the workspace route, with access checked on the form |
| `POST /api/v1/design/forms/{id}/user-search/users` | Same as the workspace route, with access checked on the form |

- Filters: `email`, `firstName`, `lastName` and `guid`, each at least 2 characters. Give at least
  one; every filter given must match. `locale` (or `Accept-Language`) sets the sort language.
- `identityProvider` (optional) limits the search to one `soba.identity_provider` code, e.g.
  `azureidir` or `bceidbusiness`. Without it, every identity provider searchable here is searched.
  These codes are the SSO token's `identity_provider` claim, lowercased. Plugins map them to their
  own names.
- Access: a workspace owner or admin, or a `team_update` holder on the form (on the workspace for
  the workspace routes).
- The `user-search` feature gates every route; with it off they answer 404.

A search goes to every enabled plugin, once for each identity provider searched for which it
accepts all the given filters. People are merged by identity provider and subject (the
`user_identity` key), with earlier plugins in `USER_SEARCH_PLUGINS` winning per field. Each person
carries `identityProvider`, `sources` (the plugins that returned them) and `sobaUserId`, set when
the identity already belongs to a Soba user. Soba users sort first, then by display name.

Each plugin returns at most 25 people per identity provider and a search at most 50; `truncated`
says more were found. `plugins` reports each plugin asked once: `unavailable` if any of its
searches could not answer, `rejected` if it refused the filters for every identity provider asked,
otherwise `ok`. An enabled plugin that failed to load is `unavailable`. The search answers 503
when no plugin could answer, including when none is enabled. It answers 400 when the identity
provider asked is not searchable here, no plugin accepts the filters, or every plugin asked
refused them.

Searching creates no account or membership.

## Making a user from a result

`POST .../user-search/users` takes `{ identityProvider, guid }` for someone found who has no Soba
user, so they can be added before they first sign in. Soba searches again by that guid and
stores only what the directory returns. It answers:

- 201 with `{ userId, created: true }` for a new user, or 200 with `created: false` when the
  identity already has one. Asking again never makes a second.
- 404 `person_not_found` when no one has the guid, 503 when a plugin that could not answer might
  have.
- 422 `identity_unconfirmed` unless exactly one person has the guid and their subject is
  `<guid>@<identity provider>`, the subject sign-in will send. Stored in lower case; sign-in and
  search match subjects without case.

The new user has no access until something grants it, and records the caller as its creator. Its
identity has no first sign-in yet: when the person signs in, Soba marks it and replaces the
directory profile and display label with the token's, keeping any preferences.

## Plugins

`USER_SEARCH_PLUGINS` lists the enabled plugins, comma-separated, in merge order. Unset enables
none. Where both are enabled, `css-v1` is listed first. Soba stores a profile at first sign-in and
never refreshes it after that.

### user-search-soba

Searches active Soba users by their identities, including ones made from a result that have not
signed in yet. For those, the guid comes from the subject. It needs no config and can search
every active login provider by every filter.

| Filter | Matches |
| --- | --- |
| `email` | The profile email, starting with the term, ignoring case |
| `firstName`, `lastName` | The profile field, starting with the term, ignoring case. When the field is empty, a word of the display name starting with the term |
| `guid` | The identity subject `<guid>@<identity provider>` |

### css-v1

Looks people up through the CSS API with the team's CSS API account.

| Identity provider | CSS lookup | Filters |
| --- | --- | --- |
| `azureidir` | `azure-idir` | email, firstName, lastName, guid |
| `idir` | `idir` | email, firstName, lastName, guid |
| `bceidbusiness` | `business-bceid` | guid |

| Setting | Value |
| --- | --- |
| `PLUGIN_CSS_V1_API_BASE_URL` | CSS API URL including `/api/v1` |
| `PLUGIN_CSS_V1_ENVIRONMENT` | CSS environment searched: `dev`, `test` or `prod`; the one matching the SSO realm Soba signs in through, since BCeID accounts differ between them |
| `PLUGIN_CSS_V1_TOKEN_URL` | OAuth token endpoint |
| `PLUGIN_CSS_V1_CLIENT_ID`, `PLUGIN_CSS_V1_CLIENT_SECRET` | CSS API account credentials |
| `PLUGIN_CSS_V1_TIMEOUT_MS` | Optional budget for the token exchange, the request and its retry |

Readiness checks the token exchange, which does not prove the account may use the lookups.

In Helm, set `backend.config.userSearchPlugins` and `backend.userSearch.cssV1`. The credentials
come from Vault, which must hold both keys whenever `css-v1` is enabled.

CSS API reference: https://bcgov.github.io/sso-docs/css-application/css-app-api

## Logging

Search filters are names, email addresses and guids. The request log drops the query string on
`/user-search` routes, and outbound HTTP logs and errors carry the URL without its query string.
`user-search-soba` passes the filters to its query as parameters, and the database query log
writes parameters at `debug`. Making a user sends the guid in the request body, which is not
logged; the log line for a new user carries only ids and the identity provider.
