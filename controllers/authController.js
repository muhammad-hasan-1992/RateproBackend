// /controllers/authController.js
const User = require("../models/User");
const OTP = require("../models/OTP");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Joi = require("joi");
const sendEmail = require("../utils/sendEmail");
const generateToken = require("../utils/generateToken");
const cloudinary = require("../utils/cloudinary");
const moment = require("moment");
const getBaseURL = require("../utils/getBaseURL");
const Logger = require("../utils/auditLog");
const EmailTemplate = require("../models/EmailTemplate");

// Helper: Generate OTP Code
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

// Validation Schemas
const registerSchema = Joi.object({
    name: Joi.string().min(2).max(50).required().messages({
        "string.min": "Name must be at least 2 characters",
        "string.max": "Name cannot exceed 50 characters",
        "any.required": "Name is required",
    }),
    email: Joi.string().email().required().messages({
        "string.email": "Invalid email format",
        "any.required": "Email is required",
    }),
    password: Joi.string().min(6).required().messages({
        "string.min": "Password must be at least 6 characters",
        "any.required": "Password is required",
    }),
});

const loginSchema = Joi.object({
    email: Joi.string().email().required().messages({
        "string.email": "Invalid email format",
        "any.required": "Email is required",
    }),
    password: Joi.string().required().messages({
        "any.required": "Password is required",
    }),
    source: Joi.string().optional(),
});

const verifyEmailSchema = Joi.object({
    email: Joi.string().email().required(),
    code: Joi.string().length(6).required(),
});

const resendOtpSchema = Joi.object({
    email: Joi.string().email().required(),
    purpose: Joi.string().valid("verify", "reset").required(),
    source: Joi.string().optional(),
});

const forgotPasswordSchema = Joi.object({
    email: Joi.string().email().required(),
});

const verifyResetCodeSchema = Joi.object({
    email: Joi.string().email().required(),
    code: Joi.string().length(6).required(),
});

const resetPasswordSchema = Joi.object({
    email: Joi.string().email().required(),
    code: Joi.string().length(6).required(),
    newPassword: Joi.string().min(6).required(),
});

const updateProfileSchema = Joi.object({
    name: Joi.string().min(2).max(50).optional(),
    phone: Joi.string().pattern(/^\+?\d{10,15}$/).allow("").optional(), // Allow phone with validation
    bio: Joi.string().max(500).allow("").optional(), // Allow bio with max length
    currentPassword: Joi.string().optional(),
    newPassword: Joi.string().min(6).optional(),
}).with("newPassword", "currentPassword");


exports.registerUser = async (req, res, next) => {
    try {
        const { error } = registerSchema.validate(req.body);
        if (error) {
            await Logger.error('registerUser', 'Validation failed', { details: error.details[0].message });
            return res.status(400).json({ message: error.details[0].message });
        }

        const { name, email, password } = req.body;

        const userExists = await User.findOne({ email });
        if (userExists) {
            await Logger.error('registerUser', 'Email already registered', { email });
            return res.status(400).json({ message: "Email already registered" });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const otpCode = generateOTP();
        const expiresAt = moment().add(process.env.OTP_EXPIRE_MINUTES, "minutes").toDate();

        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            role: "user",
            authProvider: "local",
            tenant: null,
            createdBy: null,
            isVerified: false,
        });

        await OTP.create({ email, code: otpCode, expiresAt, purpose: "verify" });

        const baseURL = getBaseURL().public;
        const verificationLink = `${baseURL}/verify-email?code=${otpCode}&email=${email}`;

        // ----------------- Template Email -----------------
        try {
            const template = await EmailTemplate.findOne({ type: "user_Verification", isActive: true });

            if (template) {
                const templateData = {};
                template.variables.forEach(v => {
                    switch (v) {
                        case "notificationSubject": templateData[v] = "Verify Your Email"; break;
                        case "companyName": templateData[v] = "RatePro"; break;
                        case "currentYear": templateData[v] = new Date().getFullYear(); break;
                        case "userName": templateData[v] = name || "User"; break;
                        case "verificationLink": templateData[v] = verificationLink; break;
                        case "otpExpiryMinutes": templateData[v] = process.env.OTP_EXPIRE_MINUTES; break;
                        default: templateData[v] = "";
                    }
                });

                await sendEmail({
                    to: email,
                    subject: "Verify Your Email",
                    templateType: template.type,
                    templateData
                });
            } else {
                // fallback simple email
                await sendEmail({
                    to: email,
                    subject: "Verify Your Email",
                    html: `<p>Hello ${name || "user"},</p><p>Click this link to verify: <a href="${verificationLink}">${verificationLink}</a></p><p>This link/code expires in ${process.env.OTP_EXPIRE_MINUTES} minute(s).</p>`
                });
            }
        } catch (emailError) {
            console.error("❌ Error sending verification email:", emailError);
        }

        await Logger.info('registerUser', 'User registered successfully', { email });
        res.status(201).json({ message: "User registered. Verification link sent to email." });
    } catch (err) {
        console.error("Register user error:", err);
        await Logger.error('registerUser', 'Server error', { message: err.message, stack: err.stack });
        next(err);
    }
};

