// utils/generateToken.js
const jwt = require("jsonwebtoken");

const generateToken = (payload, type = "access") => {
  const secret =
    type === "access"
      ? process.env.JWT_SECRET
      : process.env.REFRESH_TOKEN_SECRET;

  const expiresIn =
    type === "access"
      ? process.env.JWT_EXPIRE || "15m"
      : "30d";

  // console.log("Generating token with:", { payload, type, secret, expiresIn });
  return jwt.sign(payload, secret, { expiresIn });
};

module.exports = generateToken;