// Hackathon judging endpoints, generated from the ontology in ubc-biztech/sdk.
// Each export is one Lambda; the matching functions are in serverless.yml (generated block).
import { createHandlers } from "@ubc-biztech/sdk/server/judging";
import judgingImpl from "./judgingHelpers";

export const {
  sessionLogin,
  sessionMe,
  settingsGet,
  settingsSet,
  rubricGet,
  rubricSet,
  teamsList,
  teamsCreate,
  teamGet,
  teamUpdate,
  teamDelete,
  judgesList,
  judgesCreate,
  judgesAutoAssign,
  judgeGet,
  judgeUpdate,
  judgeDelete,
  reviewsList,
  reviewsSubmit,
  reviewGet,
  reviewDelete,
  linksList,
  linksCreate,
  linkDelete
} = createHandlers(judgingImpl);
