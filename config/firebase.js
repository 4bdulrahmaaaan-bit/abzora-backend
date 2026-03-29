const fs = require('fs');
const path = require('path');

const admin = require('firebase-admin');

const serviceAccountPath = path.resolve(__dirname, '..', 'serviceAccountKey.json');
let warnedMissingConfig = false;

function getServiceAccountFromEnv() {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n')
    .trim();

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
  };
}

function getServiceAccountFromFile() {
  if (!fs.existsSync(serviceAccountPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
}

function initializeFirebase() {
  if (admin.apps.length) {
    return admin;
  }

  try {
    const serviceAccount = getServiceAccountFromEnv() || getServiceAccountFromFile();
    if (!serviceAccount) {
      if (!warnedMissingConfig) {
        warnedMissingConfig = true;
        console.warn(
          `Firebase Admin disabled: provide FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY or add serviceAccountKey.json at ${serviceAccountPath}.`
        );
      }
      return null;
    }

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
