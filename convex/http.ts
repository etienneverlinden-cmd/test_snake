import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { decideHttp } from "./access";

const http = httpRouter();
auth.addHttpRoutes(http);

http.route({
  path: "/access/decide",
  method: "GET",
  handler: decideHttp,
});

export default http;
