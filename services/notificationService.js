const admin = require('../config/firebase')();

async function sendPushNotification(fcmToken, title, body, data = {}) {
  if (!admin) {
    console.warn('Firebase Admin not initialized. Skipping FCM push.');
    return null;
  }

  if (!fcmToken) {
    console.warn('No FCM token provided for push notification.');
    return null;
  }

  const message = {
    notification: {
      title,
      body,
    },
    data,
    token: fcmToken,
  };

  try {
    const response = await admin.messaging().send(message);
    return response;
  } catch (error) {
    console.error('Error sending FCM message:', error);
    return null;
  }
}

async function sendMulticastNotification(fcmTokens, title, body, data = {}) {
  if (!admin) {
    console.warn('Firebase Admin not initialized. Skipping FCM push.');
    return null;
  }

  if (!fcmTokens || !fcmTokens.length) {
    console.warn('No FCM tokens provided for multicast push notification.');
    return null;
  }

  const message = {
    notification: {
      title,
      body,
    },
    data,
    tokens: fcmTokens,
  };

  try {
    const response = await admin.messaging().sendMulticast(message);
    return response;
  } catch (error) {
    console.error('Error sending FCM multicast message:', error);
    return null;
  }
}

module.exports = {
  sendPushNotification,
  sendMulticastNotification,
};
