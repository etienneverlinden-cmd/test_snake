import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { decideHttp } from "./access";
import { oauthCallback } from "./m365";

const http = httpRouter();
auth.addHttpRoutes(http);

http.route({
  path: "/access/decide",
  method: "GET",
  handler: decideHttp,
});

http.route({
  path: "/m365/callback",
  method: "GET",
  handler: oauthCallback,
});

export default http;
