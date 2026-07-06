import { Hono } from "hono";
import { cors } from "hono/cors";
import { boot } from "./session.ts";
import loginRoutes from "./routes/login.ts";
import sessionRoutes from "./routes/session.ts";
import friendsRoutes from "./routes/friends.ts";
import chatsRoutes from "./routes/chats.ts";
import eventsRoutes from "./routes/events.ts";

const app = new Hono();

app.use(
	"/api/*",
	cors({
		origin: "http://localhost:5173",
	}),
);

app.route("/", loginRoutes);
app.route("/", sessionRoutes);
app.route("/", friendsRoutes);
app.route("/", chatsRoutes);
app.route("/", eventsRoutes);

// Auto-login from a cached token, if present. Does NOT start an
// interactive QR flow (see session.ts's boot() docs) — that only starts
// once a client opens /api/login/ws.
await boot();

const port = 8787;
console.log(`[web/server] listening on http://localhost:${port}`);
Deno.serve({ port }, app.fetch);
