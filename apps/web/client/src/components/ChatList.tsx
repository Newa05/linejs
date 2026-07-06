import { useState } from "react";
import type { Chat } from "../types";

interface ChatListProps {
	chats: Chat[];
	onSelect: (mid: string) => void;
}

export default function ChatList({ chats, onSelect }: ChatListProps) {
	const [brokenPictures, setBrokenPictures] = useState<Set<string>>(new Set());

	if (chats.length === 0) {
		return <p className="p-6 text-center text-sm text-gray-400">No chats yet</p>;
	}

	return (
		<ul className="flex flex-col">
			{chats.map((chat) => (
				<li
					key={chat.mid}
					className="flex cursor-pointer items-center gap-3 border-b border-gray-50 px-4 py-3 transition-colors hover:bg-gray-50 active:bg-gray-100"
					onClick={() => onSelect(chat.mid)}
				>
					{chat.pictureUrl && !brokenPictures.has(chat.mid) ? (
						<img
							className="aspect-square h-12 w-12 shrink-0 rounded-full object-cover"
							src={chat.pictureUrl}
							alt=""
							onError={() =>
								setBrokenPictures((prev) => {
									const next = new Set(prev);
									next.add(chat.mid);
									return next;
								})
							}
						/>
					) : (
						<div className="aspect-square h-12 w-12 shrink-0 rounded-full bg-gradient-to-br from-gray-200 to-gray-300" />
					)}
					<div className="min-w-0 flex-1">
						<div className="truncate text-sm font-semibold text-gray-900">{chat.name}</div>
						<div className="truncate text-xs text-gray-400">
							{chat.lastMessageText || "No messages yet"}
						</div>
					</div>
					{chat.unreadCount > 0 && (
						<span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-medium text-white">
							{chat.unreadCount}
						</span>
					)}
				</li>
			))}
		</ul>
	);
}