// Verify Email Link
exports.verifyEmailLink = async (req, res, next) => {
    try {
        const { code, email } = req.query;

        const { error } = verifyEmailSchema.validate({ code, email });
        if (error) {
            await Logger.error('verifyEmailLink', 'Invalid query', { code, email });
            return res.redirect(`${process.env.RATEPRO_URL}/login?message=invalid-otp`);
        }

        const otp = await OTP.findOne({ email, code, purpose: "verify" });
        if (!otp) {
            await Logger.error('verifyEmailLink', 'OTP not found', { code, email });
            return res.redirect(`${process.env.RATEPRO_URL}/login?message=invalid-otp`);
        }

        if (otp.expiresAt < new Date()) {
            await Logger.error('verifyEmailLink', 'OTP expired', { code, email });
            return res.redirect(`${process.env.RATEPRO_URL}/login?message=otp-expired`);
        }

        const user = await User.findOneAndUpdate({ email }, { isVerified: true }, { new: true });
        if (!user) {
            await Logger.error('verifyEmailLink', 'User not found', { email });
            return res.redirect(`${process.env.RATEPRO_URL}/login?message=user-not-found`);
        }

        await OTP.deleteMany({ email, purpose: "verify" });

        const baseURL = ['admin', 'companyAdmin'].includes(user.role) ? process.env.FRONTEND_URL : process.env.RATEPRO_URL;

        const accessToken = generateToken({ id: user._id, role: user.role, tenant: user.tenant, customRoles: user.customRoles }, "access");
        const refreshToken = generateToken({ id: user._id, role: user.role, tenant: user.tenant, customRoles: user.customRoles }, "refresh");

        res.cookie("refreshToken", refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax", maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.cookie("accessToken", accessToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax", maxAge: 1 * 60 * 60 * 1000 });

        await Logger.info('verifyEmailLink', 'Email verified via link', { email });
        return res.redirect(`${baseURL}/app`);
    } catch (err) {
        console.error("Verify email link error:", err);
        await Logger.error('verifyEmailLink', 'Server error', { message: err.message, stack: err.stack });
        return res.redirect(`${process.env.RATEPRO_URL}/login?message=error`);
    }
};

