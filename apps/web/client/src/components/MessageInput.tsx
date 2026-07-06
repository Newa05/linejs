import { useState } from "react";
import type { KeyboardEvent } from "react";

interface MessageInputProps {
	onSend: (text: string) => void;
}

export default function MessageInput({ onSend }: MessageInputProps) {
	const [value, setValue] = useState("");

	const handleSend = () => {
		const trimmed = value.trim();
		if (!trimmed) return;
		onSend(trimmed);
		setValue("");
	};

	const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			e.preventDefault();
			handleSend();
		}
	};

	return (
		<div className="flex items-center gap-2 border-t border-gray-100 bg-white px-4 py-3">
			<input
				type="text"
				value={value}
				placeholder="Type a message..."
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={handleKeyDown}
				className="min-w-0 flex-1 rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-line-300 focus:outline-none focus:ring-2 focus:ring-line-300"
			/>
			<button
				onClick={handleSend}
				className="shrink-0 rounded-full bg-line-500 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-line-600 focus:outline-none focus:ring-2 focus:ring-line-300"
			>
				Send
			</button>
		</div>
	);
}
