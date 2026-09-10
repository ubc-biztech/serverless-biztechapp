# judging

The judging service behind `bt.judging(eventID, year)` in `@ubc-biztech/sdk`. **Generated.**

| What | Where it comes from |
|---|---|
| Routes, auth rules, input/output validation, error statuses | `@ubc-biztech/sdk/server/judging` — generated from `ubc-biztech/sdk/src/ontology/entities/judging.ts` |
| Business logic | `impl.ts` here, implementing the generated `Impl` interface |
| Storage | `store.ts` — one DynamoDB table, one partition per event, key-value with prefix listing |
| HTTP entry | `handler.ts` — three lines binding the two together |

## Changing the API

1. Declare the change in `ubc-biztech/sdk` (`src/ontology/entities/judging.ts`), run its `npm run check`, merge.
2. Bump the pinned commit in this repo's root `package.json` (`@ubc-biztech/sdk`) and `npm i --legacy-peer-deps`.
3. `npx tsc -p tsconfig.json` here fails until every new action has a method in `impl.ts`. Write it.
4. `npm test` here runs the whole flow through the real router with an in-memory store.

You never touch `serverless.yml` for a new endpoint: there is one function on `ANY /judging/{proxy+}` and
the router dispatches by method and path.

## Auth

Nobody here has a BizTech account. Judges and teams log in with codes minted by `judges.create` /
`teams.create` and passed as `Authorization: Bearer <code>`. `impl.authenticate` resolves them.

`JUDGING_BOOTSTRAP_CODE` (env, from the `JUDGING_BOOTSTRAP_CODE` GitHub secret) is an organizer code
that works for every event on the stage. It is how the first `settings.set` for a new event happens.
Create an admin judge (`judges.create { isAdmin: true }`) right after, and keep the bootstrap code out of
the portal.

## Storage layout

```
pk = EVENT#<eventID>#<year>
sk = SETTINGS | RUBRIC | TEAM#<id> | JUDGE#<id> | REVIEW#<round>__<teamId>__<judgeId> | LINK#<id> | CODE#<CODE>
```

`CODE#` rows point at the judge or team that owns the code. Deleting a team or judge deletes its code.

## Local

```sh
npm test                      # in-memory, no AWS
npx serverless package --stage dev
```
