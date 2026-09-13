import type { APIGatewayEvent, LambdaCallback, LambdaContext } from "../../lib/types";
import { protect } from "../../lib/auth";
import instagramHelpers from "./helpers";

export const refreshTokenManual = protect("admin", async (
  _event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => instagramHelpers.refreshTokenManual());

export const refreshTokenScheduled = async (
  _event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => instagramHelpers.refreshTokenScheduled();

export const getTokenStatus = protect("admin", async (
  _event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => instagramHelpers.getTokenStatus());

export const getAnalytics = protect("admin", async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => instagramHelpers.getAnalytics(event));