// Verify Email
exports.verifyEmail = async (req, res, next) => {
    try {
        const { error } = verifyEmailSchema.validate(req.body);
        if (error) {
            await Logger.error('verifyEmail', 'Validation failed', { details: error.details[0].message });
            return res.status(400).json({ message: error.details[0].message });
        }

        const { email, code } = req.body;

        const otp = await OTP.findOne({ email, code, purpose: "verify" });
        if (!otp) {
            await Logger.error('verifyEmail', 'Invalid OTP', { email, code });
            return res.status(400).json({ message: "Invalid OTP" });
        }

        if (otp.expiresAt < new Date()) {
            await Logger.error('verifyEmail', 'OTP expired', { email, code });
            return res.status(400).json({ message: "OTP expired. Request a new one." });
        }

        await User.findOneAndUpdate({ email }, { isVerified: true });
        await OTP.deleteMany({ email, purpose: "verify" });

        await Logger.info('verifyEmail', 'Email verified successfully', { email });
        res.status(200).json({ message: "Email verified successfully" });
    } catch (err) {
        console.error("Verify email error:", err);
        await Logger.error('verifyEmail', 'Server error', { message: err.message, stack: err.stack });
        next(err);
    }
};
// Resend OTP
exports.resendOtp = async (req, res, next) => {
    try {
        const { error } = resendOtpSchema.validate(req.body);
        if (error) {
            await Logger.error('resendOtp', 'Validation failed', { details: error.details[0].message });
            return res.status(400).json({ message: error.details[0].message });
        }

        const { email, purpose } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            await Logger.error('resendOtp', 'User not found', { email });
            return res.status(404).json({ message: "User not found" });
        }

        await OTP.deleteMany({ email, purpose });

        const otpCode = generateOTP();
        const expiresAt = moment().add(process.env.OTP_EXPIRE_MINUTES, "minutes").toDate();
        await OTP.create({ email, code: otpCode, expiresAt, purpose });

        // const baseURL = ['admin', 'companyAdmin'].includes(user.role) ? process.env.FRONTEND_URL : process.env.RATEPRO_URL;
        // const emailContent = {
        //     to: email,
        //     subject: purpose === "verify" ? "Verify Your Email" : `OTP Code for ${purpose}`,
        //     html: purpose === "verify"
        //         ? `<p>Your new verification code: <b>${otpCode}</b></p><p>Click: <a href="${baseURL}/verify-email?code=${otpCode}&email=${email}">${baseURL}/verify-email?code=${otpCode}&email=${email}</a></p>`
        //         : `<p>Your OTP Code: ${otpCode}</p>`,
        // };

        // await sendEmail(emailContent);
        const baseURL = ['admin', 'companyAdmin'].includes(user.role) ? process.env.FRONTEND_URL : process.env.RATEPRO_URL;
        const verificationLink = purpose === "verify" ? `${baseURL}/verify-email?code=${otpCode}&email=${email}` : null;

        // ----------------- Template Email -----------------
        try {
            const template = await EmailTemplate.findOne({ type: "otp_Notification", isActive: true });

            if (template) {
                const templateData = {};
                template.variables.forEach(v => {
                    switch (v) {
                        case "notificationSubject": templateData[v] = purpose === "verify" ? "Verify Your Email" : `OTP Code for ${purpose}`; break;
                        case "companyName": templateData[v] = "RatePro"; break;
                        case "currentYear": templateData[v] = new Date().getFullYear(); break;
                        case "userName": templateData[v] = user.name || "User"; break;
                        case "otpCode": templateData[v] = otpCode; break;
                        case "otpExpiryMinutes": templateData[v] = process.env.OTP_EXPIRE_MINUTES; break;
                        case "verificationLink": templateData[v] = verificationLink || ""; break;
                        default: templateData[v] = "";
                    }
                });

                await sendEmail({
                    to: email,
                    subject: templateData.notificationSubject,
                    templateType: template.type,
                    templateData
                });
            } else {
                // fallback simple email
                await sendEmail({
                    to: email,
                    subject: purpose === "verify" ? "Verify Your Email" : `OTP Code for ${purpose}`,
                    html: verificationLink
                        ? `<p>Your new verification code: <b>${otpCode}</b></p><p>Click: <a href="${verificationLink}">${verificationLink}</a></p><p>Expires in ${process.env.OTP_EXPIRE_MINUTES} minute(s).</p>`
                        : `<p>Your OTP Code: <b>${otpCode}</b></p><p>Expires in ${process.env.OTP_EXPIRE_MINUTES} minute(s).</p>`
                });
            }
        } catch (emailError) {
            console.error("❌ Error sending OTP email:", emailError);
        }

        await Logger.info('resendOtp', 'OTP resent successfully', { email, purpose });
        res.status(200).json({ message: "OTP resent to email" });
    } catch (err) {
        console.error('Resend OTP error:', err);
        await Logger.error('resendOtp', 'Server error', { message: err.message, stack: err.stack });
        next(err);
    }
};

// Login User
// exports.loginUser = async (req, res, next) => {
//     try {
//         const { error } = loginSchema.validate(req.body);
//         if (error) {
//             await Logger.error('loginUser', 'Validation failed', { details: error.details[0].message });
//             return res.status(400).json({ message: error.details[0].message });
//         }

//         const { email, password } = req.body;
//         const user = await User.findOne({ email })
//             .select("+password")
//             .populate([
//                 { path: "tenant", select: "name domain isActive createdAt" },
//                 {
//                     path: "customRoles",
//                     select: "name permissions createdAt",
//                     populate: {
//                         path: "permissions",
//                         model: "Permission",
//                         select: "name description group createdAt"
//                     }
//                 }
//             ]);

