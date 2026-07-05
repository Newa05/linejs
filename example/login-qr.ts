import { BaseClient } from "@evex/linejs/base";
import { FileStorage } from "@evex/linejs/storage";
import qrcodeTerminal from "npm:qrcode-terminal@^0.12.0";

const storage = new FileStorage("./storage.json");
const client = new BaseClient({ device: "ANDROIDSECONDARY", storage });

client.on("qrcall", (url) => {
	console.log("Scan this QR code with the LINE app (Home > Settings > Log in with QR code):\n");
	qrcodeTerminal.generate(url, { small: true }, (qr) => console.log(qr));
	console.log("Or open this URL manually on your phone:", url);
});

client.on("pincall", (pin) => {
	console.log("If scanning doesn't work, enter this PIN in the LINE app instead:", pin);
});

client.on("update:authtoken", (authToken) => storage.set(".auth", authToken));

const cachedToken = await storage.get(".auth");
await client.loginProcess.login(
	typeof cachedToken === "string" ? { authToken: cachedToken } : { qr: true },
);

console.log("Logged in as:", client.profile?.displayName);
