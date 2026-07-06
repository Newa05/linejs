import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useLoginSocket } from "../api";
import type { LoginSocketMessage, Profile } from "../types";

interface LoginProps {
	onLoggedIn: (profile: Profile) => void;
}

type LoginStatus = "connecting" | "waiting" | "expired" | "error";

export default function Login({ onLoggedIn }: LoginProps) {
	const [qrUrl, setQrUrl] = useState<string | null>(null);
	const [pin, setPin] = useState<string | null>(null);
	const [status, setStatus] = useState<LoginStatus>("connecting");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);

	const handleMessage = useCallback(
		(msg: LoginSocketMessage) => {
			switch (msg.type) {
				case "qr":
					setQrUrl(msg.url);
					setStatus("waiting");
					setErrorMessage(null);
					break;
				case "pin":
					setPin(msg.code);
					break;
				case "ready":
					onLoggedIn(msg.profile);
					break;
				case "expired":
					setStatus("expired");
					break;
				case "error":
					setStatus("error");
					setErrorMessage(msg.message);
					break;
			}
		},
		[onLoggedIn],
	);

	const retry = useLoginSocket(handleMessage);

	useEffect(() => {
		if (qrUrl && canvasRef.current) {
			QRCode.toCanvas(canvasRef.current, qrUrl, (err) => {
				if (err) console.error("Failed to render QR code", err);
			});
		}
	}, [qrUrl]);

	const handleRetry = useCallback(() => {
		setStatus("connecting");
		setErrorMessage(null);
		setQrUrl(null);
		setPin(null);
		retry();
	}, [retry]);

	return (
		<div className="flex h-full w-full items-center justify-center bg-line-50 px-4">
			<div className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl shadow-line-900/5">
				<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-line-500 text-xl font-bold text-white">
					L
				</div>
				<h1 className="mb-6 text-xl font-semibold text-gray-900">Log in to LINE</h1>

				{status === "expired" ? (
					<div className="flex flex-col items-center gap-4 py-6">
						<p className="text-sm text-gray-600">The QR code has expired.</p>
						<button
							onClick={handleRetry}
							className="rounded-full bg-line-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-line-600 focus:outline-none focus:ring-2 focus:ring-line-300"
						>
							Try again
						</button>
					</div>
				) : status === "error" ? (
					<div className="flex flex-col items-center gap-4 py-6">
						<p className="text-sm text-red-500">{errorMessage ?? "Something went wrong."}</p>
						<button
							onClick={handleRetry}
							className="rounded-full bg-line-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-line-600 focus:outline-none focus:ring-2 focus:ring-line-300"
						>
							Try again
						</button>
					</div>
				) : (
					<div className="flex flex-col items-center gap-4">
						<div className="flex h-52 w-52 items-center justify-center rounded-xl border border-gray-200 bg-white p-3">
							{qrUrl ? (
								<canvas ref={canvasRef} className="h-full w-full" />
							) : (
								<p className="text-sm text-gray-400">Connecting...</p>
							)}
						</div>
						{qrUrl && (
							<p className="text-sm text-gray-600">Scan this QR code with your LINE app.</p>
						)}
						{pin && (
							<p className="text-sm text-gray-600">
								If scanning doesn&apos;t work, enter this PIN in your LINE app:{" "}
								<strong className="font-semibold tracking-wide text-gray-900">{pin}</strong>
							</p>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
