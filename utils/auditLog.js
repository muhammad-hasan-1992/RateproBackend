// // utils/auditLog.js
// const AuditLog = require('../models/Logs.js');

// class Logger {
//   static async log(functionName, message, logLevel = 'INFO', additionalData = {}) {
//     try {
//       let ipAddress = 'Unknown';
//       let userAgent = 'Unknown';
      
//       // In a real scenario, you'd get this from the request object
//       if (additionalData.req) {
//         ipAddress = additionalData.req.ip || 
//                    additionalData.req.headers['x-forwarded-for'] || 
//                    additionalData.req.connection.remoteAddress || 
//                    'Unknown';
//         userAgent = additionalData.req.headers['user-agent'] || 'Unknown';
        
//         // Remove req from additionalData to avoid circular references
//         delete additionalData.req;
//       }

//       const logEntry = new AuditLog({
//         logLevel,
//         functionName,
//         message,
//         userId: additionalData.userId || null,
//         surveyId: additionalData.surveyId || null,
//         ipAddress,
//         userAgent,
//         additionalData,
//         stackTrace: additionalData.stackTrace || null
//       });

//       await logEntry.save();
      
//       // Also log to console for development
//       const timestamp = new Date().toISOString();
//       console.log(`[${timestamp}] ${logLevel}: ${functionName} - ${message}`);
      
//       return logEntry._id;
      
//     } catch (error) {
//       console.error('Logging failed:', error.message);
//       return null;
//     }
//   }

//   static async info(functionName, message, additionalData = {}) {
//     return await this.log(functionName, message, 'INFO', additionalData);
//   }

//   static async warning(functionName, message, additionalData = {}) {
//     return await this.log(functionName, message, 'WARNING', additionalData);
//   }

//   static async error(functionName, message, additionalData = {}) {
//     return await this.log(functionName, message, 'ERROR', additionalData);
//   }

//   static async debug(functionName, message, additionalData = {}) {
//     return await this.log(functionName, message, 'DEBUG', additionalData);
//   }
// }

// module.exports = Logger;
// utils/auditLog.js
const AuditLog = require('../models/Logs');

class Logger {
  static async log(functionName, message, logLevel = 'INFO', additionalData = {}) {
    try {
      let ipAddress = 'Unknown';
      let userAgent = 'Unknown';

      // 🧠 Handle case where message is an object (e.g., { tenantId, count })
      let messageToSave = message;
      if (typeof message === 'object') {
        additionalData.messageObject = message;
        messageToSave = JSON.stringify(message, null, 2);
      }

      if (additionalData.req) {
        const req = additionalData.req;
        ipAddress =
          req.ip ||
          req.headers['x-forwarded-for'] ||
          req.connection?.remoteAddress ||
          'Unknown';
        userAgent = req.headers['user-agent'] || 'Unknown';
        delete additionalData.req;
      }

      const logEntry = new AuditLog({
        logLevel,
        functionName,
        message: messageToSave, // string or JSON string
        userId: additionalData.userId || null,
        surveyId: additionalData.surveyId || null,
        ipAddress,
        userAgent,
        additionalData,
        stackTrace: additionalData.stackTrace || null,
      });

      await logEntry.save();

      // Console log (formatted)
      const timestamp = new Date().toISOString();
      console.log(
        `[${timestamp}] ${logLevel}: ${functionName} - ${
          typeof message === 'object'
            ? JSON.stringify(message)
            : message
        }`
      );

      return logEntry._id;
    } catch (error) {
      console.error('Logging failed:', error.message);
      return null;
    }
  }

  static async info(functionName, message, additionalData = {}) {
    return await this.log(functionName, message, 'INFO', additionalData);
  }

  static async warning(functionName, message, additionalData = {}) {
    return await this.log(functionName, message, 'WARNING', additionalData);
  }

  // Alias for warning (common convention)
  static async warn(functionName, message, additionalData = {}) {
    return await this.warning(functionName, message, 'WARN', additionalData);
  }

  static async error(functionName, message, additionalData = {}) {
    return await this.log(functionName, message, 'ERROR', additionalData);
  }

  static async debug(functionName, message, additionalData = {}) {
    return await this.log(functionName, message, 'DEBUG', additionalData);
  }
}

module.exports = Logger;