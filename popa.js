import { STEAM_AUTH_URL, SUPABASE_PUBLISHABLE_KEY, supabase } from "./supabase.js";

const registrationForm = document.querySelector("#registration-form");
const loginForm = document.querySelector("#login-form");
const registerTab = document.querySelector("#register-tab");
const loginTab = document.querySelector("#login-tab");
const registerPanel = document.querySelector("#register-panel");
const loginPanel = document.querySelector("#login-panel");
const providerStatus = document.querySelector("#provider-status");

const setAuthMode = (mode) => {
    const showRegistration = mode === "register";
    registerPanel.hidden = !showRegistration;
    loginPanel.hidden = showRegistration;
    registerTab.classList.toggle("is-active", showRegistration);
    loginTab.classList.toggle("is-active", !showRegistration);
    registerTab.setAttribute("aria-selected", String(showRegistration));
    loginTab.setAttribute("aria-selected", String(!showRegistration));
};

registerTab.addEventListener("click", () => setAuthMode("register"));
loginTab.addEventListener("click", () => setAuthMode("login"));

const authError = new URLSearchParams(window.location.search).get("authError");
if (authError) {
    setAuthMode("login");
    providerStatus.textContent = authError === "steam_not_linked"
        ? "Спочатку увійди через пошту, Google або Facebook і прив’яжи Steam у профілі."
        : "Не вдалося увійти через Steam. Спробуй ще раз.";
    providerStatus.hidden = false;
}

if (registrationForm) {
    const nameInput = document.querySelector("#name");
    const emailInput = document.querySelector("#email");
    const passwordInput = document.querySelector("#password");
    const confirmPasswordInput = document.querySelector("#confirm-password");
    const registrationStatus = document.querySelector("#registration-status");
    const submitButton = document.querySelector("#registration-submit");

    const validatePasswordMatch = () => {
        confirmPasswordInput.setCustomValidity(
            confirmPasswordInput.value && confirmPasswordInput.value !== passwordInput.value
                ? "Паролі не збігаються."
                : ""
        );
    };

    passwordInput.addEventListener("input", validatePasswordMatch);
    confirmPasswordInput.addEventListener("input", validatePasswordMatch);

    registrationForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        validatePasswordMatch();

        if (!registrationForm.reportValidity()) {
            return;
        }

        registrationStatus.hidden = false;
        registrationStatus.textContent = "Створюємо акаунт…";
        submitButton.disabled = true;

        try {
            const { data, error } = await supabase.auth.signUp({
                email: emailInput.value.trim(),
                password: passwordInput.value,
                options: {
                    data: {
                        full_name: nameInput.value.trim()
                    },
                    emailRedirectTo: new URL("account.html", window.location.href).toString()
                }
            });

            if (error) {
                throw error;
            }

            if (data.session) {
                window.location.assign("account.html");
                return;
            }

            registrationStatus.textContent =
                "Майже готово! Перевір пошту та підтверди реєстрацію — після цього відкриється акаунт.";
            registrationForm.reset();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            registrationStatus.textContent = `Не вдалося зареєструватися: ${message}`;
        } finally {
            submitButton.disabled = false;
        }
    });
}

if (loginForm) {
    const loginStatus = document.querySelector("#login-status");
    const loginSubmit = document.querySelector("#login-submit");

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        loginStatus.hidden = false;
        loginStatus.textContent = "Входимо…";
        loginSubmit.disabled = true;

        try {
            const { error } = await supabase.auth.signInWithPassword({
                email: document.querySelector("#login-email").value.trim(),
                password: document.querySelector("#login-password").value
            });

            if (error) {
                throw error;
            }

            window.location.assign("account.html");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            loginStatus.textContent = `Не вдалося увійти: ${message}`;
        } finally {
            loginSubmit.disabled = false;
        }
    });
}

document.querySelectorAll("[data-oauth-provider]").forEach((button) => {
    button.addEventListener("click", async () => {
        button.disabled = true;
        providerStatus.hidden = false;
        providerStatus.textContent = `Переходимо до ${button.dataset.oauthProvider}…`;

        try {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: button.dataset.oauthProvider,
                options: {
                    redirectTo: new URL("account.html", window.location.href).toString()
                }
            });

            if (error) {
                throw error;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            providerStatus.textContent = `Не вдалося увійти через ${button.dataset.oauthProvider}: ${message}`;
            button.disabled = false;
        }
    });
});

document.querySelector("#steam-login").addEventListener("click", () => {
    const params = new URLSearchParams({
        action: "start",
        flow: "login",
        site: window.location.origin
    });
    window.location.assign(`${STEAM_AUTH_URL}?${params}`);
});