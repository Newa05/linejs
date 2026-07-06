import { Hono } from "hono";
import {
	getChatMessages,
	getChats,
	getMessageMedia,
	markChatRead,
	sendChatMessage,
} from "../session.ts";

const app = new Hono();

app.get("/api/chats", async (c) => {
	const chats = await getChats();
	return c.json({ chats });
});

app.get("/api/chats/:mid/messages", async (c) => {
	const mid = c.req.param("mid");
	const limitParam = Number.parseInt(c.req.query("limit") ?? "30", 10);
	const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 30;
	const messages = await getChatMessages(mid, limit);
	return c.json({ messages });
});

app.post("/api/chats/:mid/messages", async (c) => {
	const mid = c.req.param("mid");
	const body = await c.req.json().catch(() => null) as { text?: unknown } | null;
	const text = typeof body?.text === "string" ? body.text : "";
	if (!text) {
		return c.json({ ok: false, error: "text is required" });
	}
	const result = await sendChatMessage(mid, text);
	return c.json(result);
});

app.post("/api/chats/:mid/read", async (c) => {
	const mid = c.req.param("mid");
	const result = await markChatRead(mid);
	return c.json(result);
});

// LINE's OBS download doesn't reliably set Blob.type, so sniff the magic
// bytes instead of trusting it -- verified live: a real downloaded image
// came back as a valid JPEG on disk but with blob.type empty.
function sniffImageContentType(bytes: Uint8Array): string | null {
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	if (
		bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
	) {
		return "image/png";
	}
	if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
		return "image/gif";
	}
	if (
		bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
		bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
	) {
		return "image/webp";
	}
	return null;
}

app.get("/api/chats/:mid/media/:messageId", async (c) => {
	// :mid isn't needed to look anything up (the media cache is keyed by
	// messageId alone) -- kept in the URL for a nicer REST-ish shape.
	const messageId = c.req.param("messageId");
	const preview = c.req.query("preview") === "true";
	try {
		const result = await getMessageMedia(messageId, preview);
		if (!result) {
			return c.json({ ok: false, error: "Message not found" }, 404);
		}
		const { blob } = result;
		const buffer = await blob.arrayBuffer();
		const contentType = blob.type ||
			sniffImageContentType(new Uint8Array(buffer)) ||
			"application/octet-stream";
		return c.body(buffer, 200, { "Content-Type": contentType });
	} catch (e) {
		console.error(`[chats] failed to fetch media for message ${messageId}:`, e);
		return c.json(
			{ ok: false, error: e instanceof Error ? e.message : String(e) },
			500,
		);
	}
});

export default app;
