import { useEffect, useRef, useState } from "react";
import { getMessages, markRead, sendMessage } from "../api";
import type { EventSocketMessage, Message } from "../types";
import MessageInput from "./MessageInput";

interface ChatWindowProps {
	chatMid: string;
	lastEvent: EventSocketMessage | null;
}

function formatCallDuration(durationSec: number): string {
	const minutes = Math.floor(durationSec / 60);
	const seconds = durationSec % 60;
	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function ChatWindow({ chatMid, lastEvent }: ChatWindowProps) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [loading, setLoading] = useState(true);
	const [failedMediaIds, setFailedMediaIds] = useState<Set<string>>(new Set());
	const messagesEndRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		getMessages(chatMid)
			.then((res) => {
				if (!cancelled) setMessages(res.messages);
			})
			.catch(() => {
				if (!cancelled) setMessages([]);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		// Fire-and-forget: best-effort read receipt, ignore errors client-side.
		markRead(chatMid);
		return () => {
			cancelled = true;
		};
	}, [chatMid]);

	useEffect(() => {
		if (lastEvent && lastEvent.chatMid === chatMid) {
			setMessages((prev) => [...prev, lastEvent.message]);
		}
	}, [lastEvent, chatMid]);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	const handleSend = (text: string) => {
		const optimisticMessage: Message = {
			id: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
			from: "me",
			fromName: "You",
			text,
			isMine: true,
			contentType: "text",
			createdTime: Date.now(),
		};
		setMessages((prev) => [...prev, optimisticMessage]);
		sendMessage(chatMid, text).catch((err) => {
			console.error("Failed to send message", err);
		});
	};

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
				<div className="flex min-h-full flex-col justify-end gap-3">
					{loading ? (
						<div className="flex flex-1 items-center justify-center text-sm text-gray-400">
							Loading...
						</div>
					) : messages.length === 0 ? (
						<div className="flex flex-1 items-center justify-center text-sm text-gray-400">
							No messages yet
						</div>
					) : (
						messages.map((msg) => {
							const mediaOk = Boolean(msg.mediaUrl) && !failedMediaIds.has(msg.id);
							const isSticker = msg.contentType === "STICKER" && mediaOk;
							const isImage = msg.contentType === "IMAGE" && mediaOk;
							// RICH (a single clickable image) and FLEX (a bubble/carousel
							// card) both resolve to a hero image + a meaningful caption
							// (the LINE-mandated ALT_TEXT, not a placeholder) -- rendered
							// as a bordered "card" rather than a plain chat bubble.
							const isCard = (msg.contentType === "RICH" || msg.contentType === "FLEX") &&
								mediaOk;
							const handleMediaError = () =>
								setFailedMediaIds((prev) => {
									const next = new Set(prev);
									next.add(msg.id);
									return next;
								});

							return (
								<div
									key={msg.id}
									className={
										msg.isMine ? "flex flex-col items-end" : "flex flex-col items-start"
									}
								>
									{!msg.isMine && (
										<div className="mb-1 ml-1 text-xs text-gray-500">{msg.fromName}</div>
									)}
									{isSticker ? (
										<img
											src={msg.mediaUrl}
											alt="Sticker"
											loading="lazy"
											onError={handleMediaError}
											className="h-[140px] w-[140px] max-w-[160px] object-contain"
										/>
									) : isImage ? (
										<img
											src={msg.mediaUrl}
											alt="Photo"
											loading="lazy"
											onError={handleMediaError}
											className="max-h-[280px] max-w-[240px] rounded-lg object-cover"
										/>
									) : isCard ? (
										<div className="max-w-[260px] overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
											<img
												src={msg.mediaUrl}
												alt=""
												loading="lazy"
												onError={handleMediaError}
												className="max-h-[220px] w-full object-cover"
											/>
											{msg.text && (
												<div className="px-3 py-2 text-sm leading-relaxed text-gray-800">
													{msg.text}
												</div>
											)}
										</div>
									) : msg.contentType === "CALL" && msg.call ? (
										<div
											className={
												msg.isMine
													? "flex items-center gap-2.5 rounded-2xl rounded-tr-sm bg-line-500 px-3.5 py-2.5 text-white"
													: "flex items-center gap-2.5 rounded-2xl rounded-tl-sm border border-gray-100 bg-white px-3.5 py-2.5 text-gray-900 shadow-sm"
											}
										>
											<svg
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="1.75"
												strokeLinecap="round"
												strokeLinejoin="round"
												className="h-5 w-5 shrink-0"
											>
												{msg.call.kind === "video" ? (
													<>
														<rect x="2" y="6" width="14" height="12" rx="2" />
														<path d="m16 10 6-3.5v11L16 14" />
													</>
												) : (
													<path d="M3.5 5.5c0-1 .8-1.8 1.8-1.8h1.4c.8 0 1.5.5 1.7 1.3l.9 3a1.8 1.8 0 0 1-.5 1.9l-1.3 1.3a13 13 0 0 0 5.8 5.8l1.3-1.3a1.8 1.8 0 0 1 1.9-.5l3 .9c.8.2 1.3 1 1.3 1.7v1.4c0 1-.8 1.8-1.8 1.8C10.7 21 3 13.3 3.5 5.5Z" />
												)}
											</svg>
											<div className="text-sm leading-tight">
												<div className="font-medium">
													{msg.call.kind === "video" ? "Video call" : "Voice call"}
												</div>
												<div
													className={
														msg.isMine ? "text-xs text-white/80" : "text-xs text-gray-500"
													}
												>
													{msg.call.result === "NORMAL"
														? formatCallDuration(msg.call.durationSec)
														: "No answer"}
												</div>
											</div>
										</div>
									) : (
										<div
											className={
												msg.isMine
													? "max-w-[75%] break-words rounded-2xl rounded-tr-sm bg-line-500 px-3.5 py-2 text-sm leading-relaxed text-white"
													: "max-w-[75%] break-words rounded-2xl rounded-tl-sm border border-gray-100 bg-white px-3.5 py-2 text-sm leading-relaxed text-gray-900 shadow-sm"
											}
										>
											{msg.text}
										</div>
									)}
								</div>
							);
						})
					)}
					<div ref={messagesEndRef} />
				</div>
			</div>
			<MessageInput onSend={handleSend} />
		</div>
	);
}
