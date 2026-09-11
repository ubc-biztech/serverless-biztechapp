# judging

Backs the HelloHacks judging portal (`ubc-biztech/bt-judging`): settings, rubric, teams, judges, reviews
and links for one event, with code-based login for judges and teams.

**This service is generated.** Its routes, auth rules, input/output validation and error statuses come
from the ontology in [`ubc-biztech/sdk`](https://github.com/ubc-biztech/sdk)
(`src/ontology/entities/judging.ts`) via `@ubc-biztech/sdk/server/judging`. This directory holds the
business logic and storage, the same split as the other services minus the hand-written routing:

| File | Role |
|---|---|
| `handler.ts` | binds the generated router to `JudgingImpl`; one function on `ANY /judging/{proxy+}` |
| `impl.ts` | the `Impl` interface the SDK generates: one method per declared action |
| `store.ts` | `lib/db` calls, behind a four-method interface so tests run in memory |
| `constants.ts` | table name (from `constants/tables.js`), sort-key prefixes, code alphabet |
| `local.ts` | run the real router + impl on localhost with a file-backed store |

Not to be confused with the older five-metric judging flow in `services/teams` (`bizJudge`,
`bizFeedback`, `scripts/migratePartnerRegistrationsToJudges.js`), exposed by the SDK as `bt.legacyJudge`.
The two do not share tables; that flow is keyed by judge email and `teamID;round` and has no rubric,
settings or team codes.

## Table

`biztechJudging${ENVIRONMENT}` (constant `JUDGING_EVENTS_TABLE`), keyed like the rest of the repo:

```
id = "<eventID>;<year>"        the event partition
sk = SETTINGS | RUBRIC | TEAM#<id> | JUDGE#<id> | REVIEW#<round>__<teamId>__<judgeId> | LINK#<id> | CODE#<CODE>
```

Rows carry the entity's own id as `recordId`; `strip()` in `impl.ts` maps it back to `id` on the way out.
`CODE#` rows point at the judge or team that owns the code. Created by CloudFormation on first deploy.

## Auth

`Authorization: Bearer <code>`. `impl.authenticate` resolves codes; roles `judgingAdmin > judge > judgingCode`.
`JUDGING_BOOTSTRAP_CODE` (GitHub secret → env) is an organizer code valid for every event on the stage; it
is how an event's first settings get created. Create an admin judge right after and keep the bootstrap
code out of the portal.

## Changing the API

1. Declare the change in `ubc-biztech/sdk`, merge.
2. Bump the pinned commit of `@ubc-biztech/sdk` in the root `package.json`; `npm i --legacy-peer-deps`.
3. `npx tsc -p tsconfig.json` here fails until `impl.ts` has the new method. Write it.
4. `npm test` runs the whole flow through the real router against `MemoryStore`.

Never a new function in `serverless.yml`.

## Local

```sh
npm test                          # in-memory, no AWS
npx tsx local.ts                  # http://localhost:4000, bootstrap code ORG-BOOT
npx serverless package --stage dev
```
