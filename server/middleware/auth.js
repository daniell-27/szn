import jwt from "jsonwebtoken";

const DEFAULT_DEV_SECRET = "dev-insecure-secret-change-me";
export const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_DEV_SECRET;
const COOKIE = "szn_token";

// Never run production with the insecure default (tokens would be forgeable).
if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || JWT_SECRET === DEFAULT_DEV_SECRET)) {
  throw new Error("JWT_SECRET must be set to a strong random value in production.");
}

export function issueToken(res, user) {
  const token = jwt.sign({ uid: user.id || user._id }, JWT_SECRET, { expiresIn: "30d" });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearToken(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

// Gate a route: populates req.userId or 401s.
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE];
  if (!token) return res.status(401).json({ error: "Not signed in." });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.uid;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}
