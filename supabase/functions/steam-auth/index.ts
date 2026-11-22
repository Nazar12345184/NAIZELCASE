import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const steamOpenIdUrl = "https://steamcommunity.com/openid/login";
const openIdNamespace = "http://specs.openid.net/auth/2.0";

type SteamFlowState = {
    state: string;
    flow: "login" | "link";
    user_id: string | null;
    site_origin: string;
    expires_at: string;
};

class AuthFlowError extends Error {
    code: string;

    constructor(code: string, message: string) {
        super(message);
        this.code = code;
    }
}

const jsonResponse = (body: unknown, status: number, origin?: string) => {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (origin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type");
        headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
        headers.set("Vary", "Origin");
    }
    return new Response(JSON.stringify(body), { status, headers });
};

const getAllowedOrigins = () =>
    (Deno.env.get("SITE_URLS") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => new URL(value).origin);

const getAllowedOrigin = (value: string | null) => {
    if (!value) {
        throw new AuthFlowError("invalid_site", "The site address is missing.");
    }

    const origin = new URL(value).origin;
    if (!getAllowedOrigins().includes(origin)) {
        throw new AuthFlowError("invalid_site", "This site address is not allowed.");
    }
    return origin;
};

const getAdminClient = () => {
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error("Supabase server credentials are not configured.");
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
};

const randomState = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const getSteamProfileValue = (xml: string, tag: string) => {
    const pattern = new RegExp(
        `<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`
    );
    const match = pattern.exec(xml);
    return (match?.[1] ?? match?.[2] ?? "").trim() || null;
};

const getSteamAvatarUrl = (value: string | null) => {
    if (!value) {
        return null;
    }

    try {
        const url = new URL(value);
        return url.protocol === "https:" && url.hostname.endsWith(".steamstatic.com")
            ? url.toString()
            : null;
    } catch {
        return null;
    }
};

const fetchSteamProfile = async (steamId: string) => {
    const profileUrl = `https://steamcommunity.com/profiles/${steamId}/?xml=1`;
    const response = await fetch(profileUrl, { headers: { Accept: "application/xml" } });
    if (!response.ok) {
        throw new Error(`Steam profile request failed with status ${response.status}.`);
    }

    const xml = await response.text();
    if (!xml.includes("<profile>")) {
        return { persona_name: null, avatar_url: null };
    }

    return {
        persona_name: getSteamProfileValue(xml, "steamID"),
        avatar_url: getSteamAvatarUrl(getSteamProfileValue(xml, "avatarFull"))
    };
};

const buildSteamLoginUrl = (state: string) => {
    const callback = new URL(`${supabaseUrl}/functions/v1/steam-auth`);
    callback.searchParams.set("action", "callback");
    callback.searchParams.set("state", state);

    const params = new URLSearchParams({
        "openid.ns": openIdNamespace,
        "openid.mode": "checkid_setup",
        "openid.return_to": callback.toString(),
        "openid.realm": `${supabaseUrl}/`,
        "openid.identity": `${openIdNamespace}/identifier_select`,
        "openid.claimed_id": `${openIdNamespace}/identifier_select`
    });
    return `${steamOpenIdUrl}?${params.toString()}`;
};

const startFlow = async (
    flow: "login" | "link",
    siteOrigin: string,
    userId: string | null
) => {
    const admin = getAdminClient();
    const now = new Date();
    const state = randomState();

    const { error: cleanupError } = await admin
        .from("steam_auth_states")
        .delete()
        .lt("expires_at", now.toISOString());
    if (cleanupError) {
        throw cleanupError;
    }

    const { error } = await admin.from("steam_auth_states").insert({
        state,
        flow,
        user_id: userId,
        site_origin: siteOrigin,
        expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString()
    });
    if (error) {
        throw error;
    }

    return buildSteamLoginUrl(state);
};

const verifySteamAssertion = async (requestUrl: URL, state: string) => {
    const params = requestUrl.searchParams;
    const callback = new URL(`${supabaseUrl}/functions/v1/steam-auth`);
    const returnToValue = params.get("openid.return_to");
    const claimedId = params.get("openid.claimed_id");
    const identity = params.get("openid.identity");

    const assertionChecks = {
        mode: params.get("openid.mode") === "id_res",
        namespace: params.get("openid.ns") === openIdNamespace,
        endpoint: params.get("openid.op_endpoint") === steamOpenIdUrl,
        returnTo: Boolean(returnToValue),
        claimedId: Boolean(claimedId),
        identityMatches: Boolean(claimedId && claimedId === identity)
    };

    if (Object.values(assertionChecks).some((passed) => !passed)) {
        console.error("Steam assertion fields were invalid:", assertionChecks);
        throw new AuthFlowError("steam_invalid_assertion", "Steam returned an invalid sign-in response.");
    }

    const returnTo = new URL(returnToValue);
    if (
        returnTo.origin !== callback.origin ||
        returnTo.pathname !== callback.pathname ||
        returnTo.searchParams.get("action") !== "callback" ||
        returnTo.searchParams.get("state") !== state ||
        returnTo.searchParams.size !== 2
    ) {
        throw new AuthFlowError("steam_invalid_return", "Steam returned to an unexpected address.");
    }

    const steamIdMatch = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimedId);
    if (!steamIdMatch) {
        throw new AuthFlowError("steam_invalid_id", "Steam returned an invalid account identifier.");
    }

    const verificationParams = new URLSearchParams();
    for (const [key, value] of params.entries()) {
        if (key.startsWith("openid.") && key !== "openid.mode") {
            verificationParams.append(key, value);
        }
    }
    verificationParams.set("openid.mode", "check_authentication");

    const response = await fetch(steamOpenIdUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: verificationParams
    });
    const verification = await response.text();

    if (!response.ok || !verification.includes("is_valid:true")) {
        throw new AuthFlowError("steam_verification_failed", "Steam could not verify this sign-in.");
    }

    return steamIdMatch[1];
};

