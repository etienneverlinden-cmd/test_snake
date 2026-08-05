import { httpRouter } from "convex/server";
import { oauthCallback } from "./google";

const http = httpRouter();

http.route({
  path: "/google/callback",
  method: "GET",
  handler: oauthCallback,
});

export default http;
