// Fetch helpers + WebSocket hooks against the /api/* contract.
// All calls use relative paths so the Vite dev proxy (see vite.config.ts) forwards them.

import { useCallback, useEffect, useRef } from "react";
import type {
	AddFriendResponse,
	ChatsResponse,
	EventSocketMessage,
	FriendsResponse,
	LoginSocketMessage,
	MessagesResponse,
	SendMessageResponse,
	SessionResponse,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, init);
	if (!res.ok) {
		throw new Error(`Request to ${path} failed with status ${res.status}`);
	}
	return (await res.json()) as T;
}

const jsonHeaders = { "Content-Type": "application/json" };

export function getSession(): Promise<SessionResponse> {
	return request<SessionResponse>("/api/session");
}

export function getFriends(): Promise<FriendsResponse> {
	return request<FriendsResponse>("/api/friends");
}

export function addFriend(lineId: string): Promise<AddFriendResponse> {
	return request<AddFriendResponse>("/api/friends", {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify({ lineId }),
	});
}

export function addFriendByPhone(phone: string): Promise<AddFriendResponse> {
	return request<AddFriendResponse>("/api/friends/by-phone", {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify({ phone }),
	});
}

export function getChats(): Promise<ChatsResponse> {
	return request<ChatsResponse>("/api/chats");
}

export function getMessages(chatMid: string, limit = 30): Promise<MessagesResponse> {
	return request<MessagesResponse>(
		`/api/chats/${encodeURIComponent(chatMid)}/messages?limit=${limit}`,
	);
}

export function sendMessage(chatMid: string, text: string): Promise<SendMessageResponse> {
	return request<SendMessageResponse>(`/api/chats/${encodeURIComponent(chatMid)}/messages`, {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify({ text }),
	});
}

export async function markRead(chatMid: string): Promise<void> {
	// Best-effort: never let a failed read-receipt call surface to the UI.
	try {
		await request(`/api/chats/${encodeURIComponent(chatMid)}/read`, { method: "POST" });
	} catch {
		// ignore
	}
}

function wsUrl(path: string): string {
	const protocol = location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${location.host}${path}`;
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10000;

/**
 * Opens /api/login/ws, forwards every parsed message to onMessage, and
 * reconnects with exponential backoff (1s -> 10s cap) until a "ready"
 * message is received, at which point it stops reconnecting entirely.
 * Returns a retry() function that sends {type:"retry"} if the socket is
 * currently open, and is a safe no-op otherwise.
 */
export function useLoginSocket(onMessage: (msg: LoginSocketMessage) => void): () => void {
	const wsRef = useRef<WebSocket | null>(null);
	const onMessageRef = useRef(onMessage);
	onMessageRef.current = onMessage;

	useEffect(() => {
		let cancelled = false;
		let done = false;
		let backoff = INITIAL_BACKOFF_MS;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		function connect() {
			if (cancelled || done) return;
			const ws = new WebSocket(wsUrl("/api/login/ws"));
			wsRef.current = ws;

			ws.onmessage = (event) => {
				let data: LoginSocketMessage;
				try {
					data = JSON.parse(event.data);
				} catch {
					return;
				}
				if (data.type === "ready") {
					done = true;
				}
				onMessageRef.current(data);
			};

			ws.onclose = () => {
				if (cancelled || done) return;
				timeoutId = setTimeout(connect, backoff);
				backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
			};

			ws.onerror = () => {
				ws.close();
			};
		}

		connect();

		return () => {
			cancelled = true;
			if (timeoutId !== undefined) clearTimeout(timeoutId);
			wsRef.current?.close();
		};
	}, []);

	return useCallback(() => {
		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			try {
				ws.send(JSON.stringify({ type: "retry" }));
			} catch {
				// no-op
			}
		}
	}, []);
}

/**
 * Opens /api/events/ws and forwards every parsed message to onMessage,
 * reconnecting with exponential backoff (1s -> 10s cap) for the entire
 * lifetime of the component using it.
 */
export function useEventSocket(onMessage: (msg: EventSocketMessage) => void): void {
	const onMessageRef = useRef(onMessage);
	onMessageRef.current = onMessage;

	useEffect(() => {
		let cancelled = false;
		let backoff = INITIAL_BACKOFF_MS;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		let ws: WebSocket | null = null;

		function connect() {
			if (cancelled) return;
			ws = new WebSocket(wsUrl("/api/events/ws"));

			ws.onmessage = (event) => {
				let data: EventSocketMessage;
				try {
					data = JSON.parse(event.data);
				} catch {
					return;
				}
				onMessageRef.current(data);
			};

			ws.onopen = () => {
				backoff = INITIAL_BACKOFF_MS;
			};

			ws.onclose = () => {
				if (cancelled) return;
				timeoutId = setTimeout(connect, backoff);
				backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
			};

			ws.onerror = () => {
				ws?.close();
			};
		}

		connect();

		return () => {
			cancelled = true;
			if (timeoutId !== undefined) clearTimeout(timeoutId);
			ws?.close();
		};
	}, []);
}
