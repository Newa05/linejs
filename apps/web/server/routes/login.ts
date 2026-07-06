import { Hono } from "hono";
import { upgradeWebSocket } from "hono/deno";
import {
	ensureLoginStarted,
	getReadyMessageIfLoggedIn,
	handleLoginClientMessage,
	registerLoginSocket,
	unregisterLoginSocket,
} from "../session.ts";

const app = new Hono();

app.get(
	"/api/login/ws",
	upgradeWebSocket(() => ({
		onOpen(_evt, ws) {
			registerLoginSocket(ws);
			const ready = getReadyMessageIfLoggedIn();
			if (ready) {
				ws.send(JSON.stringify(ready));
			} else {
				ensureLoginStarted();
			}
		},
		onMessage(evt) {
			handleLoginClientMessage(evt.data);
		},
		onClose(_evt, ws) {
			unregisterLoginSocket(ws);
		},
	})),
);

export default app;
