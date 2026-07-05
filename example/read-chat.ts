import { loginWithAuthToken, TalkMessage } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const targetName = Deno.args[0] ?? "น้ำดื่มหงส์ฟ้า";

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

const boxes = await client.base.talk.getMessageBoxes({
	messageBoxListRequest: {},
});
const box = boxes.messageBoxes.find((b) => b.id === friend.mid);
if (!box) {
	throw new Error(`No message history with "${targetName}" yet.`);
}

const messages = await client.base.talk.getPreviousMessagesV2WithRequest({
	request: {
		messageBoxId: box.id,
		endMessageId: box.lastDeliveredMessageId,
		messagesCount: 20,
	},
});

console.log(`--- Last ${messages.length} messages with ${targetName} ---`);
for (const raw of messages) {
	const msg = await TalkMessage.fromRawTalk(raw, client);
	const sender = msg.isMyMessage ? "me" : targetName;
	const content = msg.text ?? `<${msg.raw.contentType}>`;
	console.log(`[${sender}] ${content}`);
}
