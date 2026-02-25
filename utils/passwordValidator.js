// utils/passwordValidator.js
const COMMON_PASSWORDS = new Set([
    "password", "password1", "password123", "123456", "12345678", "123456789",
    "1234567890", "qwerty", "abc123", "monkey", "master", "dragon", "login",
    "princess", "football", "shadow", "sunshine", "trustno1", "iloveyou",
    "batman", "access", "hello", "charlie", "donald", "letmein", "welcome",
    "admin", "passw0rd", "p@ssword", "p@ssw0rd", "qwerty123", "admin123",
]);

const PASSWORD_RULES = {
    MIN_LENGTH: 8,
    MAX_LENGTH: 128,
    HISTORY_COUNT: 3, // prevent reuse of last N passwords
};

/**
 * Validates password complexity rules.
 * Returns { valid: boolean, failures: string[] }
 */
function validatePasswordComplexity(password, email = "") {
    const failures = [];

    if (!password || typeof password !== "string") {
        return { valid: false, failures: ["Password is required"] };
    }

    if (password.length < PASSWORD_RULES.MIN_LENGTH) {
        failures.push(`Must be at least ${PASSWORD_RULES.MIN_LENGTH} characters`);
    }

    if (password.length > PASSWORD_RULES.MAX_LENGTH) {
        failures.push(`Must be at most ${PASSWORD_RULES.MAX_LENGTH} characters`);
    }

    if (!/[A-Z]/.test(password)) {
        failures.push("Must contain at least 1 uppercase letter");
    }

    if (!/[a-z]/.test(password)) {
        failures.push("Must contain at least 1 lowercase letter");
    }

    if (!/[0-9]/.test(password)) {
        failures.push("Must contain at least 1 number");
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
        failures.push("Must contain at least 1 special character");
    }

    // Check against email/username
    if (email) {
        const emailLocal = email.split("@")[0].toLowerCase();
        if (password.toLowerCase().includes(emailLocal) && emailLocal.length > 2) {
            failures.push("Cannot contain your email or username");
        }
    }

    // Check common passwords
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
        failures.push("This password is too common");
    }

    return { valid: failures.length === 0, failures };
}

module.exports = { validatePasswordComplexity, PASSWORD_RULES };
