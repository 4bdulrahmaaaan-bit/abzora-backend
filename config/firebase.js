const fs = require('fs');
const path = require('path');

const admin = require('firebase-admin');

const serviceAccountPath = path.resolve(__dirname, '..', 'serviceAccountKey.json');
let warnedMissingConfig = false;

function initializeFirebase() {
  if (admin.apps.length) {
    return admin;
  }

  if (!fs.existsSync(serviceAccountPath)) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(`Firebase Admin disabled: serviceAccountKey.json not found at ${serviceAccountPath}.`);
    }
    return null;
  }

  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    return admin;
  } catch (error) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true;
      console.warn(`Firebase Admin disabled: ${error.message}`);
    }
    return null;
  }
}

module.exports = initializeFirebase;