//         if (!user) {
//             await Logger.error('loginUser', 'User not found', { email });
//             return res.status(404).json({ message: "User not found" });
//         }

//         const isMatch = await bcrypt.compare(password, user.password);
//         if (!isMatch) {
//             await Logger.error('loginUser', 'Invalid password', { email });
//             return res.status(401).json({ message: "Invalid password" });
//         }

//         if (!user.isVerified) {
//             await OTP.deleteMany({ email, purpose: "verify" });

//             const otpCode = generateOTP();
//             const expiresAt = moment().add(process.env.OTP_EXPIRE_MINUTES, "minutes").toDate();
//             await OTP.create({ email, code: otpCode, expiresAt, purpose: "verify" });

//             const baseURL = ["admin", "companyAdmin", "member"].includes(user.role)
//                 ? process.env.FRONTEND_URL
//                 : process.env.RATEPRO_URL;

//             const verificationLink = `${baseURL}/verify-email?code=${otpCode}&email=${email}`;

//             try {
//                 const template = await EmailTemplate.findOne({
//                     type: "verify_Email_On_Login",
//                     isActive: true
//                 });

//                 if (template) {
//                     const templateData = {};
//                     template.variables.forEach(v => {
//                         switch (v) {
//                             case "notificationSubject": templateData[v] = "Verify Your Email"; break;
//                             case "companyName": templateData[v] = "RatePro"; break;
//                             case "currentYear": templateData[v] = new Date().getFullYear(); break;
//                             case "userName": templateData[v] = user.name || "User"; break;
//                             case "verificationLink": templateData[v] = verificationLink; break;
//                             case "otpExpiryMinutes": templateData[v] = process.env.OTP_EXPIRE_MINUTES; break;
//                             case "notificationMessage": templateData[v] = "Please verify your email before logging in."; break;
//                             default: templateData[v] = "";
//                         }
//                     });

//                     await sendEmail({
//                         to: email,
//                         subject: templateData.notificationSubject,
//                         templateType: template.type,
//                         templateData
//                     });
//                 } else {
//                     // fallback simple email
//                     await sendEmail({
//                         to: email,
//                         subject: "Verify Your Email",
//                         html: `<p>Hello ${user.name || "User"},</p>
//                <p>Please verify your email before logging in.</p>
//                <p>Click here: <a href="${verificationLink}">${verificationLink}</a></p>
//                <p>This link expires in ${process.env.OTP_EXPIRE_MINUTES} minute(s).</p>`
//                     });
//                 }
//             } catch (emailError) {
//                 console.error("❌ Error sending verification email:", emailError);
//             }

//             await Logger.error('loginUser', 'Email not verified', { email });
//             return res.status(401).json({
//                 message: "Email not verified. A verification link has been sent to your email.",
//             });
//         }

//         const accessToken = generateToken({ _id: user._id.toString(), role: user.role, tenant: user.tenant?._id.toString(), customRoles: user.customRoles.map(r => r._id.toString()) }, "access");
//         const refreshToken = generateToken({ _id: user._id.toString(), role: user.role }, "refresh");

//         res.cookie("refreshToken", refreshToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax", maxAge: 7 * 24 * 60 * 60 * 1000 });
//         res.cookie("accessToken", accessToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax", maxAge: 30 * 60 * 60 * 1000 });

//         user.lastLogin = Date.now();
//         await user.save();

//         const safeUser = {
//             _id: user._id,
//             name: user.name,
//             email: user.email,
//             role: user.role,
//             customRoles: user.customRoles,
//             authProvider: user.authProvider,
//             bio: user.bio,
//             phone: user.phone,
//             isActive: user.isActive,
//             isVerified: user.isVerified,
//             surveyStats: user.surveyStats,
//             tenant: user.tenant,
//             createdAt: user.createdAt,
//             updatedAt: user.updatedAt,
//             companyProfileUpdated: user.companyProfileUpdated,
//             lastLogin: user.lastLogin,
//         };

//         await Logger.info('loginUser', 'User logged in successfully', { email });
//         res.status(200).json({ accessToken, user: safeUser });
//     } catch (err) {
//         console.error('Login error:', err);
//         await Logger.error('loginUser', 'Server error', { message: err.message, stack: err.stack });
//         next(err);
//     }
// };

