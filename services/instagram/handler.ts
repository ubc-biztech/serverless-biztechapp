import type { APIGatewayEvent, LambdaCallback, LambdaContext } from "../../lib/types";
import instagramHelpers from "./helpers";

export const refreshTokenManual = async (
  _event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => instagramHelpers.refreshTokenManual();

export const refreshTokenScheduled = async (
  _event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => instagramHelpers.refreshTokenScheduled();

export const getTokenStatus = async (
  _event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => instagramHelpers.getTokenStatus();

export const getAnalytics = async (
  event: APIGatewayEvent,
  _ctx: LambdaContext,
  _callback: LambdaCallback,
) => instagramHelpers.getAnalytics(event);
