import { useState } from "react";
import type { FormEvent } from "react";
import { addFriend, addFriendByPhone } from "../api";

interface AddFriendModalProps {
	onClose: () => void;
	onAdded: () => void;
}

type AddMethod = "id" | "phone";

export default function AddFriendModal({ onClose, onAdded }: AddFriendModalProps) {
	const [method, setMethod] = useState<AddMethod>("id");
	const [value, setValue] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		const trimmed = value.trim();
		if (!trimmed || submitting) return;
		setSubmitting(true);
		setResult(null);
		try {
			const res = method === "id" ? await addFriend(trimmed) : await addFriendByPhone(trimmed);
			if (res.ok) {
				setResult({ text: "Friend added!", ok: true });
				setTimeout(onAdded, 600);
			} else {
				setResult({ text: res.error, ok: false });
			}
		} catch {
			setResult({ text: "Failed to add friend.", ok: false });
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
			onClick={onClose}
		>
			<div
				className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="mb-4 text-lg font-semibold text-gray-900">Add friend</h2>
				<div className="mb-3 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm font-medium">
					<button
						type="button"
						onClick={() => {
							setMethod("id");
							setResult(null);
						}}
						className={
							method === "id"
								? "flex-1 rounded-md bg-white py-1.5 text-gray-900 shadow-sm"
								: "flex-1 rounded-md py-1.5 text-gray-500 hover:text-gray-700"
						}
					>
						By ID
					</button>
					<button
						type="button"
						onClick={() => {
							setMethod("phone");
							setResult(null);
						}}
						className={
							method === "phone"
								? "flex-1 rounded-md bg-white py-1.5 text-gray-900 shadow-sm"
								: "flex-1 rounded-md py-1.5 text-gray-500 hover:text-gray-700"
						}
					>
						By phone
					</button>
				</div>
				<form onSubmit={handleSubmit} className="flex flex-col gap-3">
					<input
						type="text"
						placeholder={method === "id" ? "LINE ID" : "Phone number"}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						autoFocus
						className="rounded-lg border border-gray-200 px-3.5 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-line-300 focus:outline-none focus:ring-2 focus:ring-line-300"
					/>
					<div className="flex justify-end gap-2 pt-1">
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={submitting}
							className="rounded-lg bg-line-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-line-600 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{submitting ? "Adding..." : "Add"}
						</button>
					</div>
				</form>
				{result && (
					<p className={result.ok ? "mt-3 text-sm text-line-600" : "mt-3 text-sm text-red-500"}>
						{result.text}
					</p>
				)}
			</div>
		</div>
	);
}