exports.loginUser = async (req, res, next) => {
    console.log("\x1b[33m[DEBUG] loginUser CALLED\x1b[0m");
    // Redact password from logs
    const safeBodyForLog = { ...req.body };
    if (safeBodyForLog.password) safeBodyForLog.password = "[REDACTED]";
    console.log("IP:", req.ip || req.headers['x-forwarded-for'] || "unknown");
    console.log("Route params:", req.params);
    console.log("Body (redacted):", safeBodyForLog);
    console.log("Cookies:", req.cookies ? Object.keys(req.cookies) : "none");
    console.log("Headers (subset):", {
        host: req.headers.host,
        referer: req.headers.referer,
        "user-agent": req.headers["user-agent"]
    });

    try {
        const { error } = loginSchema.validate(req.body);
        if (error) {
            console.log("\x1b[31m[DEBUG] loginUser - validation failed\x1b[0m", error.details[0].message);
            await Logger.error('loginUser', 'Validation failed', { details: error.details[0].message });
            return res.status(400).json({ message: error.details[0].message });
        }

        const { email, password } = req.body;
        console.log("\x1b[34m[DEBUG] loginUser - finding user for email:\x1b[0m", email);

        const user = await User.findOne({ email })
            .select("+password")
            .populate([
                { path: "tenant", select: "name domain isActive createdAt" },
                {
                    path: "customRoles",
                    select: "name permissions createdAt",
                    populate: {
                        path: "permissions",
                        model: "Permission",
                        select: "name description group createdAt"
                    }
                }
            ]);

        if (!user) {
            console.log("\x1b[31m[DEBUG] loginUser - user not found\x1b[0m", email);
            await Logger.error('loginUser', 'User not found', { email });
            return res.status(404).json({ message: "User not found" });
        }

        console.log("\x1b[34m[DEBUG] loginUser - user found, checking password\x1b[0m", { userId: user._id.toString(), email: user.email });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            console.log("\x1b[31m[DEBUG] loginUser - invalid password\x1b[0m", { userId: user._id.toString(), email: user.email });
            await Logger.error('loginUser', 'Invalid password', { email });
            return res.status(401).json({ message: "Invalid password" });
        }

        console.log("\x1b[32m[DEBUG] loginUser - password valid\x1b[0m", { userId: user._id.toString() });

        if (!user.isVerified) {
            console.log("\x1b[33m[DEBUG] loginUser - user not verified, creating OTP\x1b[0m", { email });

            await OTP.deleteMany({ email, purpose: "verify" });

            const otpCode = generateOTP();
            const expiresAt = moment().add(process.env.OTP_EXPIRE_MINUTES, "minutes").toDate();
            await OTP.create({ email, code: otpCode, expiresAt, purpose: "verify" });

            console.log("\x1b[33m[DEBUG] OTP created\x1b[0m", { email, otpCode: "[REDACTED]", expiresAt });

            const baseURL = ["admin", "companyAdmin", "member"].includes(user.role)
                ? process.env.FRONTEND_URL
                : process.env.RATEPRO_URL;

            const verificationLink = `${baseURL}/verify-email?code=${otpCode}&email=${email}`;
            console.log("\x1b[33m[DEBUG] verificationLink prepared\x1b[0m", { baseURL });

            try {
                const template = await EmailTemplate.findOne({
                    type: "verify_Email_On_Login",
                    isActive: true
                });

                if (template) {
                    const templateData = {};
                    template.variables.forEach(v => {
                        switch (v) {
                            case "notificationSubject": templateData[v] = "Verify Your Email"; break;
                            case "companyName": templateData[v] = "RatePro"; break;
                            case "currentYear": templateData[v] = new Date().getFullYear(); break;
                            case "userName": templateData[v] = user.name || "User"; break;
                            case "verificationLink": templateData[v] = verificationLink; break;
                            case "otpExpiryMinutes": templateData[v] = process.env.OTP_EXPIRE_MINUTES; break;
                            case "notificationMessage": templateData[v] = "Please verify your email before logging in."; break;
                            default: templateData[v] = "";
                        }
                    });

                    console.log("\x1b[34m[DEBUG] loginUser - sending templated verification email\x1b[0m", { to: email, template: template.type });
                    await sendEmail({
                        to: email,
                        subject: templateData.notificationSubject,
                        templateType: template.type,
                        templateData
                    });
                    console.log("\x1b[32m[DEBUG] loginUser - templated email sent\x1b[0m", { to: email });
                } else {
                    console.log("\x1b[33m[DEBUG] loginUser - template missing, sending fallback email\x1b[0m");
                    await sendEmail({
                        to: email,
                        subject: "Verify Your Email",
                        html: `<p>Hello ${user.name || "User"},</p>
               <p>Please verify your email before logging in.</p>
               <p>Click here: <a href="${verificationLink}">${verificationLink}</a></p>
               <p>This link expires in ${process.env.OTP_EXPIRE_MINUTES} minute(s).</p>`
                    });
                    console.log("\x1b[32m[DEBUG] loginUser - fallback email sent\x1b[0m", { to: email });
                }
            } catch (emailError) {
                console.error("❌ Error sending verification email:", emailError);
            }

            await Logger.error('loginUser', 'Email not verified', { email });
            console.log("\x1b[31m[DEBUG] loginUser - returning 401 email not verified\x1b[0m");
            return res.status(401).json({
                message: "Email not verified. A verification link has been sent to your email.",
            });
        }

        // Generate tokens
        console.log("\x1b[34m[DEBUG] loginUser - generating tokens\x1b[0m");
        const accessToken = generateToken({
            _id: user._id.toString(),
            role: user.role,
            tenant: user.tenant?._id?.toString?.(),
            customRoles: (user.customRoles || []).map(r => r._id.toString())
        }, "access");

        const refreshToken = generateToken({ _id: user._id.toString(), role: user.role }, "refresh");

        // Set cookies
        // res.cookie("refreshToken", refreshToken, {
        //     httpOnly: true,
        //     secure: process.env.NODE_ENV === "production",
        //     sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        //     maxAge: 7 * 24 * 60 * 60 * 1000
        // });
        // res.cookie("accessToken", accessToken, {
        //     httpOnly: true,
        //     secure: process.env.NODE_ENV === "production",
        //     sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        //     maxAge: 30 * 60 * 60 * 1000
        // });

        const isProd = process.env.NODE_ENV === "production";

        const cookieConfig = {
            httpOnly: true,
            secure: isProd,       // Railway uses HTTPS → must be true in prod
            sameSite: isProd ? "none" : "lax", // NONE IS MANDATORY FOR CROSS SITE
            path: "/"
        };

        if (isProd) cookieConfig.domain = ".vercel.app";

        res.cookie("accessToken", accessToken, {
            ...cookieConfig,
            maxAge: 24 * 60 * 60 * 1000,
        });

        res.cookie("refreshToken", refreshToken, {
            ...cookieConfig,
            maxAge: 7 * 24 * 60 * 60 * 1000,
        });
        console.log("\x1b[32m[DEBUG] loginUser - cookies set (tokens hidden)\x1b[0m");

        // Update last login
        user.lastLogin = Date.now();
        await user.save();
        console.log("\x1b[32m[DEBUG] loginUser - user lastLogin updated\x1b[0m", { userId: user._id.toString(), lastLogin: user.lastLogin });

        const safeUser = {
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            customRoles: user.customRoles,
            authProvider: user.authProvider,
            bio: user.bio,
            phone: user.phone,
            isActive: user.isActive,
            isVerified: user.isVerified,
            surveyStats: user.surveyStats,
            tenant: user.tenant,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            companyProfileUpdated: user.companyProfileUpdated,
            lastLogin: user.lastLogin,
        };

        await Logger.info('loginUser', 'User logged in successfully', { email });
        console.log("\x1b[32m[DEBUG] loginUser - success response about to be sent\x1b[0m", { userId: user._id.toString() });

        res.status(200).json({ accessToken, user: safeUser });
    } catch (err) {
        console.error('Login error:', err);
        await Logger.error('loginUser', 'Server error', { message: err.message, stack: err.stack });
        next(err);
    }
};


