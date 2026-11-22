import { STEAM_AUTH_URL, SUPABASE_PUBLISHABLE_KEY, supabase } from "./supabase.js";

const formatBalance = (balance) => {
    const amount = Number(balance);
    return `${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"} ₴`;
};

const createUserBadge = () => {
    const header = document.querySelector("header");
    if (!header) {
        return null;
    }

    let badge = document.querySelector("#header-user-badge");
    if (!badge) {
        badge = document.createElement("div");
        badge.id = "header-user-badge";
        badge.className = "header-user-badge";
        badge.hidden = true;
        header.append(badge);
    }
    return badge;
};

const loadHeaderUser = async () => {
    const badge = createUserBadge();
    if (!badge) {
        return;
    }

    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
        badge.replaceChildren();
        badge.hidden = true;
        return;
    }

    badge.hidden = false;
    badge.querySelectorAll(".header-avatar").forEach((avatar) => avatar.remove());
    badge.innerHTML = `
        <span class="header-balance">
            <span>Баланс</span>
            <strong>0.00 ₴</strong>
        </span>
    `;

    const balanceElement = badge.querySelector(".header-balance strong");

    try {
        const response = await fetch(`${STEAM_AUTH_URL}?action=status`, {
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
            throw new Error(result.error || "Не вдалося завантажити профіль.");
        }

        balanceElement.textContent = formatBalance(result.balance);

        if (result.linked && result.steam?.avatar_url) {
            badge.querySelectorAll(".header-avatar").forEach((avatar) => avatar.remove());
            const avatar = document.createElement("img");
            avatar.className = "header-avatar";
            avatar.src = result.steam.avatar_url;
            avatar.alt = result.steam.persona_name || "Аватар Steam";
            avatar.referrerPolicy = "no-referrer";
            badge.prepend(avatar);
        }
    } catch (error) {
        console.warn(error);
    }
};

supabase.auth.onAuthStateChange(() => {
    loadHeaderUser();
});

loadHeaderUser();
