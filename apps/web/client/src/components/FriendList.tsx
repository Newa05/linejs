import { useState } from "react";
import type { Friend } from "../types";

interface FriendListProps {
	friends: Friend[];
	onSelect: (mid: string) => void;
	onAddFriend: () => void;
}

export default function FriendList({ friends, onSelect, onAddFriend }: FriendListProps) {
	const [brokenPictures, setBrokenPictures] = useState<Set<string>>(new Set());

	return (
		<div className="flex flex-col">
			<div className="p-3">
				<button
					className="w-full rounded-lg bg-line-500 py-2.5 text-sm font-medium text-white transition-colors hover:bg-line-600 active:bg-line-700 focus:outline-none focus:ring-2 focus:ring-line-300"
					onClick={onAddFriend}
				>
					+ Add friend
				</button>
			</div>
			{friends.length === 0 ? (
				<p className="p-6 text-center text-sm text-gray-400">No friends yet</p>
			) : (
				<ul className="flex flex-col">
					{friends.map((friend) => (
						<li
							key={friend.mid}
							className="flex cursor-pointer items-center gap-3 border-b border-gray-50 px-4 py-3 transition-colors hover:bg-gray-50 active:bg-gray-100"
							onClick={() => onSelect(friend.mid)}
						>
							{friend.pictureUrl && !brokenPictures.has(friend.mid) ? (
								<img
									className="aspect-square h-12 w-12 shrink-0 rounded-full object-cover"
									src={friend.pictureUrl}
									alt=""
									onError={() =>
										setBrokenPictures((prev) => {
											const next = new Set(prev);
											next.add(friend.mid);
											return next;
										})
									}
								/>
							) : (
								<div className="aspect-square h-12 w-12 shrink-0 rounded-full bg-gradient-to-br from-gray-200 to-gray-300" />
							)}
							<div className="min-w-0 flex-1">
								<div className="truncate text-sm font-semibold text-gray-900">{friend.name}</div>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
