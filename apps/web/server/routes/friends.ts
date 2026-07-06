import { Hono } from "hono";
import { addFriendByLineId, addFriendByPhone, getFriends } from "../session.ts";

const app = new Hono();

app.get("/api/friends", async (c) => {
	const friends = await getFriends();
	return c.json({ friends });
});

app.post("/api/friends", async (c) => {
	const body = await c.req.json().catch(() => null) as { lineId?: unknown } | null;
	const lineId = typeof body?.lineId === "string" ? body.lineId.trim() : "";
	if (!lineId) {
		return c.json({ ok: false, error: "lineId is required" });
	}
	const result = await addFriendByLineId(lineId);
	return c.json(result);
});

app.post("/api/friends/by-phone", async (c) => {
	const body = await c.req.json().catch(() => null) as { phone?: unknown } | null;
	const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
	if (!phone) {
		return c.json({ ok: false, error: "phone is required" });
	}
	const result = await addFriendByPhone(phone);
	return c.json(result);
});

export default app;
