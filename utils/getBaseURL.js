// const getBaseURL = () => {
//     const env = process.env.NODE_ENV;

//     if (env === "development") {
//       return {
//         public: process.env.PUBLIC_URL_LOCAL,
//         admin: process.env.ADMIN_URL_LOCAL,
//       };
//     } else {
//       return {
//         public: process.env.PUBLIC_URL_PROD,
//         admin: process.env.ADMIN_URL_PROD,
//       };
//     }
//   };

//   module.exports = getBaseURL;
// utils/getBaseURL.js
const getBaseURL = () => {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    admin: isProduction
      ? process.env.ADMIN_URL_PROD || "https://rate-pro-admin.vercel.app"
      : process.env.ADMIN_URL_LOCAL || "http://localhost:5173",

    public: isProduction
      ? process.env.PUBLIC_URL_PROD || "https://ratepro-public.vercel.app"
      : process.env.PUBLIC_URL_LOCAL || "http://localhost:5174",
  };
};

module.exports = getBaseURL;