// Forgot Password
exports.forgotPassword = async (req, res, next) => {
    try {
        const { error } = forgotPasswordSchema.validate(req.body);
        if (error) {
            await Logger.error('forgotPassword', 'Validation failed', { details: error.details[0].message });
            return res.status(400).json({ message: error.details[0].message });
        }

        const { email } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            await Logger.error('forgotPassword', 'User not found', { email });
            return res.status(404).json({ message: "No user with this email" });
        }

        const otpCode = generateOTP();
        const expiresAt = moment().add(process.env.OTP_EXPIRE_MINUTES, "minutes").toDate();

        await OTP.deleteMany({ email, purpose: "reset" });
        await OTP.create({ email, code: otpCode, expiresAt, purpose: "reset" });

        // await sendEmail({
        //     to: email,
        //     subject: "Reset Password OTP",
        //     html: `<p>Your OTP Code to reset password: <b>${otpCode}</b></p>`,
        // });

        try {
            const template = await EmailTemplate.findOne({
                type: "forgot_Password_OTP",
                isActive: true
            });

            const templateData = {};
            if (template) {
                template.variables.forEach(v => {
                    switch (v) {
                        case "notificationSubject": templateData[v] = "Reset Password OTP"; break;
                        case "companyName": templateData[v] = "RatePro"; break;
                        case "currentYear": templateData[v] = new Date().getFullYear(); break;
                        case "userName": templateData[v] = user.name || "User"; break;
                        case "otpCode": templateData[v] = otpCode; break;
                        case "otpExpiryMinutes": templateData[v] = process.env.OTP_EXPIRE_MINUTES; break;
                        case "notificationMessage": templateData[v] = "Your OTP Code to reset password:"; break;
                        default: templateData[v] = "";
                    }
                });

                await sendEmail({
                    to: email,
                    subject: templateData.notificationSubject,
                    templateType: template.type,
                    templateData
                });
            } else {
                // fallback simple email
                await sendEmail({
                    to: email,
                    subject: "Reset Password OTP",
                    html: `<p>Hello ${user.name || "User"},</p>
                 <p>Your OTP Code to reset password: <b>${otpCode}</b></p>
                 <p>This OTP is valid for ${process.env.OTP_EXPIRE_MINUTES} minute(s).</p>`
                });
            }
        } catch (emailError) {
            console.error("❌ Error sending OTP email:", emailError);
        }

        await Logger.info('forgotPassword', 'OTP sent successfully', { email });
        res.status(200).json({ message: "OTP sent for password reset" });
    } catch (err) {
        console.error("Forgot password error:", err);
        await Logger.error('forgotPassword', 'Server error', { message: err.message, stack: err.stack });
        next(err);
    }
};

