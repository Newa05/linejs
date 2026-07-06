import { useCallback, useEffect, useState } from "react";
import { getSession } from "./api";
import Login from "./pages/Login";
import Home from "./pages/Home";
import type { Profile } from "./types";

type SessionState =
	| { status: "loading" }
	| { status: "loggedOut" }
	| { status: "loggedIn"; profile: Profile };

export default function App() {
	const [session, setSession] = useState<SessionState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		getSession()
			.then((res) => {
				if (cancelled) return;
				if (res.loggedIn && res.profile) {
					setSession({ status: "loggedIn", profile: res.profile });
				} else {
					setSession({ status: "loggedOut" });
				}
			})
			.catch(() => {
				if (!cancelled) setSession({ status: "loggedOut" });
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleLoggedIn = useCallback((profile: Profile) => {
		setSession({ status: "loggedIn", profile });
	}, []);

	if (session.status === "loading") {
		return (
			<div className="flex h-full w-full items-center justify-center bg-white text-sm text-gray-400">
				Loading...
			</div>
		);
	}

	if (session.status === "loggedIn") {
		return <Home profile={session.profile} />;
	}

	return <Login onLoggedIn={handleLoggedIn} />;
}
