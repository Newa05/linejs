import { Hono } from "hono";
import { getSessionInfo } from "../session.ts";

const app = new Hono();

app.get("/api/session", (c) => {
	return c.json(getSessionInfo());
});

export default app;
