import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 5173,
		allowedHosts: ["issued-electro-dvds-ing.trycloudflare.com", ".trycloudflare.com"],
		proxy: {
			"/api": {
				target: "http://localhost:8787",
				ws: true,
			},
		},
	},
});
