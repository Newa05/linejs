import { useCallback, useEffect, useState } from "react";
import { getChats, getFriends, useEventSocket } from "../api";
import AddFriendModal from "../components/AddFriendModal";
import ChatList from "../components/ChatList";
import ChatWindow from "../components/ChatWindow";
import FriendList from "../components/FriendList";
import type { Chat, EventSocketMessage, Friend, Profile } from "../types";

interface HomeProps {
	profile: Profile;
}

type Tab = "chats" | "friends";

export default function Home({ profile }: HomeProps) {
	const [chats, setChats] = useState<Chat[]>([]);
	const [friends, setFriends] = useState<Friend[]>([]);
	const [loading, setLoading] = useState(true);
	const [activeTab, setActiveTab] = useState<Tab>("chats");
	const [selectedChatMid, setSelectedChatMid] = useState<string | null>(null);
	const [showAddFriend, setShowAddFriend] = useState(false);
	const [lastEvent, setLastEvent] = useState<EventSocketMessage | null>(null);
	const [avatarBroken, setAvatarBroken] = useState(false);

	const refreshChats = useCallback(() => {
		getChats()
			.then((res) => setChats(res.chats))
			.catch(() => {
				// keep previous chats on transient failure
			});
	}, []);

	const refreshFriends = useCallback(() => {
		getFriends()
			.then((res) => setFriends(res.friends))
			.catch(() => {
				// keep previous friends on transient failure
			});
	}, []);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		Promise.all([getFriends(), getChats()])
			.then(([friendsRes, chatsRes]) => {
				if (cancelled) return;
				setFriends(friendsRes.friends);
				setChats(chatsRes.chats);
			})
			.catch(() => {
				// leave lists empty; minimal error handling for MVP
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleEvent = useCallback(
		(msg: EventSocketMessage) => {
			setLastEvent(msg);
			refreshChats();
		},
		[refreshChats],
	);

	useEventSocket(handleEvent);

	return (
		<div className="flex h-full w-full min-w-0 bg-white">
			<aside className="flex w-72 min-w-56 shrink-0 flex-col border-r border-gray-200 bg-white">
				<div className="flex items-center gap-3 border-b border-gray-100 px-4 py-4">
					{profile.pictureUrl && !avatarBroken ? (
						<img
							className="aspect-square h-9 w-9 shrink-0 rounded-full object-cover"
							src={profile.pictureUrl}
							alt=""
							onError={() => setAvatarBroken(true)}
						/>
					) : (
						<div className="flex aspect-square h-9 w-9 shrink-0 items-center justify-center rounded-full bg-line-500 text-sm font-semibold text-white">
							{profile.displayName.slice(0, 1).toUpperCase()}
						</div>
					)}
					<div className="min-w-0">
						<strong className="block truncate text-sm font-semibold text-gray-900">
							{profile.displayName}
						</strong>
						{profile.statusMessage && (
							<span className="block truncate text-xs text-gray-400">
								{profile.statusMessage}
							</span>
						)}
					</div>
				</div>
				<div className="flex border-b border-gray-100">
					<button
						className={
							activeTab === "chats"
								? "flex-1 border-b-2 border-line-500 py-3 text-sm font-medium text-line-600 transition-colors hover:bg-line-50 active:bg-line-100"
								: "flex-1 border-b-2 border-transparent py-3 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 active:bg-gray-100"
						}
						onClick={() => setActiveTab("chats")}
					>
						Chats
					</button>
					<button
						className={
							activeTab === "friends"
								? "flex-1 border-b-2 border-line-500 py-3 text-sm font-medium text-line-600 transition-colors hover:bg-line-50 active:bg-line-100"
								: "flex-1 border-b-2 border-transparent py-3 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 active:bg-gray-100"
						}
						onClick={() => setActiveTab("friends")}
					>
						Friends
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{loading ? (
						<p className="p-6 text-center text-sm text-gray-400">Loading...</p>
					) : activeTab === "chats" ? (
						<ChatList chats={chats} onSelect={setSelectedChatMid} />
					) : (
						<FriendList
							friends={friends}
							onSelect={setSelectedChatMid}
							onAddFriend={() => setShowAddFriend(true)}
						/>
					)}
				</div>
			</aside>
			<main className="flex min-w-0 flex-1 flex-col bg-gray-50">
				{selectedChatMid ? (
					<ChatWindow key={selectedChatMid} chatMid={selectedChatMid} lastEvent={lastEvent} />
				) : (
					<div className="flex h-full w-full items-center justify-center text-sm text-gray-400">
						Select a chat to start messaging
					</div>
				)}
			</main>
			{showAddFriend && (
				<AddFriendModal
					onClose={() => setShowAddFriend(false)}
					onAdded={() => {
						refreshFriends();
						setShowAddFriend(false);
					}}
				/>
			)}
		</div>
	);
}