const redirectWithError = (state: SteamFlowState, code: string) => {
    const page = state.flow === "link" ? "account.html" : "profil.html";
    const destination = new URL(page, `${state.site_origin}/`);
    destination.searchParams.set(state.flow === "link" ? "steamError" : "authError", code);
    return Response.redirect(destination.toString(), 303);
};

const handleCallback = async (requestUrl: URL) => {
    const state = requestUrl.searchParams.get("state");
    if (!state) {
        return new Response("Steam sign-in state is missing.", { status: 400 });
    }

    const admin = getAdminClient();
    const { data: flowState, error: stateError } = await admin
        .from("steam_auth_states")
        .select("state, flow, user_id, site_origin, expires_at")
        .eq("state", state)
        .maybeSingle();
    if (stateError) {
        throw stateError;
    }
    if (!flowState || new Date(flowState.expires_at).getTime() < Date.now()) {
        return new Response("Steam sign-in expired. Start again from the site.", { status: 400 });
    }

    try {
        const steamId = await verifySteamAssertion(requestUrl, state);
        const { error: deleteStateError } = await admin
            .from("steam_auth_states")
            .delete()
            .eq("state", state);
        if (deleteStateError) {
            throw deleteStateError;
        }

        if (flowState.flow === "link") {
            const userId = flowState.user_id;
            if (!userId) {
                throw new AuthFlowError("steam_link_user_missing", "The account to link was not found.");
            }

            const { data: userResult, error: userError } = await admin.auth.admin.getUserById(userId);
            if (userError) {
                throw userError;
            }
            if (!userResult.user.email) {
                throw new AuthFlowError("steam_email_required", "Add an email to your account before linking Steam.");
            }

            const { data: existingSteam, error: lookupError } = await admin
                .from("steam_accounts")
                .select("user_id")
                .eq("steam_id", steamId)
                .maybeSingle();
            if (lookupError) {
                throw lookupError;
            }
            if (existingSteam && existingSteam.user_id !== userId) {
                throw new AuthFlowError("steam_already_linked", "This Steam account is already linked to another account.");
            }

            let profile = { persona_name: null as string | null, avatar_url: null as string | null };
            try {
                profile = await fetchSteamProfile(steamId);
            } catch (error) {
                console.error("Could not load public Steam profile:", error);
            }

            if (!existingSteam) {
                const { error: insertError } = await admin
                    .from("steam_accounts")
                    .insert({ steam_id: steamId, user_id: userId, ...profile });
                if (insertError) {
                    if (insertError.code !== "23505") {
                        throw insertError;
                    }

                    const { data: racedSteam, error: racedLookupError } = await admin
                        .from("steam_accounts")
                        .select("user_id")
                        .eq("steam_id", steamId)
                        .maybeSingle();
                    if (racedLookupError || racedSteam?.user_id !== userId) {
                        throw new AuthFlowError("steam_already_linked", "This Steam account is already linked to another account.");
                    }
                }
            } else {
                const { error: updateError } = await admin
                    .from("steam_accounts")
                    .update(profile)
                    .eq("steam_id", steamId);
                if (updateError) {
                    throw updateError;
                }
            }

            const accountUrl = new URL("account.html", `${flowState.site_origin}/`);
            accountUrl.searchParams.set("steam", "linked");
            return Response.redirect(accountUrl.toString(), 303);
        }

        const { data: linkedSteam, error: linkedError } = await admin
            .from("steam_accounts")
            .select("user_id")
            .eq("steam_id", steamId)
            .maybeSingle();
        if (linkedError) {
            throw linkedError;
        }
        if (!linkedSteam) {
            throw new AuthFlowError("steam_not_linked", "Link this Steam account from your NA1ZELCASE account first.");
        }

        const { data: userResult, error: userError } = await admin.auth.admin.getUserById(linkedSteam.user_id);
        if (userError) {
            throw userError;
        }
        if (!userResult.user.email) {
            throw new AuthFlowError("steam_email_required", "The linked account needs an email address to sign in.");
        }

        const accountUrl = new URL("account.html", `${flowState.site_origin}/`);
        const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
            type: "magiclink",
            email: userResult.user.email,
            options: { redirectTo: accountUrl.toString() }
        });
        if (linkError) {
            throw linkError;
        }
        const tokenHash = linkData.properties?.hashed_token;
        if (!tokenHash) {
            throw new Error("Supabase did not return a sign-in token.");
        }

        accountUrl.hash = new URLSearchParams({ steam_token_hash: tokenHash }).toString();
        return Response.redirect(accountUrl.toString(), 303);
    } catch (error) {
        const code = error instanceof AuthFlowError ? error.code : "steam_failed";
        console.error("Steam authentication failed:", error);
        return redirectWithError(flowState as SteamFlowState, code);
    }
};

