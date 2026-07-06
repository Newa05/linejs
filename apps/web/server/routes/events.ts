import { Hono } from "hono";
import { upgradeWebSocket } from "hono/deno";
import { registerEventSocket, unregisterEventSocket } from "../session.ts";

const app = new Hono();

app.get(
	"/api/events/ws",
	upgradeWebSocket(() => ({
		onOpen(_evt, ws) {
			registerEventSocket(ws);
		},
		onClose(_evt, ws) {
			unregisterEventSocket(ws);
		},
	})),
);

export default app;
