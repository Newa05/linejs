// Types mirroring the REST/WebSocket API contract shared with apps/web/server/.

export interface Profile {
	mid: string;
	displayName: string;
	statusMessage: string;
	pictureUrl?: string;
}

export interface Friend {
	mid: string;
	name: string;
	pictureUrl?: string;
}

export type ChatType = "friend" | "group";

export interface Chat {
	mid: string;
	name: string;
	type: ChatType;
	unreadCount: number;
	lastMessageText?: string;
	pictureUrl?: string;
}

export interface CallInfo {
	kind: "audio" | "video" | "unknown";
	durationSec: number;
	result: string;
}

export interface Message {
	id: string;
	from: string;
	fromName: string;
	text: string;
	isMine: boolean;
	contentType: string;
	createdTime: number;
	mediaUrl?: string;
	call?: CallInfo;
}

// REST response shapes

export interface SessionResponse {
	loggedIn: boolean;
	profile?: Profile;
}

export interface FriendsResponse {
	friends: Friend[];
}

export type AddFriendResponse = { ok: true; mid: string } | { ok: false; error: string };

export interface ChatsResponse {
	chats: Chat[];
}

export interface MessagesResponse {
	messages: Message[];
}

export type SendMessageResponse = { ok: true } | { ok: false; error: string };

export type MarkReadResponse = { ok: true } | { ok: false; error: string };

// WebSocket message unions

export type LoginSocketMessage =
	| { type: "qr"; url: string }
	| { type: "pin"; code: string }
	| { type: "ready"; profile: Profile }
	| { type: "expired" }
	| { type: "error"; message: string };

export type LoginSocketClientMessage = { type: "retry" };

export type EventSocketMessage = {
	type: "message";
	chatMid: string;
	message: Message;
};
