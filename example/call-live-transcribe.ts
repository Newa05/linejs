import { loginWithAuthToken } from "@evex/linejs";
import { decodeWavSync, PlanetTransport } from "@evex/linejs/call";
import { FileStorage } from "@evex/linejs/storage";

const targetMid = Deno.args[0];
if (!targetMid) {
	throw new Error(
		"Usage: deno run -A example/call-live-transcribe.ts <peer-mid>",
	);
}

const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
if (!DEEPGRAM_API_KEY) {
	throw new Error("Set the DEEPGRAM_API_KEY environment variable first.");
}

const AZURE_SPEECH_KEY = Deno.env.get("AZURE_SPEECH_KEY");
const AZURE_SPEECH_REGION = Deno.env.get("AZURE_SPEECH_REGION");
if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
	throw new Error(
		"Set the AZURE_SPEECH_KEY and AZURE_SPEECH_REGION environment variables first.",
	);
}
const AZURE_TTS_VOICE = Deno.env.get("AZURE_TTS_VOICE") ?? "th-TH-PremwadeeNeural";

// Synthesizes generic TTS speech (not the peer's voice) for `text` and
// returns it already as 48kHz mono PCM, matching what session.sendBuffer
// expects — Azure is the only TTS provider whose REST API can return that
// exact format (riff-48khz-16bit-mono-pcm) as raw bytes, so no resampling
// step is needed before decodeWavSync().
async function synthesizeThaiSpeech(
	text: string,
): Promise<{ samples: Int16Array; sampleRate: number; channels: number }> {
	const escaped = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	const ssml = `<speak version="1.0" xml:lang="th-TH">` +
		`<voice xml:lang="th-TH" name="${AZURE_TTS_VOICE}">${escaped}</voice>` +
		`</speak>`;

	const res = await fetch(
		`https://${AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
		{
			method: "POST",
			headers: {
				"Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY!,
				"Content-Type": "application/ssml+xml",
				"X-Microsoft-OutputFormat": "riff-48khz-16bit-mono-pcm",
				"User-Agent": "linejs-call-live-transcribe",
			},
			body: ssml,
		},
	);
	if (!res.ok) {
		throw new Error(`Azure TTS failed: ${res.status} ${await res.text()}`);
	}
	return decodeWavSync(new Uint8Array(await res.arrayBuffer()));
}

const storage = new FileStorage("./storage.json");
const authToken = await storage.get(".auth");
if (typeof authToken !== "string") {
	throw new Error("No cached auth token in storage.json — run login-qr.ts first.");
}

const client = await loginWithAuthToken(authToken, {
	device: "ANDROIDSECONDARY",
	storage,
});
const me = await client.getMyProfile();

const dgUrl = "wss://api.deepgram.com/v1/listen" +
	"?model=nova-3&language=th&encoding=linear16&sample_rate=48000" +
	"&channels=1&interim_results=true&punctuate=true";
// Browser-style WebSocket can't set an Authorization header, so Deepgram
// accepts the API key via the Sec-WebSocket-Protocol subprotocol instead.
const dg = new WebSocket(dgUrl, ["token", DEEPGRAM_API_KEY]);

await new Promise<void>((resolve, reject) => {
	dg.addEventListener("open", () => resolve(), { once: true });
	dg.addEventListener("error", () => reject(new Error("Deepgram connection failed")), {
		once: true,
	});
});

// Serializes echo-backs so two quick finals can't talk over each other.
let echoQueue = Promise.resolve();

dg.addEventListener("message", (event) => {
	const msg = JSON.parse(event.data as string);
	const transcript = msg.channel?.alternatives?.[0]?.transcript;
	if (!transcript) return;
	console.log(msg.is_final ? "[final]" : "[...]", transcript);
	if (!msg.is_final) return;

	echoQueue = echoQueue.then(async () => {
		try {
			const { samples, sampleRate, channels } = await synthesizeThaiSpeech(
				transcript,
			);
			await session.sendBuffer({ samples, sampleRate, channels });
		} catch (e) {
			console.error("Echo-back failed:", e);
		}
	});
});

const session = client.call.startSession({
	to: targetMid,
	kind: "AUDIO",
	transport: new PlanetTransport({
		localMid: me.mid,
		mediaKeyMode: "audio-reverse-stage",
	}),
});

console.log("Calling", targetMid, "...");
await session.start();
console.log("Connected — transcribing live in Thai (Ctrl+C to hang up).");

for await (const frame of session.received()) {
	dg.send(
		frame.samples.buffer.slice(
			frame.samples.byteOffset,
			frame.samples.byteOffset + frame.samples.byteLength,
		),
	);
}

dg.send(JSON.stringify({ type: "CloseStream" }));
dg.close();
await echoQueue;
await session.end();
