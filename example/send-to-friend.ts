import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const targetName = Deno.args[0];
const text = Deno.args[1];
if (!targetName || !text) {
	throw new Error(
		'Usage: deno run -A example/send-to-friend.ts "<friend name>" "<message>"',
	);
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

const friends = await client.fetchUsers();
const friend = friends.find((f) =>
	f.raw.targetProfileDetail?.profileName === targetName
);
if (!friend) {
	throw new Error(`Friend named "${targetName}" not found.`);
}

await client.base.talk.sendMessage({ to: friend.mid, text, e2ee: true });
console.log(`Sent to ${targetName}: ${text}`);
