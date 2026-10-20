import jwt from "jsonwebtoken";
import { HttpError } from "./HttpError.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONGO_ID_RE = /^[0-9a-f]{24}$/;

function verifyAuthToken(token) {
  if (!process.env.JWT_SECRET) throw new Error("JWT Secret is not set.");

  let payload;

  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch (error) {
    throw new HttpError(401, "Your login has expired. Please login again.");
  }

  const userId = String(
    payload.sub ?? payload.id ?? payload.userId ?? "",
  ).toLowerCase();
  if (!MONGO_ID_RE.test(userId))
    throw new HttpError(401, "Invalid login token.");
  return userId;
}

export function getIdentity(req) {
  const authorization = req.get("authorization");

  if (authorization) {
    if (!authorization.startsWith("Bearer ")) {
      throw new HttpError(401, "Authorization header must be: Bearer <TOKEN>");
    }
    return {
      type: "account",
      userId: verifyAuthToken(authorization.slice(7).trim()),
    };
  }

  const anonymousUserId = req.get("x-anonymous-id");
  if (anonymousUserId && UUID_RE.test(anonymousUserId)) {
    return { type: "guest", anonymousUserId: anonymousUserId.toLowerCase() };
  }

  throw new HttpError(
    400,
    "Send a login token, or x-anonymous-id header containing a UUID.",
  );
}

export function getOptionalIdentity(req) {
  return req.get("authorization") || req.get("x-anonymous-id")
    ? getIdentity(req)
    : null;
}
