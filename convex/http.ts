import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { decideHttp } from "./access";
import { oauthCallback as m365OauthCallback } from "./m365";
import { oauthCallback as googleOauthCallback } from "./googleConnect";

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
  handler: m365OauthCallback,
});

http.route({
  path: "/google/callback",
  method: "GET",
  handler: googleOauthCallback,
});

export default http;
