/**
 * Session orchestration for the LINE web client backend.
 *
 * Holds the single in-memory Client/BaseClient instance + FileStorage,
 * drives the hand-rolled login flow (see CRITICAL IMPLEMENTATION DETAILS
 * in the task brief for why this can't use loginWithQR/loginWithAuthToken),
 * keeps the WebSocket client registries for /api/login/ws and
 * /api/events/ws, and exposes the getMessageBoxes-driven chat helpers
 * that the route handlers call into.
 *
 * Route files should stay thin; all LINE-protocol logic lives here.
 */

import { fileURLToPath } from "node:url";
import { BaseClient } from "@evex/linejs/base";
import { Client, TalkMessage } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";
import type * as LINETypes from "@evex/linejs-types";

// ---------------------------------------------------------------------------
// Contract types (mirrors the API contract shared with the frontend)
// ---------------------------------------------------------------------------

export interface SessionProfile {
	mid: string;
	displayName: string;
	statusMessage: string;
	pictureUrl?: string;
}

export interface FriendSummary {
	mid: string;
	name: string;
	pictureUrl?: string;
}

export interface ChatSummary {
	mid: string;
	name: string;
	type: "friend" | "group";
	unreadCount: number;
	lastMessageText?: string;
	pictureUrl?: string;
}

export interface CallInfo {
	kind: "audio" | "video" | "unknown";
	durationSec: number;
	/** "NORMAL" (completed), "CANCEL", "REJECT", "NO_ANSWER", "BUSY", or the
	 * raw RESULT/CAUSE value if not one of the recognized ones. */
	result: string;
}

export interface ChatMessage {
	id: string;
	from: string;
	fromName: string;
	text: string;
	isMine: boolean;
	contentType: string;
	createdTime: number;
	/**
	 * STICKER: a direct, public, unauthenticated CDN URL (TalkMessage#getStickerURL()).
	 * IMAGE/VIDEO/AUDIO/FILE: a backend-proxied path (/api/chats/:mid/media/:messageId)
	 * since those require an authenticated fetch or E2EE chunk decryption.
	 * RICH/FLEX: a direct, public, unauthenticated CDN hero image URL.
	 * Absent for all other content types (plain text, CALL, etc).
	 */
	mediaUrl?: string;
	/** Only present when contentType === "CALL" -- parsed call log details. */
	call?: CallInfo;
}

export type LoginWsMessage =
	| { type: "qr"; url: string }
	| { type: "pin"; code: string }
	| { type: "ready"; profile: SessionProfile }
	| { type: "expired" }
	| { type: "error"; message: string };

export type EventWsMessage = {
	type: "message";
	chatMid: string;
	message: ChatMessage;
};

