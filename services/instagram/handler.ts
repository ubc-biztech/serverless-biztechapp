import type { APIGatewayEvent, LambdaCallback, LambdaContext } from "../../lib/types";
import { protect, Access } from "../../lib/auth";
import instagramHelpers from "./helpers";

export const refreshTokenManual = protect(Access.ADMIN, async (
  _event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => instagramHelpers.refreshTokenManual());

export const refreshTokenScheduled = async (
  _event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => instagramHelpers.refreshTokenScheduled();

export const getTokenStatus = protect(Access.ADMIN, async (
  _event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => instagramHelpers.getTokenStatus());

export const getAnalytics = protect(Access.ADMIN, async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => instagramHelpers.getAnalytics(event));
