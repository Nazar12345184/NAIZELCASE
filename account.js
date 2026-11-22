import { STEAM_AUTH_URL, SUPABASE_PUBLISHABLE_KEY, supabase } from "./supabase.js";

const loadingCard = document.querySelector("#account-loading");
const loadingMessage = document.querySelector("#account-loading-message");
const accountView = document.querySelector("#account-view");
const guestView = document.querySelector("#account-guest");
const accountStatus = document.querySelector("#account-status");
const signOutButton = document.querySelector("#sign-out");
const linkSteamButton = document.querySelector("#link-steam");
const steamLinkDescription = document.querySelector("#steam-link-description");
const steamTradeForm = document.querySelector("#steam-trade-form");
const steamTradeInput = document.querySelector("#steam-trade-url");
const steamTradeStatus = document.querySelector("#steam-trade-status");
const saveSteamTradeButton = document.querySelector("#save-steam-trade");
const steamProfile = document.querySelector("#steam-profile");
const steamAvatar = document.querySelector("#steam-avatar");
const steamName = document.querySelector("#steam-name");
const steamId = document.querySelector("#steam-id");
const steamProfileLink = document.querySelector("#steam-profile-link");
const steamProfileNote = document.querySelector("#steam-profile-note");

const showError = (error) => {
    const message = error instanceof Error ? error.message : String(error);
    loadingMessage.textContent = `Не вдалося завантажити акаунт: ${message}`;
};

const isValidSteamTradeUrl = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === "https:"
            && url.hostname === "steamcommunity.com"
            && url.pathname === "/tradeoffer/new/"
            && Boolean(url.searchParams.get("partner"))
            && Boolean(url.searchParams.get("token"));
    } catch {
        return false;
    }
};

const loadSteamProfile = async (accessToken) => {
    const response = await fetch(`${STEAM_AUTH_URL}?action=status`, {
        method: "POST",
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({})
    });
    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || "Не вдалося отримати інформацію Steam.");
    }

    if (!result.linked) {
        return;
    }

    linkSteamButton.textContent = "Steam прив’язано";
    linkSteamButton.disabled = true;
    steamLinkDescription.textContent = "Тепер можна входити в цей акаунт через Steam.";
    steamProfile.hidden = false;
    steamName.textContent = result.steam.persona_name || "Публічна інформація недоступна";
    steamId.textContent = `Steam ID: ${result.steam.steam_id}`;
    steamProfileLink.href = result.steam.profile_url;

    if (result.steam.avatar_url) {
        steamAvatar.src = result.steam.avatar_url;
        steamAvatar.hidden = false;
    } else {
        steamProfileNote.textContent = "Аватар недоступний або профіль Steam приватний.";
        steamProfileNote.hidden = false;
    }
};

const loadAccount = async () => {
    try {
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        const steamTokenHash = hashParams.get("steam_token_hash");

        if (steamTokenHash) {
            history.replaceState(null, "", window.location.pathname + window.location.search);
            const { error: verifyError } = await supabase.auth.verifyOtp({
                token_hash: steamTokenHash,
                type: "magiclink"
            });

            if (verifyError) {
                throw verifyError;
            }
        }

        const { data, error } = await supabase.auth.getSession();

        if (error) {
            throw error;
        }

        loadingCard.hidden = true;

        if (!data.session) {
            guestView.hidden = false;
            return;
        }

        const user = data.session.user;
        const accountName = user.user_metadata && user.user_metadata.full_name;
        document.querySelector("#account-name").textContent = accountName || "Користувач";
        document.querySelector("#account-email").textContent = user.email || "";
        const savedTradeUrl = user.user_metadata && user.user_metadata.steam_trade_url;
        if (typeof savedTradeUrl === "string" && isValidSteamTradeUrl(savedTradeUrl)) {
            steamTradeInput.value = savedTradeUrl;
        }
        accountView.hidden = false;

        try {
            await loadSteamProfile(data.session.access_token);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            accountStatus.textContent = `Не вдалося завантажити Steam-профіль: ${message}`;
            accountStatus.hidden = false;
        }

        if (new URLSearchParams(window.location.search).get("steam") === "linked") {
            accountStatus.textContent = "Steam прив’язано до акаунта.";
            accountStatus.hidden = false;
        }

        const steamError = new URLSearchParams(window.location.search).get("steamError");
        if (steamError) {
            const messages = {
                steam_already_linked: "Цей Steam-акаунт уже прив’язаний до іншого акаунта.",
                steam_email_required: "Додай email до акаунта, перш ніж прив’язувати Steam."
            };
            accountStatus.textContent = messages[steamError] || "Не вдалося прив’язати Steam. Спробуй ще раз.";
            accountStatus.hidden = false;
        }
    } catch (error) {
        showError(error);
    }
};

steamTradeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const tradeUrl = steamTradeInput.value.trim();

    if (tradeUrl && !isValidSteamTradeUrl(tradeUrl)) {
        steamTradeStatus.textContent = "Встав коректне Steam Trade URL з steamcommunity.com.";
        steamTradeStatus.hidden = false;
        return;
    }

    saveSteamTradeButton.disabled = true;
    steamTradeStatus.textContent = "Зберігаємо посилання…";
    steamTradeStatus.hidden = false;

    try {
        const { error } = await supabase.auth.updateUser({
            data: { steam_trade_url: tradeUrl || null }
        });

        if (error) {
            throw error;
        }

        steamTradeStatus.textContent = tradeUrl
            ? "Трейд-посилання збережено."
            : "Трейд-посилання видалено.";
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        steamTradeStatus.textContent = `Не вдалося зберегти трейд-посилання: ${message}`;
    } finally {
        saveSteamTradeButton.disabled = false;
    }
});

linkSteamButton.addEventListener("click", async () => {
    linkSteamButton.disabled = true;
    accountStatus.hidden = false;
    accountStatus.textContent = "Підключаємо Steam…";

    try {
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (sessionError) {
            throw sessionError;
        }
        if (!data.session) {
            throw new Error("Спочатку увійди у свій акаунт.");
        }

        const response = await fetch(`${STEAM_AUTH_URL}?action=start&flow=link`, {
            method: "POST",
            headers: {
                apikey: SUPABASE_PUBLISHABLE_KEY,
                Authorization: `Bearer ${data.session.access_token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({})
        });
        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Не вдалося почати прив’язування Steam.");
        }

        window.location.assign(result.url);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        accountStatus.textContent = `Не вдалося прив’язати Steam: ${message}`;
        linkSteamButton.disabled = false;
    }
});

signOutButton.addEventListener("click", async () => {
    signOutButton.disabled = true;

    try {
        const { error } = await supabase.auth.signOut();

        if (error) {
            throw error;
        }

        window.location.assign("profil.html");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        accountStatus.textContent = `Не вдалося вийти: ${message}`;
        accountStatus.hidden = false;
        signOutButton.disabled = false;
    }
});

loadAccount();