Deno.serve(async (request) => {
    const requestUrl = new URL(request.url);
    const action = requestUrl.searchParams.get("action");
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
        try {
            const allowedOrigin = getAllowedOrigin(origin);
            return new Response("ok", {
                headers: {
                    "Access-Control-Allow-Origin": allowedOrigin,
                    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
                    "Access-Control-Allow-Methods": "POST, OPTIONS",
                    "Vary": "Origin"
                }
            });
        } catch {
            return new Response("Origin not allowed.", { status: 403 });
        }
    }

    try {
        if (action === "callback" && request.method === "GET") {
            return await handleCallback(requestUrl);
        }

        if (action === "start" && request.method === "GET" && requestUrl.searchParams.get("flow") === "login") {
            const siteOrigin = getAllowedOrigin(requestUrl.searchParams.get("site"));
            const steamUrl = await startFlow("login", siteOrigin, null);
            return Response.redirect(steamUrl, 302);
        }

        if (action === "status" && request.method === "POST") {
            const siteOrigin = getAllowedOrigin(origin);
            const authorization = request.headers.get("authorization") ?? "";
            const accessToken = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
            if (!accessToken) {
                return jsonResponse({ error: "Sign in to view your Steam profile." }, 401, siteOrigin);
            }

            const admin = getAdminClient();
            const { data: userResult, error: userError } = await admin.auth.getUser(accessToken);
            if (userError || !userResult.user) {
                return jsonResponse({ error: "Your session expired. Sign in again." }, 401, siteOrigin);
            }

            const { data: steamAccount, error: steamError } = await admin
                .from("steam_accounts")
                .select("steam_id, persona_name, avatar_url")
                .eq("user_id", userResult.user.id)
                .maybeSingle();
            if (steamError) {
                throw steamError;
            }

            const { data: balanceAccount } = await admin
                .from("user_balances")
                .select("balance")
                .eq("user_id", userResult.user.id)
                .maybeSingle();
            const balance = balanceAccount?.balance ?? 0;

            if (!steamAccount) {
                return jsonResponse({ linked: false, balance }, 200, siteOrigin);
            }

            let profile = {
                persona_name: steamAccount.persona_name,
                avatar_url: steamAccount.avatar_url
            };
            if (!profile.persona_name || !profile.avatar_url) {
                try {
                    profile = await fetchSteamProfile(steamAccount.steam_id);
                    const { error: updateError } = await admin
                        .from("steam_accounts")
                        .update(profile)
                        .eq("steam_id", steamAccount.steam_id);
                    if (updateError) {
                        throw updateError;
                    }
                } catch (error) {
                    console.error("Could not refresh public Steam profile:", error);
                }
            }

            return jsonResponse({
                linked: true,
                balance,
                steam: {
                    steam_id: steamAccount.steam_id,
                    persona_name: profile.persona_name,
                    avatar_url: profile.avatar_url,
                    profile_url: `https://steamcommunity.com/profiles/${steamAccount.steam_id}/`
                }
            }, 200, siteOrigin);
        }

        if (action === "start" && request.method === "POST" && requestUrl.searchParams.get("flow") === "link") {
            const siteOrigin = getAllowedOrigin(origin);
            const authorization = request.headers.get("authorization") ?? "";
            const accessToken = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
            if (!accessToken) {
                return jsonResponse({ error: "Sign in before linking Steam." }, 401, siteOrigin);
            }

            const admin = getAdminClient();
            const { data: userResult, error: userError } = await admin.auth.getUser(accessToken);
            if (userError || !userResult.user) {
                return jsonResponse({ error: "Your session expired. Sign in again." }, 401, siteOrigin);
            }

            const steamUrl = await startFlow("link", siteOrigin, userResult.user.id);
            return jsonResponse({ url: steamUrl }, 200, siteOrigin);
        }

        return new Response("Not found.", { status: 404 });
    } catch (error) {
        console.error("Steam authentication request failed:", error);
        const message = error instanceof Error ? error.message : "Unexpected Steam authentication error.";
        let responseOrigin: string | undefined;
        try {
            responseOrigin = getAllowedOrigin(origin);
        } catch {
            responseOrigin = undefined;
        }
        return jsonResponse({ error: message }, 400, responseOrigin);
    }
});