// Verify Reset Code
exports.verifyResetCode = async (req, res, next) => {
    try {
        const { error } = verifyResetCodeSchema.validate(req.body, { allowUnknown: true });
        if (error) {
            await Logger.error('verifyResetCode', 'Validation failed', { details: error.details[0].message });
            return res.status(400).json({ message: error.details[0].message });
        }

        const { email, code } = req.body;

        const otpRecord = await OTP.findOne({
            email,
            code,
            purpose: "reset",
            expiresAt: { $gt: new Date() },
        });

        if (!otpRecord) {
            await Logger.error('verifyResetCode', 'Invalid or expired OTP', { email });
            return res.status(400).json({ message: "Invalid or expired code" });
        }

        await Logger.info('verifyResetCode', 'OTP verified successfully', { email });
        res.status(200).json({ message: "OTP verified. You can reset your password now." });
    } catch (err) {
        console.error("Verify reset code error:", err);
        await Logger.error('verifyResetCode', 'Server error', { message: err.message, stack: err.stack });
        res.status(500).json({ message: "Server error" });
    }
};

// Reset Password
exports.resetPassword = async (req, res, next) => {
    try {
        const { error } = resetPasswordSchema.validate(req.body);
        if (error) {
            await Logger.error('resetPassword', 'Validation failed', { details: error.details[0].message });
            return res.status(400).json({ message: error.details[0].message });
        }

        const { email, code, newPassword } = req.body;

        const otp = await OTP.findOne({ email, code, purpose: "reset" });
        if (!otp) {
            await Logger.error('resetPassword', 'Invalid OTP', { email });
            return res.status(400).json({ message: "Invalid OTP" });
        }

        if (otp.expiresAt < new Date()) {
            await Logger.error('resetPassword', 'OTP expired', { email });
            return res.status(400).json({ message: "OTP expired" });
        }

        const hashed = await bcrypt.hash(newPassword, 12);
        await User.findOneAndUpdate({ email }, { password: hashed });
        await OTP.deleteMany({ email, purpose: "reset" });

        await Logger.info('resetPassword', 'Password reset successful', { email });
        res.status(200).json({ message: "Password reset successful" });
    } catch (err) {
        console.error("Reset password error:", err);
        await Logger.error('resetPassword', 'Server error', { message: err.message, stack: err.stack });
        next(err);
    }
};

