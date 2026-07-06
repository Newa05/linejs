import { loginWithAuthToken } from "@evex/linejs";
import { FileStorage } from "@evex/linejs/storage";

const storage = new FileStorage("./storage.json");
const authToken = await storage.get(".auth");
if (typeof authToken !== "string") {
	throw new Error("No cached auth token in storage.json — run login-qr.ts first.");
}

const client = await loginWithAuthToken(authToken, {
	device: "ANDROIDSECONDARY",
	storage,
});

const profile = await client.getMyProfile();
console.log("mid:", profile.mid);
console.log("displayName:", profile.displayName);
console.log("statusMessage:", profile.statusMessage);
console.log("thumbnailUrl:", profile.thumbnailUrl);

const chats = await client.fetchJoinedChats();
console.log(`\nJoined chats (${chats.length}):`);
for (const chat of chats.slice(0, 15)) {
	console.log("-", chat.name ?? chat.mid);
}

const friends = await client.fetchUsers();
console.log(`\nFriends (${friends.length}):`);
for (const friend of friends) {
	console.log("-", friend.raw.targetProfileDetail?.profileName ?? friend.mid);
}