/** Minimal structural type so session.ts doesn't need to import Hono's WSContext type. */
export interface WSLike {
	send(data: string): void;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let client: Client | undefined;
let listenStarted = false;
let loginInFlight: Promise<void> | null = null;

const loginSockets = new Set<WSLike>();
const eventSockets = new Set<WSLike>();

// mid -> display name + picture URL, covering both friends and joined
// group/room chats, plus the signed-in user. Used to hydrate `fromName` /
// chat list names and `pictureUrl` fields.
interface NameCacheEntry {
	name: string;
	pictureUrl?: string;
}

/** Public, unauthenticated CDN host for `picturePath`-style fields (verified live). */
const OBS_CDN_BASE = "https://obs.line-scdn.net";

let nameCache: Map<string, NameCacheEntry> | null = null;
let nameCacheAt = 0;
const NAME_CACHE_TTL_MS = 60_000;

/** In-memory message id -> TalkMessage, backs the media proxy (see getMessageMedia). */
const MAX_MESSAGE_CACHE = 500;
const messageCache = new Map<string, TalkMessage>();

/**
 * Live-session message log, keyed by chat mid. This exists ONLY as a
 * fallback for GROUP/ROOM chats: getMessageBoxes() (used for 1:1 history)
 * never returns group/room boxes at all -- verified live with an explicit
 * high messageBoxCountLimit, zero came back -- and there is no working
 * reverse-paginated history RPC for groups anywhere in the current
 * protocol surface (confirmed via research: the only other candidate,
 * TalkService.sync()'s revision-based operation log, refuses to replay old
 * history once your revision is stale -- the server returns a
 * FullSyncResponse with no operations instead, per LINE's own protocol
 * behavior). So group "history" here is best-effort and only accumulates
 * messages seen live via client.listen() while this server process has
 * been running -- it is empty for a group until a message arrives after
 * boot, and does not survive a server restart. This is a real, documented
 * limitation, not a bug to "fix" further without a different LINE RPC.
 */
const MAX_LIVE_LOG_PER_CHAT = 200;
const liveMessageLog = new Map<string, ChatMessage[]>();

function appendToLiveLog(chatMid: string, message: ChatMessage): void {
	const log = liveMessageLog.get(chatMid) ?? [];
	log.push(message);
	if (log.length > MAX_LIVE_LOG_PER_CHAT) log.shift();
	liveMessageLog.set(chatMid, log);
}

function storagePath(): string {
	return fileURLToPath(new URL("./storage.json", import.meta.url));
}

// ---------------------------------------------------------------------------
// WS registries
// ---------------------------------------------------------------------------

export function registerLoginSocket(ws: WSLike): void {
	loginSockets.add(ws);
}

export function unregisterLoginSocket(ws: WSLike): void {
	loginSockets.delete(ws);
}

export function registerEventSocket(ws: WSLike): void {
	eventSockets.add(ws);
}

export function unregisterEventSocket(ws: WSLike): void {
	eventSockets.delete(ws);
}

function broadcastLogin(msg: LoginWsMessage): void {
	const data = JSON.stringify(msg);
	for (const ws of loginSockets) {
		try {
			ws.send(data);
		} catch (e) {
			console.error("[session] failed to send login WS message:", e);
		}
	}
}

function broadcastEvent(msg: EventWsMessage): void {
	const data = JSON.stringify(msg);
	for (const ws of eventSockets) {
		try {
			ws.send(data);
		} catch (e) {
			console.error("[session] failed to send event WS message:", e);
		}
	}
}

/** Used by routes/login.ts on socket open: if already logged in, the caller sends this immediately. */
export function getReadyMessageIfLoggedIn(): LoginWsMessage | null {
	if (!client?.base.profile) return null;
	return { type: "ready", profile: mapProfile(client.base.profile) };
}

/** Used by routes/login.ts on incoming client WS messages (only `{ type: "retry" }` is defined). */
export function handleLoginClientMessage(raw: unknown): void {
	try {
		const text = typeof raw === "string"
			? raw
			: raw instanceof ArrayBuffer
			? new TextDecoder().decode(raw)
			: String(raw);
		const parsed = JSON.parse(text) as { type?: string };
		if (parsed?.type === "retry") {
			ensureLoginStarted();
		}
	} catch (e) {
		console.error("[session] invalid login WS client message:", e);
	}
}

// ---------------------------------------------------------------------------
// Login orchestration
// ---------------------------------------------------------------------------

function mapProfile(profile: LINETypes.Profile): SessionProfile {
	return {
		mid: profile.mid,
		displayName: profile.displayName,
		statusMessage: profile.statusMessage,
		...(profile.thumbnailUrl ? { pictureUrl: profile.thumbnailUrl } : {}),
	};
}

/**
 * The hand-rolled login flow. Constructs a fresh FileStorage + BaseClient,
 * wires up qrcall/pincall/update:authtoken listeners *before* kicking off
 * login (those events fire during login, not after), then waits for
 * ready(). Works for both the cached-token path (skips straight to ready)
 * and the interactive QR path — call it again after `expired` to retry.
 */
async function runLogin(): Promise<void> {
	const storage = new FileStorage(storagePath());
	const base = new BaseClient({ device: "ANDROIDSECONDARY", storage });

	base.on("qrcall", (url) => {
		broadcastLogin({ type: "qr", url });
	});
	base.on("pincall", (code) => {
		broadcastLogin({ type: "pin", code });
	});
	base.on("update:authtoken", (authToken) => {
		storage.set(".auth", authToken);
	});

	try {
		const cachedToken = await storage.get(".auth");
		await base.loginProcess.login(
			typeof cachedToken === "string" && cachedToken
				? { authToken: cachedToken }
				: { qr: true },
		);
		await base.loginProcess.ready();

		const newClient = new Client(base);
		client = newClient;

		// client.listen() is fire-and-forget internally and must never be
		// called twice in the process lifetime; this block only ever runs
		// on the first successful login.
		if (!listenStarted) {
			listenStarted = true;
			newClient.listen({ talk: true });
			newClient.on("message", (msg) => {
				handleIncomingMessage(msg).catch((e) => {
					console.error("[session] failed to handle incoming message:", e);
				});
			});
		}

		// Warm the name cache in the background; not required for `ready`.
		getNameLookup(true).catch((e) => {
			console.error("[session] initial name-cache warmup failed:", e);
		});

		if (!base.profile) {
			throw new Error("login succeeded but no profile was set");
		}
		broadcastLogin({ type: "ready", profile: mapProfile(base.profile) });
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (/timed out/i.test(message)) {
			broadcastLogin({ type: "expired" });
		} else {
			console.error("[session] login failed:", e);
			broadcastLogin({ type: "error", message });
		}
	}
}

/** Starts a login attempt if one isn't already running and we're not already logged in. */
export function ensureLoginStarted(): void {
	if (client) return;
	if (loginInFlight) return;
	loginInFlight = runLogin().finally(() => {
		loginInFlight = null;
	});
}

/** Checks storage for a cached auth token without starting a BaseClient/login. */
async function hasCachedToken(): Promise<boolean> {
	const storage = new FileStorage(storagePath());
	const token = await storage.get(".auth");
	return typeof token === "string" && token.length > 0;
}

/**
 * Called once at server startup. Auto-logs in from a cached token if one
 * exists; otherwise does nothing and waits for a client to connect to
 * /api/login/ws to kick off interactive QR login (starting the QR flow
 * here with nobody listening would burn the QR session before the
 * frontend could ever show it).
 */
export async function boot(): Promise<void> {
	if (await hasCachedToken()) {
		console.log("[session] cached auth token found, attempting auto-login...");
		await runLogin();
	} else {
		console.log(
			"[session] no cached auth token yet; waiting for a client to open /api/login/ws to start QR login",
		);
	}
}

// ---------------------------------------------------------------------------
// Name lookup cache (friends + joined chats + self)
// ---------------------------------------------------------------------------

async function getNameLookup(force = false): Promise<Map<string, NameCacheEntry>> {
	if (!client) return new Map();
	const now = Date.now();
	if (!force && nameCache && now - nameCacheAt < NAME_CACHE_TTL_MS) {
		return nameCache;
	}
	const map = new Map<string, NameCacheEntry>();
	if (client.base.profile) {
		const profile = client.base.profile;
		map.set(profile.mid, {
			name: profile.displayName,
			// Already a full URL (not a bare picturePath) -- no CDN prefix needed.
			...(profile.thumbnailUrl ? { pictureUrl: profile.thumbnailUrl } : {}),
		});
	}
	try {
		const [users, chats] = await Promise.all([
			client.fetchUsers(),
			client.fetchJoinedChats(),
		]);
		for (const u of users) {
			const picturePath = u.raw.targetProfileDetail?.picturePath;
			map.set(u.mid, {
				name: u.raw.targetProfileDetail?.profileName ?? u.mid,
				...(picturePath ? { pictureUrl: `${OBS_CDN_BASE}${picturePath}` } : {}),
			});
		}
		for (const c of chats) {
			// Chat.raw.picturePath is the same bare-path shape as a contact's
			// picturePath, so the same CDN prefix rule applies (see task's
			// verified fact #1 -- it's phrased generally, not contact-specific).
			const picturePath = c.raw.picturePath;
			map.set(c.mid, {
				name: c.name ?? c.mid,
				...(picturePath ? { pictureUrl: `${OBS_CDN_BASE}${picturePath}` } : {}),
			});
		}
	} catch (e) {
		console.error("[session] failed to refresh name cache:", e);
	}
	nameCache = map;
	nameCacheAt = now;
	return map;
}

/**
 * Fallback resolver for mids not covered by the bulk friends/joined-chats
 * cache above (e.g. an Official Account, or any contact that isn't a
 * mutual friend and isn't a joined-chat member -- verified live that
 * getContactsV3 still resolves those). Resolves only the mids not already
 * present in the cache and merges them in; no separate TTL bookkeeping --
 * once resolved they live in the cache until the next full TTL rebuild.
 */
async function resolveContacts(mids: string[]): Promise<void> {
	if (!client) return;
	const cache = nameCache ?? (nameCache = new Map());
	const missing = [...new Set(mids)].filter((m) => m && !cache.has(m));
	if (missing.length === 0) return;
	try {
		// getContactsV3 rejects requests over 100 targetUsers (see
		// Client#fetchUsers), so batch the same way here.
		for (let i = 0; i < missing.length; i += 100) {
			const batch = missing.slice(i, i + 100);
			const res = await client.base.relation.getContactsV3({ mids: batch });
			for (const r of res.responses) {
				const picturePath = r.targetProfileDetail?.picturePath;
				cache.set(r.targetUserMid, {
					name: r.targetProfileDetail?.profileName ?? r.targetUserMid,
					...(picturePath ? { pictureUrl: `${OBS_CDN_BASE}${picturePath}` } : {}),
				});
			}
		}
	} catch (e) {
		console.error("[session] resolveContacts failed for mids:", missing, e);
	}
}

/**
 * Caches a constructed TalkMessage by message id so the media proxy route
 * can look it up later without re-fetching. Capped at MAX_MESSAGE_CACHE;
 * evicts the oldest entry (Map insertion order) when full.
 */
function cacheTalkMessage(id: string, msg: TalkMessage): void {
	if (!messageCache.has(id) && messageCache.size >= MAX_MESSAGE_CACHE) {
		const oldestKey = messageCache.keys().next().value;
		if (oldestKey !== undefined) messageCache.delete(oldestKey);
	}
	messageCache.set(id, msg);
}

/**
 * Looks up a previously-seen TalkMessage by id and downloads its media
 * bytes (IMAGE/VIDEO/AUDIO/FILE). Returns null if the message id isn't in
 * the cache. Errors from the underlying getData() call are intentionally
 * left to propagate -- the /media route handler catches and turns them
 * into a 500.
 */
export async function getMessageMedia(
	messageId: string,
	preview: boolean,
): Promise<{ blob: Blob } | null> {
	const talkMessage = messageCache.get(messageId);
	if (!talkMessage) return null;
	const blob = await talkMessage.getData(preview);
	return { blob };
}

/**
 * Best-effort hero-image extraction from a LINE Flex Message's FLEX_JSON
 * (a JSON-encoded string, despite TalkMessage#getFlex()'s return type
 * claiming it's already an object -- verified live it's a raw string in
 * contentMetadata, so this parses it directly rather than trusting that
 * method). Handles both a single "bubble" and a "carousel" of bubbles,
 * where the hero is either a bare image or a box wrapping one. Returns
 * undefined on any unexpected shape rather than throwing.
 */
function extractFlexHeroImageUrl(flexJsonStr: string | undefined): string | undefined {
	if (!flexJsonStr) return undefined;
	try {
		const parsed = JSON.parse(flexJsonStr) as Record<string, unknown>;
		const bubble = parsed.type === "carousel"
			? (parsed.contents as Record<string, unknown>[] | undefined)?.[0]
			: parsed;
		const hero = bubble?.hero as Record<string, unknown> | undefined;
		if (hero?.type === "image" && typeof hero.url === "string") return hero.url;
		const heroContents = hero?.contents as Record<string, unknown>[] | undefined;
		const imageContent = heroContents?.find((c) => c.type === "image");
		if (imageContent && typeof imageContent.url === "string") {
			return imageContent.url;
		}
	} catch (e) {
		console.error("[session] failed to parse FLEX_JSON for hero image:", e);
	}
	return undefined;
}

/**
 * Parses a CALL message's contentMetadata into a friendly CallInfo.
 * Verified live shape: { CAUSE, VERSION, SESSION_ID, TYPE, RESULT, DURATION,
 * seq }. TYPE "A" is an audio call (video calls are expected to use a
 * different letter, e.g. "V" -- not yet observed live, so anything other
 * than "A" falls back to "unknown" rather than guessing). RESULT is passed
 * through as-is (e.g. "NORMAL" for a completed call) since only that one
 * value has been observed live -- the frontend should treat any value other
 * than "NORMAL" as a non-completed call rather than needing an exhaustive
 * enum here.
 */
function parseCallInfo(raw: LINETypes.Message): CallInfo {
	const meta = raw.contentMetadata as unknown as Record<string, string> | undefined;
	const kind: CallInfo["kind"] = meta?.TYPE === "A"
		? "audio"
		: meta?.TYPE === "V"
		? "video"
		: "unknown";
	const durationMs = Number(meta?.DURATION ?? 0);
	return {
		kind,
		durationSec: Number.isFinite(durationMs) ? Math.round(durationMs / 1000) : 0,
		result: meta?.RESULT ?? meta?.CAUSE ?? "UNKNOWN",
	};
}

/**
 * Builds the `text`/`mediaUrl`/`call` fields for a message, shared by
 * getChatMessages() and handleIncomingMessage() so STICKER/IMAGE-family/
 * RICH/FLEX/CALL handling only lives in one place. `chatMid` is only used
 * to build the IMAGE-family proxy path.
 */
function buildMediaAndText(
	raw: LINETypes.Message,
	talkMessage: TalkMessage,
	chatMid: string,
): { text: string; mediaUrl?: string; call?: CallInfo } {
	const contentType = raw.contentType;
	const fallbackText = talkMessage.text ?? `<${contentType}>`;

	if (contentType === "STICKER") {
		return { text: fallbackText, mediaUrl: talkMessage.getStickerURL() };
	}
	if (
		contentType === "IMAGE" || contentType === "VIDEO" ||
		contentType === "AUDIO" || contentType === "FILE"
	) {
		return { text: fallbackText, mediaUrl: `/api/chats/${chatMid}/media/${raw.id}` };
	}
	if (contentType === "RICH" || contentType === "FLEX") {
		// Both are LINE "card"-style messages: RICH is a single clickable
		// image (DOWNLOAD_URL), FLEX is a bubble/carousel layout (FLEX_JSON)
		// -- verified live both use fully public, unauthenticated CDN image
		// URLs, so no backend proxy is needed for either, unlike IMAGE/VIDEO.
		const meta = raw.contentMetadata as unknown as Record<string, string> | undefined;
		const text = meta?.ALT_TEXT || fallbackText;
		const mediaUrl = contentType === "RICH"
			? meta?.DOWNLOAD_URL
			: extractFlexHeroImageUrl(meta?.FLEX_JSON);
		return { text, ...(mediaUrl ? { mediaUrl } : {}) };
	}
	if (contentType === "CALL") {
		return { text: fallbackText, call: parseCallInfo(raw) };
	}
	return { text: fallbackText };
}

// ---------------------------------------------------------------------------
// Live events (/api/events/ws)
// ---------------------------------------------------------------------------

async function handleIncomingMessage(msg: TalkMessage): Promise<void> {
	if (!client?.base.profile) return;
	const raw = msg.raw;
	const selfMid = client.base.profile.mid;

	let chatMid: string;
	if (raw.toType === "GROUP" || raw.toType === "ROOM") {
		chatMid = raw.to;
	} else {
		chatMid = raw.from === selfMid ? raw.to : raw.from;
	}

	cacheTalkMessage(raw.id, msg);

	const names = await getNameLookup();
	if (raw.from !== selfMid && !names.has(raw.from)) {
		await resolveContacts([raw.from]);
	}
	const fromName = raw.from === selfMid
		? client.base.profile.displayName
		: names.get(raw.from)?.name ?? raw.from;

	const { text, mediaUrl, call } = buildMediaAndText(raw, msg, chatMid);
	const message: ChatMessage = {
		id: raw.id,
		from: raw.from,
		fromName,
		text,
		isMine: msg.isMyMessage,
		contentType: String(raw.contentType),
		createdTime: Number(raw.createdTime),
		...(mediaUrl ? { mediaUrl } : {}),
		...(call ? { call } : {}),
	};

	// Only groups/rooms need this (see liveMessageLog's doc comment) --
	// 1:1s are already served by getMessageBoxes, no need to duplicate them.
	if (raw.toType === "GROUP" || raw.toType === "ROOM") {
		appendToLiveLog(chatMid, message);
	}

	broadcastEvent({ type: "message", chatMid, message });
}

// ---------------------------------------------------------------------------
// Session info (GET /api/session)
// ---------------------------------------------------------------------------

export function getSessionInfo(): { loggedIn: boolean; profile?: SessionProfile } {
	if (!client?.base.profile) {
		return { loggedIn: false };
	}
	return { loggedIn: true, profile: mapProfile(client.base.profile) };
}

// ---------------------------------------------------------------------------
// Friends (GET/POST /api/friends)
// ---------------------------------------------------------------------------

export async function getFriends(): Promise<FriendSummary[]> {
	if (!client) return [];
	const users = await client.fetchUsers();
	return users.map((u) => {
		const picturePath = u.raw.targetProfileDetail?.picturePath;
		return {
			mid: u.mid,
			name: u.raw.targetProfileDetail?.profileName ?? u.mid,
			...(picturePath ? { pictureUrl: `${OBS_CDN_BASE}${picturePath}` } : {}),
		};
	});
}

export async function addFriendByLineId(
	lineId: string,
): Promise<{ ok: true; mid: string } | { ok: false; error: string }> {
	if (!client) return { ok: false, error: "Not logged in" };
	try {
		const contact = await client.base.talk.findContactByUserid({
			searchId: lineId,
		});
		if (!contact?.mid) {
			return { ok: false, error: `No LINE user found for "${lineId}"` };
		}
		await client.base.relation.addFriendByMid({ mid: contact.mid });
		return { ok: true, mid: contact.mid };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

export async function addFriendByPhone(
	phone: string,
): Promise<{ ok: true; mid: string } | { ok: false; error: string }> {
	if (!client) return { ok: false, error: "Not logged in" };
	try {
		const contacts = await client.base.talk.findContactsByPhone({
			phones: [phone],
		});
		const contact = contacts[phone];
		if (!contact?.mid) {
			return { ok: false, error: `No LINE user found for "${phone}"` };
		}
		await client.base.relation.addFriendByMid({ mid: contact.mid });
		return { ok: true, mid: contact.mid };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

// ---------------------------------------------------------------------------
// Chats (GET /api/chats, messages, send, read)
// ---------------------------------------------------------------------------

export async function getChats(): Promise<ChatSummary[]> {
	if (!client) return [];

	// getMessageBoxes only ever returns "USER" (1:1) boxes in practice --
	// verified live against a real account with an explicit
	// messageBoxCountLimit: 500, zero GROUP/ROOM boxes came back. So group
	// chats have to be supplied separately via fetchJoinedChats() and merged
	// in; they just won't have a real unreadCount/lastMessageText this way
	// (fetchJoinedChats doesn't expose either), which is an acceptable v1 gap.
	const [boxList, groupChats, names] = await Promise.all([
		client.base.talk.getMessageBoxes({
			messageBoxListRequest: {
				withUnreadCount: true,
				lastMessagesPerMessageBoxCount: 1,
			},
		}),
		client.fetchJoinedChats(),
		getNameLookup(),
	]);

	// Resolve anything not already covered by the bulk friends/joined-chats
	// cache (e.g. an Official Account 1:1 box) via the getContactsV3 fallback,
	// batched into a single resolveContacts() call rather than per-box.
	const allIds = [
		...boxList.messageBoxes.map((b) => b.id),
		...groupChats.map((c) => c.mid),
	];
	const missingIds = [...new Set(allIds)].filter((id) => !names.has(id));
	if (missingIds.length > 0) {
		await resolveContacts(missingIds);
	}

	const out: (ChatSummary & { _lastActivity: number })[] = boxList.messageBoxes.map(
		(box) => {
			const type: "friend" | "group" = box.midType === "USER" ? "friend" : "group";
			const cached = names.get(box.id);
			const name = cached?.name ?? box.id;
			const lastMessage = box.lastMessages?.[0];
			return {
				mid: box.id,
				name,
				type,
				unreadCount: Number(box.unreadCount ?? 0),
				...(lastMessage?.text ? { lastMessageText: lastMessage.text } : {}),
				...(cached?.pictureUrl ? { pictureUrl: cached.pictureUrl } : {}),
				_lastActivity: lastMessage ? Number(lastMessage.createdTime) : 0,
			};
		},
	);

	const seen = new Set(out.map((c) => c.mid));
	for (const chat of groupChats) {
		if (seen.has(chat.mid)) continue;
		const cached = names.get(chat.mid);
		// Groups have no server-provided last-activity timestamp (see
		// liveMessageLog's doc comment -- there's no working history RPC for
		// them at all), so use whatever's been seen live this session, if
		// any, purely to place genuinely-active groups above stale ones.
		const liveLog = liveMessageLog.get(chat.mid);
		const lastLive = liveLog?.at(-1);
		out.push({
			mid: chat.mid,
			name: chat.name ?? chat.mid,
			type: "group",
			unreadCount: 0,
			...(lastLive?.text ? { lastMessageText: lastLive.text } : {}),
			...(cached?.pictureUrl ? { pictureUrl: cached.pictureUrl } : {}),
			_lastActivity: lastLive?.createdTime ?? 0,
		});
	}

	// Sort by most-recent activity first (like the real LINE chat list).
	// Groups with no live activity this session (_lastActivity: 0) sort to
	// the bottom, which is the best available signal given the gap above.
	out.sort((a, b) => b._lastActivity - a._lastActivity);
	return out.map(({ _lastActivity: _, ...chat }) => chat);
}

export async function getChatMessages(
	mid: string,
	limit: number,
): Promise<ChatMessage[]> {
	if (!client) return [];
	const boxList = await client.base.talk.getMessageBoxes({
		messageBoxListRequest: {},
	});
	const box = boxList.messageBoxes.find((b) => b.id === mid);
	if (!box) {
		// No message box exists for this mid at all -- always true for
		// GROUP/ROOM chats (see liveMessageLog's doc comment for why: there
		// is no working reverse-history RPC for groups in the current LINE
		// protocol surface). Best-effort fallback: whatever's been observed
		// live via client.listen() since this server process started.
		const log = liveMessageLog.get(mid) ?? [];
		return log.slice(-limit);
	}

	const raws = await client.base.talk.getPreviousMessagesV2WithRequest({
		request: {
			messageBoxId: box.id,
			endMessageId: box.lastDeliveredMessageId,
			messagesCount: limit,
		},
	});

	const names = await getNameLookup();
	const selfMid = client.base.profile?.mid;

	// Resolve any senders not already covered by the bulk cache (e.g. an
	// Official Account) once, up front, instead of per-message.
	const missingFroms = [...new Set(raws.map((r) => r.from))]
		.filter((m) => m !== selfMid && !names.has(m));
	if (missingFroms.length > 0) {
		await resolveContacts(missingFroms);
	}

	const out: ChatMessage[] = [];
	for (const raw of raws) {
		const talkMessage = await TalkMessage.fromRawTalk(raw, client);
		cacheTalkMessage(raw.id, talkMessage);
		const fromName = raw.from === selfMid
			? client.base.profile?.displayName ?? raw.from
			: names.get(raw.from)?.name ?? raw.from;

		const { text, mediaUrl, call } = buildMediaAndText(raw, talkMessage, mid);
		out.push({
			id: raw.id,
			from: raw.from,
			fromName,
			text,
			isMine: talkMessage.isMyMessage,
			contentType: String(raw.contentType),
			createdTime: Number(raw.createdTime),
			...(mediaUrl ? { mediaUrl } : {}),
			...(call ? { call } : {}),
		});
	}
	// getPreviousMessagesV2WithRequest returns newest-first (descending
	// createdTime) -- verified empirically against real timestamps this
	// session. Reverse so the contract's "oldest -> newest" ordering
	// (which the frontend's append-on-send and bottom-anchored scroll both
	// assume) is actually true.
	out.reverse();
	return out;
}

export async function sendChatMessage(
	mid: string,
	text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!client) return { ok: false, error: "Not logged in" };
	try {
		await client.base.talk.sendMessage({ to: mid, text, e2ee: true });
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

/**
 * Best-effort: sendChatChecked's exact runtime semantics (e.g. the
 * `sessionId` field) aren't evidenced anywhere in this repo. Never let a
 * failure here surface to the frontend — log and report ok:true regardless.
 */
export async function markChatRead(
	mid: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (!client) return { ok: true };
	try {
		const boxList = await client.base.talk.getMessageBoxes({
			messageBoxListRequest: {},
		});
		const box = boxList.messageBoxes.find((b) => b.id === mid);
		const lastMessageId = box?.lastDeliveredMessageId?.messageId;
		if (lastMessageId !== undefined && lastMessageId !== null) {
			await client.base.talk.sendChatChecked({
				chatMid: mid,
				lastMessageId: String(lastMessageId),
				seq: await client.base.getReqseq(),
			});
		}
	} catch (e) {
		console.error(`[session] markChatRead(${mid}) failed (non-fatal):`, e);
	}
	return { ok: true };
}