// Update Profile
exports.updateProfile = async (req, res, next) => {
    try {
        const { error } = updateProfileSchema.validate(req.body);
        if (error) {
            await Logger.error('updateProfile', 'Validation failed', { userId: req.user._id, details: error.details[0].message });
            return res.status(400).json({ message: error.details[0].message });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            await Logger.error('updateProfile', 'User not found', { userId: req.user._id });
            return res.status(404).json({ message: "User not found" });
        }

        const { name, currentPassword, newPassword } = req.body;

        // Update avatar
        if (req.file) {
            if (user.avatar?.public_id) await cloudinary.uploader.destroy(user.avatar.public_id);
            const result = await cloudinary.uploader.upload(req.file.path, { folder: "avatars" });
            user.avatar = { public_id: result.public_id, url: result.secure_url };
        }

        // Update name
        if (name) user.name = name;

        // Update password
        if (currentPassword && newPassword) {
            const match = await bcrypt.compare(currentPassword, user.password);
            if (!match) {
                await Logger.error('updateProfile', 'Current password incorrect', { userId: req.user._id });
                return res.status(400).json({ message: "Current password incorrect" });
            }
            user.password = await bcrypt.hash(newPassword, 12);
        }

        // Restrict sensitive fields for non-admin
        if (req.user.role !== "admin") {
            delete user.role;
            delete user.tenant;
            delete user.customRoles;
        }

        await user.save();
        await Logger.info('updateProfile', 'Profile updated successfully', { userId: req.user._id });

        res.status(200).json({ message: "Profile updated", user });
    } catch (err) {
        console.error("Update profile error:", err);
        await Logger.error('updateProfile', 'Server error', { userId: req.user._id, message: err.message, stack: err.stack });
        next(err);
    }
};

// Get Current User
exports.getMe = async (req, res, next) => {
    try {
        const userId = req.user._id;

        const user = await User.findById(userId)
            .select('-password')
            .populate({
                path: 'tenant',
                populate: { path: 'departments', model: 'Department' },
            })
            .populate('department')
            .populate({
                path: 'customRoles',
                populate: { path: 'permissions', model: 'Permission' },
            });

        if (!user) {
            // ❌ Log error: user not found
            await Logger.error('getMe', 'User not found', { userId });
            return res.status(404).json({ message: 'User not found' });
        }

        // ✅ Log success
        await Logger.info('getMe', 'User fetched successfully', { userId });

        return res.status(200).json({ success: true, user });
    } catch (err) {
        // ❌ Log error
        console.error('getMe error:', { message: err.message, stack: err.stack });
        await Logger.error('getMe', 'Server error fetching user', {
            message: err.message,
            stack: err.stack,
            userId: req.user?._id,
        });

        return res.status(500).json({ message: 'Server error' });
    }
};

// Logout User
exports.logoutUser = async (req, res) => {
    try {
        const cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
        };

        res.clearCookie("accessToken", cookieOptions);
        res.clearCookie("refreshToken", cookieOptions);

        // ✅ Log successful logout
        await Logger.info("logoutUser", "User logged out successfully", {
            userId: req.user?._id,
            email: req.user?.email,
        });

        res.status(200).json({ message: "Logged out" });
    } catch (err) {
        // ❌ Log error
        console.error("logoutUser error:", err);
        await Logger.error("logoutUser", "Error during user logout", {
            message: err.message,
            stack: err.stack,
            userId: req.user?._id,
        });

        res.status(500).json({ message: "Logout failed", error: err.message });
    }
};

// Refresh Access Token
exports.refreshAccessToken = async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;

        if (!refreshToken)
            return res.status(401).json({ message: "No refresh token provided" });

        // Verify refresh token
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        const user = await User.findById(decoded.id);

        if (!user)
            return res.status(401).json({ message: "User not found" });

        // Generate new access token
        const accessToken = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: "15m" }
        );

        const responseData = {
            accessToken,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
        };

        // ✅ Log success
        await Logger.info("refreshAccessToken", "Access token refreshed successfully", {
            userId: user._id,
            email: user.email,
        });

        return res.status(200).json(responseData);
    } catch (err) {
        console.error("refreshAccessToken error:", err);

        // ❌ Log error
        await Logger.error("refreshAccessToken", "Error refreshing access token", {
            message: err.message,
            stack: err.stack,
        });

        return res.status(401).json({ message: "Invalid refresh token" });
    }
};