// utils/generateToken.js

// const jwt = require("jsonwebtoken");

// const generateToken = (userId, type = "access") => {
//   const secret =
//     type === "access"
//       ? process.env.JWT_SECRET
//       : process.env.REFRESH_TOKEN_SECRET;

//   const expiresIn =
//     type === "access"
//       ? process.env.JWT_EXPIRE || "30d"
//       : "30d";

//   return jwt.sign({ id: userId }, secret, { expiresIn });
// };

// module.exports = generateToken;

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